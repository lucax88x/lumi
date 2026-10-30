import { expect, test, type Page } from '@playwright/test';
import type { Family, ReceivedInvitation } from '../src/api/types.gen';

const family: Family = { id: 'alba', name: 'Famiglia Alba', role: 'member', accessEnabled: true };
const invitation: ReceivedInvitation = { id: 'invite', familyId: family.id, familyName: family.name, expiresAt: '2027-01-01T00:00:00Z' };

async function mockInvitations(page: Page, initial: ReceivedInvitation[] = [invitation]) {
  const state = { invitations: [...initial], families: [] as Family[], unavailable: false, failList: false, accepts: 0, declines: 0, lists: 0 };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin: false, email: 'figlia@example.test', csrfToken: 'csrf-test', families: state.families });
    if (path === '/api/v1/invitations') {
      state.lists++;
      if (state.failList) return json({ message: 'Non riesco a caricare gli inviti.' }, 503);
      return json(state.invitations);
    }
    if (path.startsWith('/api/v1/invitations/')) {
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      if (state.unavailable) { state.invitations = []; return json({ message: 'L’invito è scaduto o non è più disponibile.' }, 404); }
      if (request.method() === 'POST') { state.accepts++; state.invitations = []; state.families = [family]; return json(family); }
      if (request.method() === 'DELETE') { state.declines++; state.invitations = []; return route.fulfill({ status: 204 }); }
    }
    if (path === '/api/v1/families/alba/status') return json({ ready: true, autoRead: false, speechRate: 0.9 });
    if (path === '/api/v1/families/alba/conversations') return json([]);
    return json({ message: 'Not found' }, 404);
  });
  return state;
}

function bell(page: Page) { return page.getByRole('button', { name: /^Inviti ricevuti/ }); }

test('recipient with no families accepts from the bell and can still switch families', async ({ page }, info) => {
  const state = await mockInvitations(page);
  await page.goto('/');
  await expect(bell(page)).toHaveAccessibleName('Inviti ricevuti: 1');
  await bell(page).focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Inviti ricevuti' });
  await expect(dialog.getByRole('heading', { name: family.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/invitations-${info.project.name}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Accetta', exact: true }).click();
  await expect(page).toHaveURL(/\/famiglie\/alba$/);
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Inviti ricevuti');
  expect(state.accepts).toBe(1);
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Cambia famiglia' }).click();
  await expect(page.getByRole('heading', { name: 'Le tue famiglie' })).toBeVisible();
});

test('recipient declines, sees the empty state and focus returns to the bell', async ({ page }) => {
  const state = await mockInvitations(page);
  await page.goto('/'); await bell(page).click();
  const dialog = page.getByRole('dialog', { name: 'Inviti ricevuti' });
  await dialog.getByRole('button', { name: 'Rifiuta' }).click();
  await expect(dialog.getByText('Non hai inviti in attesa.')).toBeVisible();
  expect(state.declines).toBe(1);
  expect(state.families).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(bell(page)).toBeFocused();
  await expect(bell(page)).toHaveAccessibleName('Inviti ricevuti');
});

test('new invitations appear while the app is open and stale acceptance refreshes the list', async ({ page }) => {
  await page.clock.install();
  const state = await mockInvitations(page, []);
  await page.goto('/'); await expect(bell(page)).toHaveAccessibleName('Inviti ricevuti');
  await expect.poll(() => state.lists).toBeGreaterThan(0);
  state.invitations = [invitation];
  await page.clock.fastForward(60_100);
  await expect(bell(page)).toHaveAccessibleName('Inviti ricevuti: 1');
  await bell(page).click();
  state.unavailable = true;
  const dialog = page.getByRole('dialog', { name: 'Inviti ricevuti' });
  await dialog.getByRole('button', { name: 'Accetta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('L’invito è scaduto o non è più disponibile.');
  await expect(dialog.getByText('Non hai inviti in attesa.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('opening the bell refreshes invitations and list errors can be retried', async ({ page }) => {
  const state = await mockInvitations(page, []);
  await page.goto('/'); await expect.poll(() => state.lists).toBeGreaterThan(0);
  state.invitations = [invitation];
  await bell(page).click();
  const dialog = page.getByRole('dialog', { name: 'Inviti ricevuti' });
  await expect(dialog.getByRole('heading', { name: family.name })).toBeVisible();
  await page.keyboard.press('Escape');
  state.failList = true;
  await bell(page).click();
  await expect(dialog.getByRole('alert')).toHaveText('Non riesco a caricare gli inviti.');
  state.failList = false;
  await dialog.getByRole('button', { name: 'Riprova' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: family.name })).toBeVisible();
});
