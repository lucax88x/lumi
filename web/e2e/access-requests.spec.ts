import { expect, test, type Page } from '@playwright/test';
import type { AccessRequestState, PendingAccessRequest } from '../src/api/types.gen';

async function mockAccess(page: Page, admin = false) {
  const state = { access: admin, request: { status: 'not_requested' } as AccessRequestState, pending: [] as PendingAccessRequest[], posts: 0, decisions: [] as unknown[], failDecision: false, lists: 0, now: Date.now() };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: state.access, admin, email: admin ? 'admin@example.test' : 'persona@example.test', csrfToken: 'csrf-access', families: [] });
    if (path === '/api/v1/access-request') {
      if (request.method() === 'GET') return json(state.request);
      expect(request.headers()['x-csrf-token']).toBe('csrf-access');
      expect(request.postData()).toBeNull();
      state.posts++;
      if (state.request.status === 'rejected' && state.request.retryAfter && new Date(state.request.retryAfter).getTime() > state.now) return json(state.request, 429);
      state.request = { status: 'pending', requestedAt: new Date().toISOString() };
      return json(state.request, 201);
    }
    if (path === '/api/v1/admin/access-requests') { state.lists++; return admin ? json(state.pending) : json({}, 403); }
    if (path.match(/^\/api\/v1\/admin\/access-requests\/[^/]+\/decision$/)) {
      expect(request.headers()['x-csrf-token']).toBe('csrf-access');
      const body = request.postDataJSON(); state.decisions.push(body);
      if (state.failDecision) return json({ message: 'Non riesco ad aggiornare l’accesso su Keycloak. La richiesta resta in attesa: riprova.' }, 502);
      state.pending = state.pending.filter(item => !path.includes(`/${item.id}/`));
      return json({ status: body.decision === 'approve' ? 'approved' : 'rejected' });
    }
    if (path === '/api/v1/invitations') return json([]);
    if (path === '/api/v1/logout') return route.fulfill({ status: 204 });
    return json({ message: 'Non disponibile' }, 404);
  });
  return state;
}

test('a verified person explicitly requests access once and enters after approval without navigating away', async ({ page }, info) => {
  await page.clock.install();
  const state = await mockAccess(page);
  await page.goto('/invito#invito-da-conservare');
  await expect(page.getByRole('button', { name: 'Richiedi accesso', exact: true })).toBeEnabled();
  expect(state.posts).toBe(0);
  await page.getByRole('button', { name: 'Richiedi accesso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Richiesta inviata', exact: true })).toBeDisabled();
  expect(state.posts).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Richiesta inviata', exact: true })).toBeDisabled();
  expect(state.posts).toBe(1);
  await page.screenshot({ path: `test-results/access-pending-${info.project.name}.png`, fullPage: true });
  state.access = true;
  await page.clock.fastForward(10_100);
  await expect(page.getByRole('heading', { name: 'Un invito per te' })).toBeVisible();
  await expect(page).toHaveURL(/\/invito#invito-da-conservare$/);
});

test('rejection shows its retry date and enables a new request only after the cooldown', async ({ page }) => {
  await page.clock.install();
  const state = await mockAccess(page);
  state.request = { status: 'rejected', retryAfter: new Date(state.now + 86_400_000).toISOString() };
  await page.goto('/');
  await expect(page.getByText('La richiesta è stata rifiutata.', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Invia una nuova richiesta', exact: true });
  await expect(retry).toBeDisabled();
  // Advance the browser clock and the mocked server clock together.
  state.now += 23 * 60 * 60 * 1000;
  await page.clock.fastForward(23 * 60 * 60 * 1000);
  await expect(retry).toBeDisabled();
  state.now += 60 * 60 * 1000 + 2000;
  await page.clock.fastForward(60 * 60 * 1000 + 2000);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole('button', { name: 'Richiesta inviata', exact: true })).toBeDisabled();
  expect(state.posts).toBe(1);
});

test('administrators receive access requests, retry Keycloak errors and make one decision per request', async ({ page }, info) => {
  const state = await mockAccess(page, true);
  state.pending = [{ id: 'first', email: 'prima@example.test', attempt: 1, requestedAt: new Date().toISOString() }, { id: 'second', email: 'seconda@example.test', attempt: 2, requestedAt: new Date().toISOString() }];
  await page.goto('/');
  const bell = page.getByRole('button', { name: 'Notifiche: 2', exact: true });
  await expect(bell).toBeVisible();
  await bell.click();
  const dialog = page.getByRole('dialog', { name: 'Notifiche', exact: true });
  const first = dialog.getByRole('article', { name: 'prima@example.test' });
  state.failDecision = true;
  await first.getByRole('button', { name: 'Approva', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('La richiesta resta in attesa');
  await expect(first).toBeVisible();
  state.failDecision = false;
  await first.getByRole('button', { name: 'Approva', exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('Accesso approvato per prima@example.test.');
  await page.screenshot({ path: `test-results/access-notifications-${info.project.name}.png`, fullPage: true });
  await dialog.getByRole('article', { name: 'seconda@example.test' }).getByRole('button', { name: 'Rifiuta', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Potrà riprovare tra 24 ore.');
  await expect(dialog.getByText('Non ci sono richieste di accesso in attesa.')).toBeVisible();
  expect(state.decisions).toEqual([{ decision: 'approve', attempt: 1 }, { decision: 'approve', attempt: 1 }, { decision: 'reject', attempt: 2 }]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Notifiche', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ordinary members never fetch or see administrator access requests', async ({ page }) => {
  const state = await mockAccess(page); state.access = true;
  await page.goto('/');
  await page.getByRole('button', { name: 'Notifiche', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inviti agli spazi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Richieste di accesso' })).toHaveCount(0);
  expect(state.lists).toBe(0);
});


test('a rejection received in another session replaces a stale request button with the cooldown', async ({ page }) => {
  const state = await mockAccess(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Richiedi accesso', exact: true })).toBeEnabled();
  state.request = { status: 'rejected', retryAfter: new Date(state.now + 86_400_000).toISOString() };
  await page.getByRole('button', { name: 'Richiedi accesso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invia una nuova richiesta', exact: true })).toBeDisabled();
  await expect(page.getByText('La richiesta è stata rifiutata.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.posts).toBe(1);
});
