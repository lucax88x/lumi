import { expect, test, type Page } from '@playwright/test';
import type { Message, WordImage, SentenceMap, DictionaryEntry, Conversation } from '../src/api/types.gen';
import spaceMap from './fixtures/space-map.json' with { type: 'json' };

const spaceQuestion = 'mi fai la mappa mentale con tutti i pianeti e i nomi stellari? tipo meteorite, asteroide, etc';

const rockImages: WordImage[] = [{ title: 'Roccia', imageUrl: 'https://upload.wikimedia.org/test.jpg', sourceUrl: 'https://it.wikipedia.org/wiki/Roccia', creditUrl: 'https://it.wikipedia.org/wiki/File:Rock.jpg' }];
const vigorousWord = { word: 'vigoroso', meaning: 'forte', example: 'Il bambino dà un calcio vigoroso al pallone.' };
const catMap: SentenceMap = { sentence: 'La gatta si accoccolò sul tappeto.', parts: [
  { text: 'La gatta', question: 'Chi?', explanation: 'Si parla di una gatta.' },
  { text: 'si accoccolò', question: 'Che cosa fa?', explanation: 'Si mise comoda, tutta raccolta.' },
  { text: 'sul tappeto.', question: 'Dove?', explanation: 'Sopra il tappeto.' },
] };

const dogWord = { word: 'dog', meaning: 'cane', example: 'The dog is happy.', exampleTranslation: 'Il cane è felice.', sourceWord: 'cane', sourceLanguage: 'it' as const };
const englishCatMap: SentenceMap = { sentence: 'The cat is on the mat.', language: 'en', translation: 'Il gatto è sul tappeto.', parts: [
  { text: 'The cat', translation: 'Il gatto', question: 'Chi?', explanation: 'Si parla del gatto.' },
  { text: 'is', translation: 'è', question: 'Che cosa fa?', explanation: 'Ci dice dove si trova.' },
  { text: 'on the mat.', translation: 'sul tappeto.', question: 'Dove?', explanation: 'Si trova sopra il tappeto.' },
] };
const animalsMap = { title: 'Gli animali', labelLanguage: 'en' as const, branches: [
  { label: 'Pets', explanation: 'Animali domestici.', items: [{ label: 'Dog', explanation: 'Cane.' }] },
  { label: 'Farm animals', explanation: 'Animali della fattoria.', items: [{ label: 'Cow', explanation: 'Mucca.' }] },
] };

