import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, stack, origin } from './fixtures';

const keycloak = 'http://localhost:19090/keycloak';
const mailpit = `http://localhost:${stack.MAILPIT_PORT || '18025'}`;
let http: APIRequestContext;
let adminToken = '';

async function admin(path: string, method = 'GET', data?: unknown) {
  const response = await http.fetch(`${keycloak}/admin/realms/lumi${path}`, {
    method, data, headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(response.ok(), `Keycloak email setup ${method} ${path}: ${response.status()}`).toBe(true);
  return response;
}

type Email = { ID: string; Subject: string; HTML: string; Text: string };
async function receiveEmail(address: string, subject: string): Promise<Email> {
  let id = '';
  await expect.poll(async () => {
    const response = await http.get(`${mailpit}/api/v1/messages`);
    const { messages = [] } = await response.json();
    id = messages.find((message: { Subject: string; To: { Address: string }[] }) =>
      message.Subject === subject && message.To.some(to => to.Address === address))?.ID ?? '';
    return Boolean(id);
  }, { timeout: 15_000 }).toBe(true);
  const email: Email = await (await http.get(`${mailpit}/api/v1/message/${id}`)).json();
  const raw = await (await http.get(`${mailpit}/api/v1/message/${id}/raw`)).text();
  expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
  expect(raw).toMatch(/Content-Type: text\/plain/i);
  expect(raw).toMatch(/Content-Type: text\/html/i);
  expect(email.HTML).not.toMatch(/\$\{|lumi[A-Z]\w+|<#/);
  return email;
}

async function previewEmail(page: Page, email: Email, locale: string, heading?: string, action?: string) {
  // Use real delivered HTML; no image loading or external font dependency.
  await page.setContent(email.HTML);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 243, 250)');
  await expect(page.locator('img, script, link[rel=stylesheet]')).toHaveCount(0);
  await expect(page.getByText(locale === 'it' ? 'Messaggio automatico di Lumi per il tuo account.' : 'An automatic message from Lumi about your account.')).toBeVisible();
  if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  if (action) {
    const button = page.getByRole('link', { name: action, exact: true });
    const href = await button.getAttribute('href');
    expect(href).toContain('/login-actions/');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    const fallback = page.getByRole('link', { name: href!, exact: true });
    await expect(fallback).toHaveAttribute('href', href!);
    expect(email.Text).toContain(href!);
    expect(new URL(href!).origin).toBe(stack.PUBLIC_ORIGIN);
    expect(email.Text).toMatch(locale === 'it' ? /scade tra / : /expires in /);
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeAll(async () => {
  http = await request.newContext();
});
test.beforeEach(async () => {
  const response = await http.post(`${keycloak}/realms/master/protocol/openid-connect/token`, {
    form: { grant_type: 'password', client_id: 'admin-cli', username: stack.KEYCLOAK_ADMIN_USER, password: stack.KEYCLOAK_ADMIN_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  adminToken = (await response.json()).access_token;
  expect((await (await admin('')).json()).emailTheme).toBe('lumi');
});
test.afterAll(async () => { await http?.dispose(); });

for (const locale of ['it', 'en']) {
  const copy = locale === 'it' ? {
    verifySubject: 'Conferma la tua email per Lumi', verifyTitle: 'Conferma la tua email', verifyAction: 'Conferma email',
    resetSubject: 'Scegli una nuova password per Lumi', resetTitle: 'Scegli una nuova password', resetAction: 'Scegli nuova password',
    actionsSubject: 'Completa il tuo account Lumi', actionsTitle: 'Completa il tuo account', actionsAction: 'Completa account',
    testSubject: 'Lumi · Prova di invio email',
  } : {
    verifySubject: 'Confirm your email for Lumi', verifyTitle: 'Confirm your email', verifyAction: 'Confirm email',
    resetSubject: 'Choose a new password for Lumi', resetTitle: 'Choose a new password', resetAction: 'Choose new password',
    actionsSubject: 'Complete your Lumi account', actionsTitle: 'Complete your account', actionsAction: 'Complete account',
    testSubject: 'Lumi · Email delivery test',
  };

  test(`branded ${locale} verification and password reset complete successfully`, async ({ page, context }, info) => {
    const address = `email-${randomUUID()}@example.test`;
    const password = `Lumi-${randomUUID()}!`;
    const preview = await context.newPage();
    let id: string | undefined;
    try {
      await page.goto(origin + '/');
      const login = new URL(page.url());
      login.searchParams.set('ui_locales', locale);
      await page.goto(login.href);
      await page.locator('#kc-registration a').click();
      await page.locator('#email').fill(address);
      if (await page.locator('#firstName').count()) await page.locator('#firstName').fill('Test');
      if (await page.locator('#lastName').count()) await page.locator('#lastName').fill('Lumi');
      if (await page.locator('#password').count()) {
        await page.locator('#password').fill(password);
        await page.locator('#password-confirm').fill(password);
      }
      await page.locator('input[type="submit"], button[type="submit"]').last().click();
      const users = await (await admin(`/users?email=${encodeURIComponent(address)}&exact=true`)).json();
      id = users[0].id;
      const verification = await receiveEmail(address, copy.verifySubject);
      await previewEmail(preview, verification, locale, copy.verifyTitle, copy.verifyAction);
      await preview.screenshot({ path: `auth-test-results/email-verification-${locale}-${info.project.name}.png`, fullPage: true });
      const link = await preview.getByRole('link', { name: copy.verifyAction, exact: true }).getAttribute('href');
      await page.goto(link!);
      // Keycloak 26.8 asks for a password after verifying a new registration.
      await page.locator('#password-new').fill(password);
      await page.locator('#password-confirm').fill(password);
      await page.locator('#kc-passwd-update-form [type=submit]').click();
      await expect.poll(async () => (await (await admin(`/users/${id}`)).json()).emailVerified).toBe(true);

      // A fresh browser session requests recovery through the real login form.
      await context.clearCookies();
      await page.goto(origin + '/auth/login');
      const resetLogin = new URL(page.url());
      resetLogin.searchParams.set('ui_locales', locale);
      await page.goto(resetLogin.href);
      await page.locator('a[href*="reset-credentials"]').click();
      await page.locator('#username').fill(address);
      await page.locator('input[type="submit"], button[type="submit"]').last().click();
      const reset = await receiveEmail(address, copy.resetSubject);
      await previewEmail(preview, reset, locale, copy.resetTitle, copy.resetAction);
      await preview.screenshot({ path: `auth-test-results/email-password-reset-${locale}-${info.project.name}.png`, fullPage: true });
      await page.goto((await preview.getByRole('link', { name: copy.resetAction, exact: true }).getAttribute('href'))!);
      const newPassword = `Lumi-${randomUUID()}!`;
      await page.locator('#password-new').fill(newPassword);
      await page.locator('#password-confirm').fill(newPassword);
      await page.locator('#kc-passwd-update-form [type=submit]').click();
      await expect(page.locator('#password-new')).toHaveCount(0);
      await context.clearCookies();
      await page.goto(origin + '/auth/login');
      await page.locator('#username').fill(address);
      await page.locator('#password').fill(newPassword);
      await page.locator('#kc-login').click();
      await expect.poll(async () => new URL(page.url()).origin).toBe(origin);
    } finally {
      await preview.close();
      if (id) await admin(`/users/${id}`, 'DELETE');
    }
  });

  test(`branded ${locale} administrator actions and inherited SMTP test email`, async ({ page }, info) => {
    const address = `email-actions-${randomUUID()}@example.test`;
    const password = `Lumi-${randomUUID()}!`;
    const created = await admin('/users', 'POST', {
      username: address, email: address, emailVerified: true, enabled: true,
      firstName: 'Test Lumi', lastName: 'Email', attributes: { locale: [locale] },
      credentials: [{ type: 'password', value: password, temporary: false }],
    });
    const id = created.headers().location.split('/').at(-1)!;
    try {
      await admin(`/users/${id}/execute-actions-email`, 'PUT', ['VERIFY_EMAIL', 'UPDATE_PASSWORD']);
      const actions = await receiveEmail(address, copy.actionsSubject);
      await previewEmail(page, actions, locale, copy.actionsTitle, copy.actionsAction);
      await expect(page.locator('li')).toHaveCount(2);
      for (const action of await page.locator('li').allTextContents()) expect(actions.Text).toContain(action.trim());
      await page.screenshot({ path: `auth-test-results/email-account-actions-${locale}-${info.project.name}.png`, fullPage: true });

      // Give only this disposable user permission to send an SMTP test. Never
      // modify the bootstrap administrator's email or locale preferences.
      await admin(`/users/${id}`, 'PUT', { requiredActions: [] });
      const clients = await (await admin('/clients?clientId=realm-management')).json();
      const clientId = clients[0].id;
      const role = await (await admin(`/clients/${clientId}/roles/manage-realm`)).json();
      await admin(`/users/${id}/role-mappings/clients/${clientId}`, 'POST', [role]);
      const token = await http.post(`${keycloak}/realms/lumi/protocol/openid-connect/token`, {
        form: { grant_type: 'password', client_id: 'admin-cli', username: address, password },
      });
      expect(token.ok()).toBe(true);
      const settings = (await (await admin('')).json()).smtpServer;
      const sent = await http.post(`${keycloak}/admin/realms/lumi/testSMTPConnection`, {
        data: settings, headers: { Authorization: `Bearer ${(await token.json()).access_token}` },
      });
      expect(sent.status()).toBe(204);
      const smtp = await receiveEmail(address, copy.testSubject);
      await previewEmail(page, smtp, locale);
      await expect(page.locator('a')).toHaveCount(0);
      expect(smtp.Text).toContain(locale === 'it' ? 'Le email di Lumi sono pronte.' : 'Lumi emails are ready.');
    } finally {
      await admin(`/users/${id}`, 'DELETE');
    }
  });
}
