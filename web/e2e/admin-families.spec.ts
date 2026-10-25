import { expect, test } from '@playwright/test';

// The administrator deliberately has no family memberships.
test('administrator manages all families, members and invitations', async ({ page }, testInfo) => {
  const families = [
    { id: 'alpha', name: 'Famiglia Alba', accessEnabled: true, memberCount: 2 },
    { id: 'beta', name: 'Famiglia Bosco', accessEnabled: false, memberCount: 1 },
  ];
  const members = [{ userId: 'parent', email: 'genitore@example.test', role: 'parent' }, { userId: 'member', email: 'membro@example.test', role: 'member' }];
  const invitations: { id: string; email: string; expiresAt: string }[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin: true, email: 'admin@example.test', csrfToken: 'csrf-test', families: [] });
    if (path === '/api/v1/admin/families') return json(families);
    if (path.endsWith('/access')) {
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      families.find(f => path.includes(`/${f.id}/`))!.accessEnabled = request.postDataJSON().accessEnabled;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/members')) return json(members);
    if (path.endsWith('/members/member')) {
      if (request.method() === 'DELETE') { members.splice(1, 1); families[0].memberCount = 1; }
      else members[1].role = request.postDataJSON().role;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/invitations')) {
      if (request.method() === 'GET') return json(invitations);
      const invitation = { id: 'invite', email: request.postDataJSON().email, expiresAt: '2027-01-01T00:00:00Z' };
      invitations.push(invitation);
      return json({ invitation, url: 'https://lumi.test/auth/invite#test' }, 201);
    }
    if (path.endsWith('/invitations/invite')) { invitations.splice(0); return route.fulfill({ status: 204 }); }
    if (path === '/api/v1/admin/connection') return json({ connected: false, transcriptionConfigured: false, email: '', message: '' });
    if (path === '/api/v1/admin/settings') return json({ model: '', prompt: '', defaultPrompt: '', autoRead: false, speechRate: 0.9 });
    return json({ message: 'Not found' }, 404);
  });
  await page.goto('/admin');
  const alba = page.getByRole('article', { name: 'Famiglia Alba' });
  const bosco = page.getByRole('article', { name: 'Famiglia Bosco' });
  await expect(alba.getByText('2 membri')).toBeVisible();
  await expect(bosco.getByText('Accesso sospeso')).toBeVisible();
  await page.getByLabel('Cerca una famiglia').fill('bosco');
  await expect(alba).toHaveCount(0);
  await expect(bosco).toBeVisible();
  await page.getByLabel('Cerca una famiglia').fill('inesistente');
  await expect(page.getByText('Nessuna famiglia trovata.')).toBeVisible();
  await page.getByLabel('Cerca una famiglia').clear();
  page.once('dialog', dialog => dialog.dismiss());
  await alba.getByRole('button', { name: 'Sospendi accesso' }).click();
  await expect(alba.getByText('Accesso attivo')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await alba.getByRole('button', { name: 'Sospendi accesso' }).click();
  await expect(alba.getByText('Accesso sospeso')).toBeVisible();
  await alba.getByRole('button', { name: 'Riattiva accesso' }).click();
  await expect(alba.getByText('Accesso attivo')).toBeVisible();
  await alba.getByRole('button', { name: 'Gestisci membri e inviti' }).click();
  await expect(alba.getByText('genitore@example.test')).toBeVisible();
  await alba.getByRole('combobox', { name: 'Ruolo di membro@example.test' }).selectOption('parent');
  await expect(alba.getByRole('combobox', { name: 'Ruolo di membro@example.test' })).toHaveValue('parent');
  await alba.getByLabel('Email della persona').fill('ospite@example.test');
  await alba.getByRole('button', { name: 'Crea link di invito' }).click();
  await expect(alba.getByLabel('Link da condividere')).toHaveValue('https://lumi.test/auth/invite#test');
  await expect(alba.getByText('ospite@example.test')).toBeVisible();
  await alba.getByRole('button', { name: 'Revoca' }).click();
  await expect(alba.getByText('Nessun invito in attesa.')).toBeVisible();
  await expect(alba.getByLabel('Link da condividere')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await alba.locator('.member-row').filter({ hasText: 'membro@example.test' }).getByRole('button', { name: 'Rimuovi' }).click();
  await expect(alba.getByText('membro@example.test', { exact: true })).toHaveCount(0);
  await expect(alba.getByText('1 membro', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/admin-families-${testInfo.project.name}.png`, fullPage: true });
});

test('suspended families are visible in the hub and cannot be opened', async ({ page }) => {
  const familyRequests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'genitore@example.test', csrfToken: 'csrf-test', families: [{ id: 'alpha', name: 'Famiglia Alba', role: 'parent', accessEnabled: false }] }) });
    familyRequests.push(path);
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Accesso sospeso' }) });
  });
  await page.goto('/');
  await expect(page.getByText('Famiglia Alba')).toBeVisible();
  await expect(page.getByText('Accesso sospeso')).toBeVisible();
  await expect(page.getByRole('link', { name: /Famiglia Alba/ })).toHaveCount(0);
  await page.goto('/famiglie/alpha');
  await expect(page.getByRole('heading', { name: 'Accesso sospeso' })).toBeVisible();
  expect(familyRequests).toHaveLength(0);
});