async function mockAPI(page: Page, autoRead = false) {
  const chats: Conversation[] = [];
  const messages = new Map<string, Message[]>();
  const dictionary: DictionaryEntry[] = [];
  let authenticated = true;
  const settings = { model: 'test-model', prompt: 'Spiega una parola alla volta.', defaultPrompt: 'Spiega una parola alla volta.', autoRead, speechRate: 0.9 };
  const englishSettings = { ...settings, prompt: 'Aiuta con inglese in italiano.', defaultPrompt: 'Aiuta con inglese in italiano.' };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace(/^\/api\/v1(?:\/families\/test)?/, ''); const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/invitations') return json([]);
    if (path === '/dictionary') return json(dictionary);
    if (path === '/word-images') return json([]);
    if (path === '/status') return json({ ready: true, autoRead, speechRate: 0.9 });
    if (path === '/session') return json({ authenticated, portalAccess: authenticated, admin: true, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'La nostra famiglia', role: 'parent' }] });
    if (path === '/logout') { authenticated = false; return route.fulfill({ status: 204 }); }
    if (path.startsWith('/admin/') && !authenticated) return json({ message: 'Accedi' }, 401);
    if (path.startsWith('/admin/') && !['GET'].includes(method)) expect(request.headers()['x-csrf-token']).toBe('csrf-test');
    if (path.startsWith('/admin/dictionary') && method === 'DELETE') {
      const id = path.split('/')[3];
      if (id) { const index = dictionary.findIndex(word => word.id === id); if (index >= 0) dictionary.splice(index, 1); }
      else dictionary.splice(0);
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith('/admin/conversations') && method === 'DELETE') {
      const id = path.split('/')[3];
      if (id) { const index = chats.findIndex(chat => chat.id === id); if (index >= 0) chats.splice(index, 1); messages.delete(id); }
      else { chats.splice(0); messages.clear(); }
      return route.fulfill({ status: 204 });
    }
    if (path === '/admin/preview') {
      const message: Message = { id: 'preview', conversationId: '', role: 'assistant', status: 'completed', text: 'Ecco una roccia!', images: rockImages, createdAt: new Date().toISOString() };
      if (request.postDataJSON().text === catMap.sentence) {
        message.text = 'La gatta si mette comoda.'; message.images = []; message.sentenceMap = catMap;
      }
      if (request.postDataJSON().text === spaceQuestion) {
        message.text = 'Tocca un ramo per esplorare lo spazio.'; message.images = []; message.topicMap = spaceMap;
      }
      if (request.postDataJSON().text === 'vigoroso') {
        message.text = ''; message.images = []; message.wordExplanation = vigorousWord;
      }
      if (request.postDataJSON().subject === 'english') { message.text = ''; message.images = []; message.wordExplanation = dogWord; }
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'images', message: { ...message, text: '', status: 'streaming' } })}\n\ndata: ${JSON.stringify({ type: 'completed', message })}\n\n` });
    }
    if (path === '/admin/settings') { const selected = new URL(request.url()).searchParams.get('subject') === 'english' ? englishSettings : settings; if (method === 'PUT') Object.assign(selected, request.postDataJSON()); return json(selected); }
    if (path === '/admin/models') return json([{ slug: 'test-model', displayName: 'Modello di prova' }]);
    if (path === '/admin/connection') return json({ connected: true, email: 'parent@example.test', message: '', transcriptionConfigured: true });
    if (path === '/admin/connection/start') return json({ authorizationUrl: 'https://auth.openai.com/authorize?state=test', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    if (path === '/admin/connection/complete') return json({ connected: true, email: 'parent@example.test', message: '', transcriptionConfigured: true });
    if (path === '/admin/logout') { authenticated = false; return route.fulfill({ status: 204 }); }
    if (path === '/conversations' && method === 'GET') return json(chats);
    if (path === '/conversations' && method === 'POST') { const c = { subject: 'italian', ...request.postDataJSON(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; chats.unshift(c); messages.set(c.id, []); return json(c); }
    const match = path.match(/^\/conversations\/([^/]+)(\/messages)?$/);
    if (match) {
      const id = match[1]; const history = messages.get(id)!;
      if (method === 'GET') return json({ conversation: chats.find(c => c.id === id), messages: history });
      const body = request.postDataJSON(); const date = new Date().toISOString();
      const user = { id: `${body.requestId}-user`, conversationId: id, role: 'user', status: 'completed', text: body.action === 'simplify' ? 'Puoi spiegarmi questo pezzetto con parole più facili?' : body.text, createdAt: date };
      const answer: Message = { id: `${body.requestId}-assistant`, conversationId: id, role: 'assistant', status: 'completed', text: body.action === 'simplify' ? 'Proviamo con parole più semplici.' : 'Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.', createdAt: date };
      if (body.text === 'Me ne mostri una?') { answer.images = rockImages; answer.text = 'Ecco una roccia!'; }
      if (body.text === catMap.sentence) { answer.sentenceMap = catMap; answer.text = 'La gatta si mette comoda sul tappeto. Partiamo da «La gatta»: ci dice di chi parliamo.'; }
      if (body.text === spaceQuestion) { answer.topicMap = spaceMap; answer.text = 'Tocca un ramo per esplorare lo spazio.'; }
      if (body.text?.toLowerCase() === 'vigoroso' || body.text === 'Cosa significa vigoroso?' || (['simplify', 'example'].includes(body.action) && history.some(m => m.wordExplanation))) {
        answer.text = ''; answer.wordExplanation = { ...vigorousWord, example: body.action === 'example' ? 'Un albero vigoroso cresce in giardino.' : vigorousWord.example };
        const previous = dictionary.find(word => word.word === 'vigoroso');
        if (previous) Object.assign(previous, answer.wordExplanation, { lastAskedAt: date });
        else dictionary.unshift({ subject: 'italian', id: 'word-vigoroso', ...answer.wordExplanation, firstAskedAt: date, lastAskedAt: date });
      }
      if (chats.find(c => c.id === id)?.subject === 'english') {
        answer.text = body.text?.includes('Il pezzetto è') ? 'Questo pezzetto ci dice dove si trova il gatto: sopra il tappeto.' : 'Scopriamo l’inglese un pezzetto alla volta.';
        if (['Come si dice cane?', 'Cosa significa dog?'].includes(body.text)) {
          answer.text = ''; answer.wordExplanation = { ...dogWord, sourceWord: body.text.startsWith('Come') ? 'cane' : 'dog', sourceLanguage: body.text.startsWith('Come') ? 'it' : 'en' };
          const previous = dictionary.find(word => word.subject === 'english' && word.word === 'dog');
          if (previous) Object.assign(previous, answer.wordExplanation, { lastAskedAt: date });
          else dictionary.unshift({ subject: 'english', id: 'word-dog', ...answer.wordExplanation, firstAskedAt: date, lastAskedAt: date });
        }
        if (body.text === englishCatMap.sentence) { answer.sentenceMap = englishCatMap; answer.text = 'Il gatto è sul tappeto. Partiamo da chi si parla.'; }
        if (body.text === 'Mappa degli animali in inglese') { answer.topicMap = animalsMap; answer.text = 'Scegli un animale per scoprire il suo nome.'; }
      }
      history.push(user, answer);
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'started', message: { ...answer, wordExplanation: undefined, topicMap: undefined, sentenceMap: undefined, images: [], text: '', status: 'streaming' } })}\n\n${answer.wordExplanation ? `data: ${JSON.stringify({ type: 'word_explanation', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.topicMap ? `data: ${JSON.stringify({ type: 'topic_map', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.sentenceMap ? `data: ${JSON.stringify({ type: 'sentence_map', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.images ? `data: ${JSON.stringify({ type: 'images', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}data: ${JSON.stringify({ type: 'delta', delta: answer.text })}\n\ndata: ${JSON.stringify({ type: 'completed', message: answer })}\n\n` });
    }
    return json({ message: 'Not found' }, 404);
  });
  return { chats, messages, dictionary, settings, englishSettings };
}

