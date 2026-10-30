import { expect, test } from '@playwright/test';

// The administrator deliberately has no family memberships.
test('administrator manages all families, members and invitations', async ({ page }, testInfo) => {
  const families = [
    { id: 'alpha', name: 'Famiglia Alba', accessEnabled: true, memberCount: 2 },
    { id: 'beta', name: 'Famiglia Bosco', accessEnabled: false, memberCount: 1 },
  ];
  const members = [{ userId: 'parent', email: 'genitore@example.test', role: 'parent' }, { userId: 'member', email: 'membro@example.test', role: 'member' }];
  const invitations: { id: string; email: string; expiresAt: string }[] = [];
  const requests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/v1/invitations') return route.fulfill({ contentType: 'application/json', body: '[]' });
    requests.push(path);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin: true, email: 'admin@example.test', csrfToken: 'csrf-test', families: [] });
    if (path === '/api/v1/admin/families') return json(families);
    if (path.endsWith('/access')) {
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      families.find(f => path.includes(`/${f.id}/`))!.accessEnabled = request.postDataJSON().accessEnabled;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/members')) return json(path.includes('/beta/') ? [{ userId: 'bosco', email: 'bosco@example.test', role: 'parent' }] : members);
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
  await page.goto('/admin/famiglie');
  await expect(page.getByRole('heading', { name: 'Famiglie', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Collega ChatGPT/ })).toHaveCount(0);
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
  expect(requests.some(path => path.startsWith('/api/v1/families/') && (path.endsWith('/members') || path.endsWith('/invitations')))).toBe(false);
  const manageAlba = alba.getByRole('button', { name: 'Gestisci membri e inviti' });
  await manageAlba.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Famiglia Alba' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('genitore@example.test')).toBeVisible();
  await drawer.getByRole('combobox', { name: 'Ruolo di membro@example.test' }).selectOption('parent');
  await expect(drawer.getByRole('combobox', { name: 'Ruolo di membro@example.test' })).toHaveValue('parent');
  await drawer.getByLabel('Email della persona').fill('ospite@example.test');
  await drawer.getByRole('button', { name: 'Invita', exact: true }).click();
  await expect(drawer.getByLabel('Link da condividere')).toHaveValue('https://lumi.test/auth/invite#test');
  await expect(drawer.getByText('ospite@example.test')).toBeVisible();
  await drawer.getByRole('button', { name: 'Revoca' }).click();
  await expect(drawer.getByText('Nessun invito in attesa.')).toBeVisible();
  await expect(drawer.getByLabel('Link da condividere')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await drawer.locator('.member-row').filter({ hasText: 'membro@example.test' }).getByRole('button', { name: 'Rimuovi' }).click();
  await expect(drawer.getByText('membro@example.test', { exact: true })).toHaveCount(0);
  expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/admin-family-drawer-${testInfo.project.name}.png`, fullPage: true });
  await drawer.getByRole('button', { name: 'Chiudi gestione famiglia' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(manageAlba).toBeFocused();
  await expect(alba.getByText('1 membro', { exact: true })).toBeVisible();
  const manageBosco = bosco.getByRole('button', { name: 'Gestisci membri e inviti' });
  await manageBosco.click();
  const boscoDrawer = page.getByRole('dialog', { name: 'Famiglia Bosco' });
  await expect(boscoDrawer.getByText('bosco@example.test')).toBeVisible();
  await expect(boscoDrawer.getByText('genitore@example.test')).toHaveCount(0);
  await expect(boscoDrawer.getByLabel('Email della persona')).toHaveValue('');
  await expect(boscoDrawer.getByLabel('Link da condividere')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(boscoDrawer).toHaveCount(0);
  await expect(manageBosco).toBeFocused();
  expect(requests.some(path => path.includes('/admin/connection') || path.includes('/admin/settings'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/admin-families-${testInfo.project.name}.png`, fullPage: true });
});

