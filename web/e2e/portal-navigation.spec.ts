import { expect, test, type Page } from '@playwright/test';
import type { Family } from '../src/api/types.gen';

const family: Family = { id: 'alba', name: 'Famiglia Alba', role: 'parent', accessEnabled: true };

async function mockPortal(page: Page, families: Family[] = [], admin = false) {
  const state = { families: [...families], familyRequests: [] as string[] };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/invitations') return json([]);
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin, email: 'user@example.test', csrfToken: 'csrf-test', families: state.families });
    if (path === '/api/v1/logout') return route.fulfill({ status: 204 });
    if ((path === '/api/v1/families' && request.method() === 'POST') || path === '/api/v1/invitations/accept') {
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      state.families.push(family);
      return json(family, 201);
    }
    if (path.startsWith('/api/v1/families/')) {
      state.familyRequests.push(path);
      if (path === '/api/v1/families/alba/status') return json({ ready: true, autoRead: false, speechRate: 0.9 });
      if (path === '/api/v1/families/alba/conversations') return json([{ id: 'saved', title: 'Perché il cielo è blu?', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' }]);
    }
    return json({ message: 'Not found' }, 404);
  });
  return state;
}

async function openNavigation(page: Page) {
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
}

async function closeNavigation(page: Page) {
  const close = page.getByRole('button', { name: 'Chiudi menu' });
  if (await close.isVisible()) {
    await close.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
}

async function expectPortalNavigation(page: Page, admin = false) {
  await expect(page.locator('.app-shell')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('.portal-account')).toHaveCount(0);
  await openNavigation(page);
  await expect(page.getByRole('link', { name: 'Le tue famiglie', exact: true })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Il mio dizionario' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Angolo del genitore' })).toHaveCount(0);
  await expect(page.getByText('LE MIE SCOPERTE', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cambia famiglia' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(admin ? 1 : 0);
  const account = page.getByRole('navigation', { name: 'Account e famiglia' });
  await expect(account.getByText('user@example.test')).toBeVisible();
  await expect(account.getByRole('button', { name: 'Esci', exact: true })).toBeVisible();
  await closeNavigation(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const admin of [false, true]) {
  for (const families of [[], [family], [{ ...family, accessEnabled: false }]]) {
    test(`family hub uses portal navigation (${admin ? 'admin' : 'user'}, ${families.length === 0 ? 'no families' : families[0].accessEnabled ? 'active family' : 'suspended family'})`, async ({ page }, testInfo) => {
      const state = await mockPortal(page, families, admin);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Le tue famiglie' })).toBeVisible();
      await expectPortalNavigation(page, admin);
      await expect(page.getByRole('link', { name: 'Le tue famiglie', exact: true, includeHidden: true })).toHaveClass(/selected/);
      expect(state.familyRequests).toHaveLength(0);
      if (admin && families.length === 0) await page.screenshot({ path: `test-results/family-hub-${testInfo.project.name}.png`, fullPage: true });
    });
  }
}

for (const [path, heading, families] of [
  ['/invito', 'Un invito per te', []],
  ['/famiglie/missing', 'Famiglia non disponibile', [family]],
  ['/famiglie/alba', 'Accesso sospeso', [{ ...family, accessEnabled: false }]],
  ['/pagina-inesistente', 'Questa pagina si è nascosta!', []],
] as const) {
  test(`portal navigation remains available at ${path}`, async ({ page }) => {
    const state = await mockPortal(page, [...families]);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expectPortalNavigation(page);
    expect(state.familyRequests).toHaveLength(0);
  });
}

for (const entry of ['create', 'invite'] as const) {
  test(`${entry} opens the family navigation and switching back clears its discoveries`, async ({ page }) => {
    await mockPortal(page);
    await page.goto(entry === 'create' ? '/' : '/invito#test-token');
    await expectPortalNavigation(page);
    if (entry === 'create') {
      await page.getByLabel('Crea una famiglia').fill(family.name);
      await page.getByRole('button', { name: 'Crea famiglia', exact: true }).click();
    } else await page.getByRole('button', { name: 'Accetta invito' }).click();
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openNavigation(page);
    await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveAttribute('href', '/famiglie/alba');
    await expect(page.getByRole('link', { name: 'Il mio dizionario' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Angolo del genitore' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Perché il cielo è blu/ })).toBeVisible();
    await page.getByRole('link', { name: 'Cambia famiglia' }).click();
    await expect(page.getByRole('heading', { name: 'Le tue famiglie' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectPortalNavigation(page);
    await expect(page.getByRole('link', { name: /Perché il cielo è blu/ })).toHaveCount(0);
    await page.getByRole('link', { name: /Famiglia Alba/ }).click();
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  });
}

test('members see discoveries without parent or administrator actions', async ({ page }) => {
  await mockPortal(page, [{ ...family, role: 'member' }]);
  await page.goto('/famiglie/alba');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('link', { name: 'Il mio dizionario' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Perché il cielo è blu/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Angolo del genitore' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
});

test('logout is available from the family hub', async ({ page }) => {
  await mockPortal(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Le tue famiglie' })).toBeVisible();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('public error page works without a session', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto('/errore?code=invalid_login');
  await expect(page.getByText('Il collegamento di accesso è scaduto o non è valido. Riprova.')).toBeVisible();
  await expect(page.locator('#lumi-splash')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Riprova l’accesso' })).toHaveAttribute('href', '/auth/login?return=%2F');
  expect(requests).toEqual([]);
  await page.goto('/errore?code=unknown');
  await expect(page.getByText('Qualcosa non ha funzionato. Riprova tra poco.')).toBeVisible();
});