async function openNavigation(page: Page) {
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
}

test('word cards survive reload, save one dictionary entry, and support practice', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/famiglie/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa significa vigoroso?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  const answer = page.locator('.message.assistant').last();
  await expect(answer.getByRole('region', { name: 'Significato', exact: true })).toHaveText(/Significato.*forte/);
  await expect(answer.getByRole('region', { name: 'Esempio', exact: true })).toContainText(vigorousWord.example);
  await expect(answer.getByRole('region', { name: 'Significato', exact: true })).toBeVisible();
  await expect(answer.getByRole('region', { name: 'Esempio', exact: true })).toBeVisible();
  await expect(answer.getByText('La risposta non è arrivata. Puoi riprovare.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/word-cards-${testInfo.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(answer.getByText('forte', { exact: true })).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('VIGOROSO');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  expect(api.dictionary).toHaveLength(1);
  await openNavigation(page);
  await page.getByRole('link', { name: 'Il mio dizionario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Il mio dizionario' })).toBeVisible();
  await page.getByRole('button', { name: /vigoroso.*Scoperta/ }).click();
  await expect(page.getByText(vigorousWord.example)).toBeVisible();
  await page.screenshot({ path: `test-results/dictionary-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Ripassiamo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'vigoroso', exact: true })).toBeVisible();
  await expect(page.getByText('forte', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostra il significato' }).click();
  await expect(page.getByText('forte', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/practice-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Da ripassare', exact: true }).click();
  await page.getByRole('button', { name: 'Ripassa ancora (1)' }).click();
  await expect(page.getByText('Parola 1 di 1')).toBeVisible();
  await page.getByRole('button', { name: 'Mostra il significato' }).click();
  await page.getByRole('button', { name: 'La ricordo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Un bel momento di ripasso!' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ripassiamo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ripassa ancora (1)' })).toHaveCount(0);
});

test('dictionary loading, retry, empty state, and search do not require generation', async ({ page }) => {
  await mockAPI(page);
  let ready = false;
  await page.route('**/api/v1/families/test/dictionary', async route => {
    if (!ready) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Non riesco a leggere le parole.' }) });
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.goto('/famiglie/test/dizionario');
  await expect(page.getByRole('alert')).toContainText('Non riesco a leggere le parole.');
  ready = true;
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByText('Le parole che chiedi a Lumi compariranno qui.')).toBeVisible();
  await page.route('**/api/v1/families/test/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready: false, autoRead: false, speechRate: 0.7 }) }));
  await page.reload();
  await expect(page.getByText('Le parole che chiedi a Lumi compariranno qui.')).toBeVisible();
});

test('parents can remove dictionary words independently from chats and previews', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/famiglie/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('vigoroso');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant .word-explanation')).toBeVisible();
  await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Parola o frase di prova').fill('vigoroso');
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.locator('.preview-result').getByText('forte', { exact: true })).toBeVisible();
  expect(api.dictionary).toHaveLength(1);
  await page.getByRole('tab', { name: 'Le sue scoperte' }).click();
  await page.getByRole('button', { name: 'Elimina tutto', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Le parole nel dizionario restano disponibili.');
  await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.getByText('Le prime domande compariranno qui.')).toBeVisible();
  expect(api.dictionary).toHaveLength(1);
  await page.getByRole('button', { name: 'Elimina la parola vigoroso' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.getByText('Non ci sono ancora parole salvate.')).toBeVisible();
  expect(api.dictionary).toHaveLength(0);
});

for (const role of ['parent', 'member'] as const) {
  test(`an unconfigured family hides chat until Lumi is ready (${role})`, async ({ page }, testInfo) => {
    await mockAPI(page);
    let ready = false; let chatRequests = 0;
    await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'La nostra famiglia', role }] }) }));
    await page.route('**/api/v1/families/test/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready, autoRead: false, speechRate: 0.9 }) }));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/conversations/') || path.endsWith('/transcribe') || (path.endsWith('/conversations') && request.method() === 'POST')) chatRequests++;
    });
    await page.goto('/famiglie/test');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fai una domanda' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Parla con Lumi' })).toHaveCount(0);
    await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/family-setup-${role}-${testInfo.project.name}.png`, fullPage: true });
    await expect(page.getByRole('link', { name: 'Apri Admin' })).toHaveCount(0);
    await expect(page.getByText('Un amministratore sta preparando Lumi. Il tuo angolino ti aspetta.')).toBeVisible();
    await page.goto('/famiglie/test/domande/saved');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    await expect(page.getByRole('log', { name: 'Conversazione con Lumi' })).toHaveCount(0);
    expect(chatRequests).toBe(0);
    await page.goto('/famiglie/test');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    ready = true;
    await page.getByRole('button', { name: 'Controlla se è pronta' }).click();
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
    await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire meraviglia?');
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    await expect(page.getByText('Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.')).toBeVisible();
  });
}