test('Admin and family management have separate pages and preserve the navigation context', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/invitations') return route.fulfill({ contentType: 'application/json', body: '[]' });
    requests.push(path);
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin: true, email: 'admin@example.test', csrfToken: 'csrf-test', families: [{ id: 'other', name: 'Altra famiglia', role: 'parent' }, { id: 'alpha', name: 'Famiglia Alba', role: 'parent' }] });
    if (path === '/api/v1/admin/connection') return json({ connected: false, transcriptionConfigured: false, email: '', message: '' });
    if (path === '/api/v1/admin/settings') return json({ model: '', prompt: '', defaultPrompt: '', autoRead: false, speechRate: 0.9 });
    return json([]);
  });
  await page.goto('/admin?family=alpha');
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.getByLabel('Cerca una famiglia')).toHaveCount(0);
  expect(requests).not.toContain('/api/v1/admin/families');
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Famiglie gestite', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/famiglie\?family=alpha$/);
  await expect(page.getByRole('heading', { name: 'Famiglie', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Collega ChatGPT', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Famiglie', exact: true })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveAttribute('href', '/famiglie/alpha');
  await expect(page.getByRole('link', { name: 'Famiglie gestite', exact: true })).toHaveAttribute('aria-current', 'page');
  const close = page.getByRole('button', { name: 'Chiudi menu' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('link', { name: 'Torna ad Admin' }).click();
  await expect(page).toHaveURL(/\/admin\?family=alpha$/);
  await expect(page.getByRole('button', { name: 'Collega ChatGPT', exact: true })).toBeVisible();
});

test('family management is reserved for administrators and makes no management requests for members', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/invitations') return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (path === '/api/v1/session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'user@example.test', csrfToken: 'csrf-test', families: [] }) });
    requests.push(path);
    return route.fulfill({ status: 403 });
  });
  await page.goto('/admin/famiglie');
  await expect(page.getByRole('alert')).toHaveText('Questa parte è riservata agli amministratori.');
  await expect(page.getByLabel('Cerca una famiglia')).toHaveCount(0);
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole('link', { name: 'Famiglie gestite', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('suspended families are visible in the hub and cannot be opened', async ({ page }) => {
  const familyRequests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/invitations') return route.fulfill({ contentType: 'application/json', body: '[]' });
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

test('administrator deletes a suspended family only after confirming', async ({ page }, info) => {
  const families = [
    { id: 'active', name: 'Famiglia Attiva', accessEnabled: true, memberCount: 1 },
    { id: 'suspended', name: 'Famiglia Sospesa', accessEnabled: false, memberCount: 2 },
  ];
  let deletions = 0;
  let reactivated = false;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/v1/invitations') return route.fulfill({ contentType: 'application/json', body: '[]' });
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/session') return json({ authenticated: true, portalAccess: true, admin: true, email: 'admin@example.test', csrfToken: 'csrf-test', families: [] });
    if (path === '/api/v1/admin/families') return json(families);
    if (path === '/api/v1/admin/families/suspended' && request.method() === 'DELETE') {
      expect(request.headers()['x-csrf-token']).toBe('csrf-test');
      deletions++;
      if (reactivated) return json({ message: 'Sospendi la famiglia prima di eliminarla.' }, 409);
      families.splice(1, 1);
      return route.fulfill({ status: 204 });
    }
    return json({ message: 'Not found' }, 404);
  });
  await page.goto('/admin/famiglie');
  const active = page.getByRole('article', { name: 'Famiglia Attiva' });
  const suspended = page.getByRole('article', { name: 'Famiglia Sospesa' });
  await expect(active.getByRole('button', { name: 'Elimina famiglia' })).toHaveCount(0);
  await suspended.getByRole('button', { name: 'Elimina famiglia' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Eliminare Famiglia Sospesa?' });
  await expect(confirmation.getByRole('button', { name: 'Annulla' })).toBeFocused();
  await expect(confirmation.getByText(/conversazioni, dizionario/)).toBeVisible();
  await page.screenshot({ path: `test-results/delete-family-${info.project.name}.png`, fullPage: true });
  await confirmation.getByRole('button', { name: 'Annulla' }).click();
  await expect(confirmation).toHaveCount(0);
  expect(deletions).toBe(0);
  await suspended.getByRole('button', { name: 'Elimina famiglia' }).click();
  reactivated = true;
  await confirmation.getByRole('button', { name: 'Elimina definitivamente' }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('Sospendi la famiglia prima di eliminarla.');
  await expect(page.getByRole('article', { name: 'Famiglia Sospesa', includeHidden: true })).toBeAttached();
  reactivated = false;
  await confirmation.getByRole('button', { name: 'Elimina definitivamente' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(suspended).toHaveCount(0);
  await expect(active).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Famiglia Famiglia Sospesa eliminata definitivamente.');
  expect(deletions).toBe(2);
});
