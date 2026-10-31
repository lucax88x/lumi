import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, stack as env, origin } from './fixtures';
import type { Family, Session } from '../src/api/types.gen';

// Private setup traffic stays in Node; administrator JWTs never enter the app browser.
const keycloak = 'http://localhost:19090/keycloak';
let admin: APIRequestContext;
let adminToken = '';
async function adminRequest(path: string, method = 'GET', data?: unknown) {
  const response = await admin.fetch(`${keycloak}/admin/realms/lumi${path}`, { method, data, headers: { Authorization: `Bearer ${adminToken}` } });
  expect(response.ok(), `Keycloak setup ${method} ${path}: ${response.status()}`).toBe(true);
  return response;
}
async function userId(email: string) { const r = await adminRequest(`/users?email=${encodeURIComponent(email)}&exact=true`); const users = await r.json(); expect(users).toHaveLength(1); return users[0].id as string; }
async function approve(id: string) { const role = await (await adminRequest('/roles/portal-access')).json(); await adminRequest(`/users/${id}/role-mappings/realm`, 'POST', [role]); }
async function seedAccount(email: string, password: string) {
  await adminRequest('/users', 'POST', { username: email, email, emailVerified: true, firstName: 'Test', lastName: 'Lumi', enabled: true, credentials: [{ type: 'password', value: password, temporary: false }] });
  return userId(email);
}
async function login(page: Page, email: string, password: string) {
  await page.goto(origin + '/');
  await page.locator('#username').fill(email); await page.locator('#password').fill(password); await page.locator('#kc-login').click();
}
async function openNavigation(page: Page) {
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
}
async function session(page: Page) { return page.evaluate(async () => (await fetch('/api/v1/session')).json()) as Promise<Session>; }
async function appRequest(page: Page, path: string, method = 'GET', body?: unknown) {
  const s = await session(page);
  return page.evaluate(async ({ path, method, body, csrf }) => {
    const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  }, { path, method, body, csrf: s.csrfToken });
}
test.beforeAll(async () => {
  admin = await request.newContext();
  const token = await admin.post(`${keycloak}/realms/master/protocol/openid-connect/token`, { form: { grant_type: 'password', client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN_USER, password: env.KEYCLOAK_ADMIN_PASSWORD } });
  expect(token.ok(), 'Private administrator sign-in').toBe(true); adminToken = (await token.json()).access_token;
});
test.afterAll(async () => { await admin?.dispose(); });

test('shared Admin requires the explicit portal-admin realm role', async ({ page }) => {
  const email = `shared-admin-${randomUUID()}@example.test`;
  const password = `Lumi-${randomUUID()}!`;
  const id = await seedAccount(email, password);
  try {
    await approve(id);
    await login(page, email, password);
    await expect(page.getByRole('heading', { name: 'I tuoi spazi' })).toBeVisible();
    expect((await session(page)).admin).toBe(false);
    expect((await appRequest(page, '/api/v1/admin/connection')).status).toBe(403);
    await page.goto(origin + '/admin');
    await expect(page.getByRole('alert')).toHaveText('Questa parte è riservata agli amministratori.');
    const role = await (await adminRequest('/roles/portal-admin')).json();
    await adminRequest(`/users/${id}/role-mappings/realm`, 'POST', [role]);
    // A fresh OIDC login receives the new signed role; no ChatGPT calls are made.
    await page.goto(origin + '/auth/login?return=%2Fadmin');
    await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
    expect((await session(page)).admin).toBe(true);
    expect((await appRequest(page, '/api/v1/admin/connection')).status).toBe(200);
    expect((await session(page)).families).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  } finally {
    await adminRequest(`/users/${id}`, 'DELETE');
  }
});