for (const path of ['/', '/famiglie/test']) {
  test(`an expired session at startup stops checking and reveals sign-in at ${path}`, async ({ page }, testInfo) => {
    await page.clock.install();
    let sessionRequests = 0;
    await page.route('**/api/v1/session', route => {
      sessionRequests++;
      // Bound traffic even if the regression keeps recreating the query.
      if (sessionRequests > 5) return route.abort('failed');
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Accedi a Lumi.' }) });
    });
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Accedi a Lumi', exact: true })).toBeVisible();
    await expect(page.locator('#lumi-splash')).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await page.clock.fastForward(180_000);
    await expect(page.getByRole('button', { name: 'Accedi a Lumi', exact: true })).toBeVisible();
    expect(sessionRequests).toBe(1);
    if (path === '/') await page.screenshot({ path: `test-results/session-ended-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('session expiry during polling stops subsequent checks', async ({ page }) => {
  await page.clock.install();
  await mockAPI(page);
  let expired = false; let sessionRequests = 0;
  await page.route('**/api/v1/session', route => {
    sessionRequests++;
    if (sessionRequests > 5) return route.abort('failed');
    if (!expired) return route.fallback();
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Accedi a Lumi.' }) });
  });
  await page.goto('/famiglie/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  expired = true;
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
  await page.clock.fastForward(180_000);
  expect(sessionRequests).toBe(2);
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
});

test('logout in another tab stops session polling', async ({ page }) => {
  await page.clock.install();
  await mockAPI(page);
  let sessionRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/session') sessionRequests++; });
  await page.goto('/famiglie/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await page.evaluate(() => { const channel = new BroadcastChannel('lumi-session'); channel.postMessage('logout'); channel.close(); });
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
  await page.clock.fastForward(180_000);
  expect(sessionRequests).toBe(1);
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
});

test('a question opens its own chat and follow-ups stay there', async ({ page }) => {
  const state = await mockAPI(page); await page.goto('/famiglie/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire meraviglia?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page).toHaveURL(/\/domande\//);
  await expect(page.getByText('Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.')).toBeVisible();
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  await expect(page.getByText('Proviamo con parole più semplici.')).toBeVisible();
  expect(state.chats).toHaveLength(1); expect(state.messages.get(state.chats[0].id)).toHaveLength(4);
  await page.getByRole('link', { name: 'Il mio angolino' }).last().click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Che cosa significa gentile?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByText('Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.')).toBeVisible();
  expect(state.chats).toHaveLength(2); expect(state.messages.get(state.chats[0].id)).toHaveLength(2);
});

test('global Admin connects ChatGPT and family parents keep teaching preferences', async ({ page }, testInfo) => {
  await mockAPI(page); await page.goto('/admin');
  const globalRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/connection')) globalRequests.push(new URL(request.url()).pathname); });
  await expect(page.getByText('parent@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ricollega ChatGPT', exact: true })).toBeEnabled();
  await page.screenshot({ path: `test-results/global-admin-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /(?:Collega|Ricollega) ChatGPT/ }).click();
  await expect(page.getByRole('link', { name: 'Apri il consenso ChatGPT' })).toBeVisible();
  await page.getByLabel('URL finale di ritorno').fill('http://127.0.0.1:1455/auth/callback?code=test&state=test');
  await page.getByRole('button', { name: 'Completa collegamento', exact: true }).click();
  await expect(page.getByText('Piano collegato per tutte le famiglie.')).toBeVisible();
  await page.getByRole('button', { name: 'Salva modello', exact: true }).click();
  await expect(page.getByText('Modello salvato per tutte le famiglie.')).toBeVisible();
  expect(globalRequests).toContain('/api/v1/admin/connection/complete');
  expect(globalRequests.every(path => !path.includes('/families/'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.goto('/famiglie/test/genitore');
  await expect(page.getByRole('button', { name: /(?:Collega|Ricollega) ChatGPT/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Istruzioni per Lumi').fill('Un esempio alla volta, con parole semplici.');
  await page.getByRole('button', { name: 'Salva istruzioni' }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue('Un esempio alla volta, con parole semplici.');
  await openNavigation(page);
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
});

test('family parents cannot open shared Admin controls', async ({ page }) => {
  await mockAPI(page);
  await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'La nostra famiglia', role: 'parent' }] }) }));
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/admin/')) requests.push(request.url()); });
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toHaveText('Questa parte è riservata agli amministratori.');
  await expect(page.getByRole('button', { name: /(?:Collega|Ricollega) ChatGPT/ })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('Admin keeps the family navbar and returns to the family it was opened from', async ({ page }, testInfo) => {
  await mockAPI(page);
  await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: true, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'other', name: 'Un’altra famiglia', role: 'parent' }, { id: 'test', name: 'La nostra famiglia', role: 'parent' }] }) }));
  await page.goto('/famiglie/test/genitore');
  await expect(page.getByRole('heading', { name: 'L’angolo del genitore' })).toBeVisible();
  await openNavigation(page);
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?family=test$/);
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.back-link')).toHaveText('Torna da Lumi');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/famiglie/test');
  await expect(page.locator('.portal-account')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/global-admin-navigation-${testInfo.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/famiglie/test');
  await openNavigation(page);
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveAttribute('href', '/famiglie/test');
  await expect(page.getByRole('link', { name: 'Angolo del genitore', exact: true })).toBeVisible();
  const closeMenu = page.getByRole('button', { name: 'Chiudi menu', exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.getByRole('link', { name: 'Torna da Lumi', exact: true }).click();
  await expect(page).toHaveURL(/\/famiglie\/test$/);
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
});

test('Admin navigation works without a family and makes no family requests', async ({ page }) => {
  await mockAPI(page);
  await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: true, email: 'user@example.test', csrfToken: 'csrf-test', families: [] }) }));
  const familyRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/families/')) familyRequests.push(request.url()); });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /(?:Collega|Ricollega) ChatGPT/ })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('link', { name: 'Le tue famiglie' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Angolo del genitore', exact: true })).toHaveCount(0);
  expect(familyRequests).toHaveLength(0);
});

test('home preserves its layout and account actions live in the sidebar', async ({ page }, testInfo) => {
  await mockAPI(page); await page.goto('/famiglie/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('UN PEZZETTO ALLA VOLTA', { exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Esci', exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Cambia famiglia' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/home-${testInfo.project.name}.png`, fullPage: true });
  await openNavigation(page);
  const account = page.getByRole('navigation', { name: 'Account e famiglia' });
  await expect(account.getByText('La nostra famiglia', { exact: true })).toBeVisible();
  await expect(account.getByText('user@example.test')).toBeVisible();
  await expect(account.getByRole('button', { name: 'Esci', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/sidebar-${testInfo.project.name}.png`, fullPage: true });
  await page.locator('.sidebar-bottom').last().screenshot({ path: `test-results/sidebar-account-${testInfo.project.name}.png` });
  await account.getByRole('link', { name: 'Cambia famiglia' }).click();
  await expect(page.getByRole('heading', { name: 'Le tue famiglie' })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('button', { name: 'Esci', exact: true })).toBeVisible();
  const closeMenu = page.getByRole('button', { name: 'Chiudi menu', exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.getByRole('link', { name: /La nostra famiglia/ }).click();
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('connection failures retain the written question', async ({ page }) => {
  await mockAPI(page);
  await page.route('**/api/v1/families/test/conversations/*/messages', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Il piano ChatGPT non è disponibile.' }) }));
  await page.goto('/famiglie/test'); await page.getByLabel('Scrivi una parola o una frase').fill('Che cosa vuol dire prato?'); await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByRole('alert')).toContainText('Il piano ChatGPT non è disponibile.');
  await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveValue('Che cosa vuol dire prato?');
});

test('HTML splash is visible before JavaScript runs', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.getByRole('status')).toHaveText('Un attimo, arriva Lumi…');
    await expect(page.locator('#lumi-splash')).toBeVisible();
    await expect(page.locator('#root')).toBeHidden();
  } finally { await context.close(); }
});

for (const connected of [true, false]) {
  test(`HTML splash waits for the first connection check (${connected ? 'success' : 'failure'})`, async ({ page }, testInfo) => {
    await mockAPI(page);
    let finishCheck!: () => void;
    const check = new Promise<void>(resolve => { finishCheck = resolve; });
    await page.route('**/api/v1/families/test/status', async route => {
      await check;
      return route.fulfill({ status: connected ? 200 : 503, contentType: 'application/json', body: JSON.stringify(connected ? { ready: true, autoRead: false, speechRate: 0.9 } : { message: 'Unavailable' }) });
    });
    await page.goto('/famiglie/test');
    const splash = page.locator('#lumi-splash');
    await expect(splash).toBeVisible();
    // React has rendered, but the application remains hidden during the check.
    await expect(page.locator('.app-shell')).toBeAttached();
    await expect(page.getByLabel('Scrivi una parola o una frase')).toBeHidden();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    if (connected) await page.screenshot({ path: `test-results/splash-${testInfo.project.name}.png` });
    finishCheck();
    await expect(splash).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.getByRole('heading', { name: connected ? 'Che cosa scopriamo oggi?' : 'Non riesco a raggiungere Lumi.' })).toBeVisible();
    if (connected) {
      const menu = page.getByRole('button', { name: 'Apri menu' });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('link', { name: 'Angolo del genitore' }).last().click();
      await expect(page.getByRole('heading', { name: 'L’angolo del genitore' })).toBeVisible();
      await expect(splash).toHaveCount(0);
    }
  });
}

test('unreachable Lumi shows a full-screen error until retry succeeds', async ({ page }, testInfo) => {
  await mockAPI(page);
  let recover = false;
  let finishRetry: (() => void) | undefined;
  await page.route('**/api/v1/families/test/status', async route => {
    if (!recover) return route.abort('connectionfailed');
    await new Promise<void>(resolve => { finishRetry = resolve; });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready: true, autoRead: false, speechRate: 0.9 }) });
  });
  await page.goto('/famiglie/test');
  const heading = page.getByRole('heading', { name: 'Non riesco a raggiungere Lumi.' });
  await expect(heading).toBeVisible();
  await expect(page.locator('#lumi-splash')).toHaveCount(0);
  await expect(page.getByText('Controlla la connessione e riprova.')).toBeVisible();
  await expect(page.getByRole('navigation')).toBeHidden();
  await expect(page.getByLabel('Scrivi una parola o una frase')).toBeHidden();
  const screen = (await page.getByRole('main').boundingBox())!;
  expect(screen.x).toBe(0); expect(screen.y).toBe(0);
  expect(screen.width).toBe(page.viewportSize()!.width);
  expect(screen.height).toBeGreaterThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: `test-results/connection-error-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Riprovo…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Riprova', exact: true })).toBeEnabled();
  await expect(heading).toBeVisible();
  recover = true;
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Riprovo…' })).toBeDisabled();
  await expect(heading).toBeVisible();
  await expect.poll(() => Boolean(finishRetry)).toBe(true);
  finishRetry!();
  await expect(heading).toBeHidden();
  await expect(page.getByLabel('Scrivi una parola o una frase')).toBeVisible();
});

test('going offline hides the page and preserves the draft on reconnect', async ({ page, context }) => {
  await mockAPI(page); await page.goto('/famiglie/test');
  const question = page.getByLabel('Scrivi una parola o una frase');
  await question.fill('Che cosa vuol dire prato?');
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'Non riesco a raggiungere Lumi.' })).toBeVisible();
  await expect(question).toBeHidden();
  await context.setOffline(false);
  await expect(question).toBeVisible();
  await expect(question).toHaveValue('Che cosa vuol dire prato?');
});

test.describe('installed PWA shell', () => {
  test.use({ serviceWorkers: 'allow' });
  test('caches only static assets and opens offline', async ({ page, context }) => {
    await mockAPI(page); await page.goto('/famiglie/test');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const paths = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat();
    });
    expect(paths).not.toContain('/');
    expect(paths.some(path => path.startsWith('/famiglie/'))).toBe(false);
    expect(paths).toContain('/icon-192.png');
    expect(paths.some(path => path.startsWith('/api/'))).toBe(false);
    await page.unrouteAll();
    await context.setOffline(true); await page.reload();
    await expect(page.getByRole('heading', { name: 'Lumi ha bisogno della connessione' })).toBeVisible();
    await expect(page.locator('#lumi-splash')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeHidden();
  });
});