test('public gateway blocks administrator surfaces and APIs require cookies', async ({ request: http, page }, info) => {
  for (const path of ['/keycloak/admin/', '/keycloak/admin/realms/lumi', '/keycloak/realms/master/.well-known/openid-configuration', '/keycloak/health/ready', '/healthz']) expect((await http.get(env.PUBLIC_ORIGIN + path)).status()).toBe(404);
  expect((await http.get(origin + '/api/v1/families')).status()).toBe(401);
  await page.goto(origin + '/'); await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('link[href*="lumi.css"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `auth-test-results/keycloak-login-${info.project.name}.png`, fullPage: true });
});

test('registration, verified email, approval, families, invitations and cookie-only logout', async ({ page, browser, nativeLumi }, info) => {
  const email = `lumi-${randomUUID()}@example.test`; const guestEmail = `lumi-${randomUUID()}@example.test`; const password = `Lumi-${randomUUID()}!`; const createdUsers: string[] = [];
  try {
    await page.goto(origin + '/'); await page.locator('#kc-registration a').click();
    await page.locator('#email').fill(email);
    if (await page.locator('#firstName').count()) await page.locator('#firstName').fill('Test');
    if (await page.locator('#lastName').count()) await page.locator('#lastName').fill('Lumi');
    if (await page.locator('#password').count()) { await page.locator('#password').fill(password); await page.locator('#password-confirm').fill(password); }
    await page.locator('input[type="submit"], button[type="submit"]').last().click();
    await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible();
    const id = await userId(email); createdUsers.push(id);
    const mail = await request.newContext();
    let mailId = '';
    await expect.poll(async () => {
      const response = await mail.get('http://localhost:18025/api/v1/messages');
      const messages = (await response.json()).messages ?? [];
      const message = messages.find((m: { To: { Address: string }[] }) => m.To.some(to => to.Address === email)); mailId = message?.ID ?? ''; return Boolean(mailId);
    }).toBe(true);
    const message = await (await mail.get(`http://localhost:18025/api/v1/message/${mailId}`)).json();
    const link = (message.HTML as string).match(/href="([^"]*login-actions\/action-token[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
    expect(link).toBeTruthy(); await page.goto(link!);
    // Keycloak 26.8 verifies email before asking for the new password.
    await page.locator('#password-new').fill(password); await page.locator('#password-confirm').fill(password);
    await page.locator('#kc-passwd-update-form [type=submit]').click();
    await mail.dispose();
    await expect(page.getByRole('heading', { name: 'Il tuo angolino ti aspetta' })).toBeVisible();
    expect((await appRequest(page, '/api/v1/families', 'POST', { name: 'Forbidden' })).status).toBe(403);
    await approve(id); await page.getByRole('button', { name: 'Controlla l’accesso' }).click();
    await expect(page.getByRole('heading', { name: 'I tuoi spazi' })).toBeVisible();
    await page.getByLabel('Crea uno spazio').fill('Le lucciole'); await page.getByRole('button', { name: 'Crea spazio', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    const first = (await session(page)).families[0]; expect(first.role).toBe('parent');
    const second = await appRequest(page, '/api/v1/families', 'POST', { name: 'Le stelle' }); expect(second.status).toBe(201); const other = second.body as Family;
    const conversation = { id: 'isolation-' + randomUUID(), title: 'Solo per le lucciole' };
    expect((await appRequest(page, `/api/v1/families/${first.id}/conversations`, 'POST', conversation)).status).toBe(200);
    // Restart the test-owned native backend, preserving browser cookies and data.
    await nativeLumi.restart();
    await expect.poll(async () => (await page.request.get(origin + '/api/v1/session')).status()).toBe(200);
    const otherChats = await appRequest(page, `/api/v1/families/${other.id}/conversations`); expect(otherChats.body).toEqual([]);
    const members = await appRequest(page, `/api/v1/families/${first.id}/members`);
    expect((await appRequest(page, `/api/v1/families/${first.id}/members/${members.body[0].userId}`, 'DELETE')).status).toBe(409);
    await page.goto(origin + `/spazi/${first.id}`);
    await openNavigation(page);
    await page.getByRole('link', { name: /Cambia spazio/ }).click();
    await page.getByRole('link', { name: /Le stelle/ }).click();
    await expect(page).toHaveURL(new RegExp(other.id));
    await expect(page.getByText(conversation.title)).toHaveCount(0);
    const responseBodies: string[] = [];
    page.on('response', async response => { if (response.url().startsWith(origin + '/api/')) responseBodies.push(await response.text().catch(() => '')); });
    await page.goto(origin + `/spazi/${first.id}/membri`); await page.getByLabel('Email della persona').fill(guestEmail); await page.getByRole('button', { name: 'Invita', exact: true }).click();
    const invitation = await page.getByLabel('Link da condividere').inputValue(); expect(invitation).toContain('/auth/invite#');
    const guestID = await seedAccount(guestEmail, password); createdUsers.push(guestID);
    const guestContext = await browser.newContext(); const guest = await guestContext.newPage();
    await guest.goto(invitation);
    await guest.locator('#username').fill(guestEmail); await guest.locator('#password').fill(password); await guest.locator('#kc-login').click(); await expect(guest.getByRole('heading', { name: 'Il tuo angolino ti aspetta' })).toBeVisible();
    const inviteToken = new URL(invitation).hash.slice(1);
    expect((await appRequest(guest, '/api/v1/invitations/accept', 'POST', { token: inviteToken })).status).toBe(403);
    await approve(guestID); await guest.getByRole('button', { name: 'Controlla l’accesso' }).click(); await expect(guest.getByRole('heading', { name: 'Un invito per te' })).toBeVisible(); await guest.getByRole('button', { name: 'Accetta invito' }).click(); await expect(guest.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    expect((await appRequest(guest, `/api/v1/families/${other.id}/conversations`)).status).toBe(404);
    expect((await appRequest(guest, `/api/v1/families/${first.id}/admin/settings`)).status).toBe(403);
    expect((await appRequest(guest, '/api/v1/invitations/accept', 'POST', { token: inviteToken })).status).toBe(404);
    const guestFamily = await appRequest(guest, '/api/v1/families', 'POST', { name: 'Lo spazio ospite' });
    expect(guestFamily.status).toBe(201);
    expect((await appRequest(guest, `/api/v1/families/${guestFamily.body.id}/admin/settings`)).status).toBe(200);
    expect((await appRequest(guest, `/api/v1/families/${first.id}/admin/settings`)).status).toBe(403);
    await guestContext.close();
    const cookies = await page.context().cookies(origin); const cookie = cookies.find(c => c.name === 'lumi_session'); expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Lax'); expect(cookie?.value.length).toBe(52); expect(cookie?.value.includes('.')).toBe(false);
    const storage = await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) })); expect(JSON.stringify(storage)).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    expect(responseBodies.join('\n')).not.toMatch(/"(?:access_token|refresh_token|id_token)"/);
    await page.screenshot({ path: `auth-test-results/family-members-${info.project.name}.png`, fullPage: true });
    await openNavigation(page);
    await page.getByRole('button', { name: 'Esci', exact: true }).click(); await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible(); expect(page.url()).not.toContain('id_token_hint');
    expect((await page.request.get(origin + '/api/v1/session')).status()).toBe(401);
  } finally { for (const id of createdUsers) await adminRequest(`/users/${id}`, 'DELETE'); }
});

test('administrator console login remains entirely on loopback', async ({ page }) => {
  await page.goto(keycloak + '/admin/');
  await page.locator('#username').fill(env.KEYCLOAK_ADMIN_USER); await page.locator('#password').fill(env.KEYCLOAK_ADMIN_PASSWORD); await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'master realm', exact: true })).toBeVisible();
  expect(new URL(page.url()).port).toBe('19090');
});