for (const width of [320, 375, 390]) {
  test(`chat actions occupy separate full rows at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await mockAPI(page); await page.goto('/famiglie/test');
    await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire arcobaleno?');
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    const actions = page.locator('.followups');
    await expect(actions).toBeVisible();
    const parent = (await actions.boundingBox())!;
    const boxes = await actions.locator('button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, top: button.getBoundingClientRect().top, height: button.getBoundingClientRect().height })));
    expect(boxes).toHaveLength(2);
    boxes.forEach((box, index) => {
      expect(Math.abs(box.width - parent.width)).toBeLessThan(1);
      expect(box.height).toBeGreaterThanOrEqual(48);
      if (index) expect(box.top - boxes[index - 1].top - boxes[index - 1].height).toBeCloseTo(8, 0);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: `test-results/chat-mobile-${testInfo.project.name}.png`, fullPage: true });
  });
}

for (const automatic of [true, false]) {
  test(`voice control stays in the active answer (${automatic ? 'automatic' : 'manual'})`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} } });
      const voice = { voiceURI: 'it', lang: 'it-IT', localService: true };
      const state = window as unknown as { activeUtterance?: SpeechSynthesisUtterance };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => [voice], addEventListener() {}, removeEventListener() {},
        cancel() { state.activeUtterance = undefined; },
        speak(utterance: SpeechSynthesisUtterance) { state.activeUtterance = utterance; queueMicrotask(() => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)); },
      } });
    });
    await mockAPI(page, automatic); await page.goto('/famiglie/test');
    await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire arcobaleno?');
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    const answer = page.locator('.message.assistant').last();
    if (!automatic) await answer.getByRole('button', { name: 'Riascolta' }).click();
    await expect(answer.getByRole('button', { name: 'Ferma la voce' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ferma la voce' })).toHaveCount(1);
    await answer.getByRole('button', { name: 'Ferma la voce' }).click();
    await expect(answer.getByRole('button', { name: 'Riascolta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ferma la voce' })).toHaveCount(0);
  });
}

test('requested images belong to the answer and survive reload', async ({ page }) => {
  await mockAPI(page);
  let searches = 0;
  await page.route('**/api/v1/families/test/word-images?*', route => { searches++; return route.fulfill({ contentType: 'application/json', body: '[]' }); });
  await page.route('https://upload.wikimedia.org/test.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="gray" width="100" height="100"/></svg>' }));
  await page.goto('/famiglie/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cos’è una roccia?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Immagini di esempio' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mostrami un|Cerca altre immagini/ })).toHaveCount(0);
  await page.getByLabel('Scrivi una parola o una frase').fill('Me ne mostri una?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  const answer = page.locator('.message.assistant').last();
  await expect(answer.getByRole('img', { name: 'Roccia' })).toBeVisible();
  await expect(answer.getByRole('link', { name: 'Fonte, autore e licenza' })).toHaveAttribute('href', rockImages[0].creditUrl);
  await expect(page.locator('.message.assistant').first().getByRole('img')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.message.assistant').last().getByRole('img', { name: 'Roccia' })).toBeVisible();
  expect(searches).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('parent preview displays image tool results', async ({ page }) => {
  await mockAPI(page);
  await page.route('https://upload.wikimedia.org/test.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' }));
  await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Parola o frase di prova').fill('Mostrami una roccia');
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.locator('.preview-result').getByRole('img', { name: 'Roccia' })).toBeVisible();
  await expect(page.locator('.preview-result')).toContainText('Ecco una roccia!');
});

test('sentence maps open one piece at a time, guide follow-ups and survive reload', async ({ page }, testInfo) => {
  const state = await mockAPI(page); await page.goto('/famiglie/test');
  await page.getByLabel('Scrivi una parola o una frase').fill(catMap.sentence);
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  const map = page.getByRole('region', { name: 'Mappa della frase' });
  await expect(map).toBeVisible();
  await expect(map.getByText(catMap.sentence, { exact: true })).toBeVisible();
  await expect(map.getByRole('listitem')).toHaveCount(3);
  await expect(map.getByText(catMap.parts[0].explanation)).toBeVisible();
  await expect(map.getByText(catMap.parts[1].explanation)).toBeHidden();
  const action = map.getByRole('button', { name: /Che cosa fa/ });
  await action.focus(); await page.keyboard.press('Enter');
  await expect(action).toHaveAttribute('aria-expanded', 'true');
  await expect(map.getByText(catMap.parts[1].explanation)).toBeVisible();
  await expect(map.getByText(catMap.parts[0].explanation)).toBeHidden();
  await expect(map.getByRole('button', { name: 'Ascolta il pezzetto' })).toBeVisible();
  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/sentence-map-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  await expect.poll(() => state.messages.get(state.chats[0].id)?.length).toBe(4);
  expect(state.messages.get(state.chats[0].id)![2].text).toContain('Il pezzetto è «si accoccolò»');
  await page.reload();
  await expect(map).toHaveCount(1);
  await expect(map.getByRole('listitem')).toHaveCount(3);
  await page.setViewportSize({ width: 320, height: 850 });
  await expect(map.getByRole('button', { name: /Dove/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Le sue scoperte' }).click();
  await page.locator('.history-table').getByRole('button', { name: new RegExp(catMap.sentence) }).first().click();
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Mappa della frase' })).toBeVisible();
});

test('parent preview shows the sentence map', async ({ page }) => {
  await mockAPI(page); await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Parola o frase di prova').fill(catMap.sentence);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  const map = page.getByRole('region', { name: 'Mappa della frase' });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: /Dove/ }).click();
  await expect(map.getByText('Sopra il tappeto.')).toBeVisible();
});

test('explicit topic maps show all planets, expand gradually and preserve selected context', async ({ page }, testInfo) => {
  const state = await mockAPI(page); await page.goto('/famiglie/test');
  await page.getByLabel('Scrivi una parola o una frase').fill(spaceQuestion);
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  const map = page.getByRole('region', { name: 'Mappa dell’argomento' });
  await expect(map).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mappa della frase' })).toHaveCount(0);
  await expect(map.getByText(spaceMap.title, { exact: true })).toBeVisible();
  const planets = map.getByRole('button', { name: 'I pianeti', exact: true });
  await expect(planets).toHaveAttribute('aria-expanded', 'false');
  await planets.focus(); await page.keyboard.press('Enter');
  for (const name of ['Mercurio', 'Venere', 'Terra', 'Marte', 'Giove', 'Saturno', 'Urano', 'Nettuno']) {
    await expect(map.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await map.getByRole('button', { name: 'Marte', exact: true }).click();
  await expect(map.getByText('È chiamato pianeta rosso.')).toBeVisible();
  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/topic-map-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  await expect.poll(() => state.messages.get(state.chats[0].id)?.length).toBe(4);
  expect(state.messages.get(state.chats[0].id)![2].text).toContain('Il punto è «Marte», nel ramo «I pianeti»');
  await page.reload();
  await expect(map).toHaveCount(1);
  await map.getByRole('button', { name: 'Piccoli corpi e fenomeni', exact: true }).click();
  await map.getByRole('button', { name: 'Meteorite', exact: true }).click();
  await expect(map.getByText('È un frammento che arriva fino al suolo.')).toBeVisible();
  await expect(map.getByRole('button', { name: 'Marte', exact: true })).toBeHidden();
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Le sue scoperte' }).click();
  await page.locator('.history-table').getByRole('button').first().click();
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Mappa dell’argomento' })).toBeVisible();
});

test('parent preview shows a topic map and clears it for the next example', async ({ page }) => {
  await mockAPI(page); await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Parola o frase di prova').fill(spaceQuestion);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  const map = page.getByRole('region', { name: 'Mappa dell’argomento' });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Le stelle', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Sole', exact: true })).toBeVisible();
  await page.getByLabel('Parola o frase di prova').fill(catMap.sentence);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.getByRole('region', { name: 'Mappa della frase' })).toBeVisible();
  await expect(map).toHaveCount(0);
});


test('English cards retain their subject after reload and share a separate dictionary entry across directions', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/famiglie/test');
  await expect(page.getByRole('button', { name: 'Italiano', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Matematica', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inglese', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Come si dice cane?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.word-heading')).toHaveText('dog');
  await expect(page.locator('.example-translation')).toHaveText('Il cane è felice.');
  expect(api.chats[0].subject).toBe('english');
  await page.reload();
  await expect(page.locator('.conversation-heading')).toContainText('Inglese');
  await expect(page.locator('.word-heading')).toHaveText('dog');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa significa dog?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.word-heading')).toHaveCount(2);
  expect(api.dictionary).toHaveLength(1);
  await page.screenshot({ path: `test-results/english-cards-${testInfo.project.name}.png`, fullPage: true });
  await openNavigation(page);
  await page.getByRole('link', { name: 'Il mio dizionario', exact: true }).click();
  await expect(page.getByText('Le parole che chiedi a Lumi compariranno qui.')).toBeVisible();
  await page.getByRole('button', { name: 'Inglese', exact: true }).click();
  await page.getByRole('searchbox').fill('cane');
  await page.getByRole('button', { name: 'Ripassiamo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'dog', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mostra il significato' }).click();
  await expect(page.getByText('Il cane è felice.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('English sentence and topic maps keep translations and selected follow-up context', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/famiglie/test');
  await page.getByRole('button', { name: 'Inglese', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill(englishCatMap.sentence);
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.sentence-translation')).toHaveText('Il gatto è sul tappeto.');
  await page.getByRole('button', { name: /Dove.*on the mat/ }).click();
  await expect(page.getByText('Si trova sopra il tappeto.')).toBeVisible();
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('on the mat.');
  await page.getByLabel('Scrivi una parola o una frase').fill('Mappa degli animali in inglese');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await page.getByRole('button', { name: 'Pets', exact: true }).click();
  await page.getByRole('button', { name: 'Dog', exact: true }).click();
  await expect(page.getByText('Cane.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/english-maps-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('parents edit and preview English instructions independently from Italian', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/famiglie/test/genitore');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.settings.prompt);
  await page.getByRole('button', { name: 'Inglese', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.englishSettings.prompt);
  await page.getByLabel('Istruzioni per Lumi').fill('Usa esempi inglesi molto brevi.');
  await page.getByRole('button', { name: 'Salva istruzioni', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Istruzioni salvate.');
  expect(api.settings.prompt).toBe('Spiega una parola alla volta.');
  expect(api.englishSettings.prompt).toBe('Usa esempi inglesi molto brevi.');
  await page.getByLabel('Parola o frase di prova').fill('Come si dice cane?');
  await page.getByRole('button', { name: 'Prova le istruzioni', exact: true }).click();
  await expect(page.locator('.preview-result .word-heading')).toHaveText('dog');
  expect(api.dictionary).toHaveLength(0);
  await page.getByRole('button', { name: 'Ripristina il testo iniziale', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.englishSettings.defaultPrompt);
  await page.getByRole('button', { name: 'Italiano', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.settings.prompt);
});
