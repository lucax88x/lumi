import { expect, test, type Page } from '@playwright/test';
import type { Message, WordImage, SentenceMap, DictionaryEntry, Conversation, WordClarification, WordExplanation, LearningVisual, StudyClarification } from '../src/api/types.gen';
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

const clarificationCases: { subject: 'italian' | 'english'; question: string; clarification: WordClarification; words: WordExplanation[] }[] = [
  {
    subject: 'italian', question: 'Cosa significa formato?',
    clarification: { word: 'formato', language: 'it', question: 'Mi scrivi o mi dici la frase in cui hai trovato “formato”?', examples: [
      { sentence: 'Il formato del foglio è A4.', meaning: 'La forma e le dimensioni del foglio.' },
      { sentence: 'Il gruppo è formato da tre persone.', meaning: 'Il gruppo è composto da tre persone.' },
    ] },
    words: [
      { word: 'formato', meaning: 'La forma e le dimensioni.', example: 'Il formato del foglio è A4.' },
      { word: 'formato', meaning: 'composto', example: 'Il gruppo è formato da tre persone.' },
    ],
  },
  {
    subject: 'english', question: 'Cosa significa bank?',
    clarification: { word: 'bank', language: 'en', question: 'In quale frase hai trovato “bank”?', examples: [
      { sentence: 'I go to the bank.', meaning: 'La banca dove si tengono i soldi.' },
      { sentence: 'I sit on the river bank.', meaning: 'La riva del fiume.' },
    ] },
    words: [
      { word: 'bank', meaning: 'banca', example: 'I go to the bank.', exampleTranslation: 'Vado in banca.', sourceWord: 'bank', sourceLanguage: 'en' },
      { word: 'bank', meaning: 'riva', example: 'I sit on the river bank.', exampleTranslation: 'Mi siedo sulla riva del fiume.', sourceWord: 'bank', sourceLanguage: 'en' },
    ],
  },
  {
    subject: 'english', question: 'Come si dice pesca?',
    clarification: { word: 'pesca', language: 'it', question: 'Mi dici una frase con “pesca”?', examples: [
      { sentence: 'Mangio una pesca.', meaning: 'Il frutto.' },
      { sentence: 'La pesca è il mio passatempo.', meaning: 'L’attività di prendere i pesci.' },
    ] },
    words: [
      { word: 'peach', meaning: 'pesca, il frutto', example: 'I eat a peach.', exampleTranslation: 'Mangio una pesca.', sourceWord: 'pesca', sourceLanguage: 'it' },
      { word: 'fishing', meaning: 'pesca, prendere i pesci', example: 'I like fishing.', exampleTranslation: 'Mi piace pescare.', sourceWord: 'pesca', sourceLanguage: 'it' },
    ],
  },
];

const egyptFocus: StudyClarification = { topic: 'Gli Egiziani', question: 'Che cosa vuoi scoprire degli Egiziani?', choices: [
  { label: 'Il Nilo', reply: 'Il Nilo' }, { label: 'Le piramidi', reply: 'Le piramidi' }, { label: 'La vita quotidiana', reply: 'La vita quotidiana' },
] };
const angleVisual: LearningVisual = { kind: 'geometry', title: 'L’angolo retto', summary: 'Si apre come un angolo del quaderno.', figures: [
  { shape: 'angle', label: 'Angolo retto', degrees: 90, explanation: 'Prova a guardare un angolo del tuo quaderno.' },
] };
const waterVisual: LearningVisual = { kind: 'diagram', title: 'Il ciclo dell’acqua', summary: 'L’acqua fa un giro e ricomincia.', layout: 'cycle', nodes: [
  { id: 'sun', label: 'Il Sole scalda', explanation: 'L’acqua sale come vapore.', symbol: 'sun' },
  { id: 'cloud', label: 'Le nuvole', explanation: 'Si formano piccole gocce.', symbol: 'cloud' },
  { id: 'rain', label: 'La pioggia', explanation: 'Le gocce cadono sulla terra.', symbol: 'rain' },
], edges: [{ from: 'sun', to: 'cloud' }, { from: 'cloud', to: 'rain' }, { from: 'rain', to: 'sun' }] };
const nileVisual: LearningVisual = { kind: 'map', title: 'Il Nilo', summary: 'Un fiume importante per gli Egiziani.', datasetVersion: 'ne-v1', features: [
  { id: 'rivers-4', label: 'Il Nilo', explanation: 'L’acqua del fiume aiutava a coltivare i campi.' },
] };
const creteVisual: LearningVisual = { kind: 'map', title: 'Creta', summary: 'L’isola dove vivevano i Cretesi.', datasetVersion: 'ne-v1', features: [
  { id: 'islands-1159102805', label: 'Creta', explanation: 'Un’isola nel Mar Mediterraneo.' },
] };
const continentsVisual: LearningVisual = { kind: 'map', title: 'I continenti', summary: 'Le grandi terre del mondo.', datasetVersion: 'ne-v2', view: 'world', features: [
  { id: 'continents-africa', label: 'Africa', explanation: 'Si trova a sud dell’Europa, fra due grandi oceani.' },
  { id: 'continents-america', label: 'America', explanation: 'Si allunga da nord a sud, fra Atlantico e Pacifico.' },
  { id: 'continents-antarctica', label: 'Antartide', explanation: 'Si trova intorno al Polo Sud, in fondo alla cartina.' },
  { id: 'continents-asia', label: 'Asia', explanation: 'Si trova a est dell’Europa.' },
  { id: 'continents-europe', label: 'Europa', explanation: 'Si trova a nord dell’Africa. Qui c’è anche l’Italia.' },
  { id: 'continents-oceania', label: 'Oceania', explanation: 'Comprende l’Australia, la Nuova Zelanda e tante isole nel Pacifico.' },
] };
const cretanMap = { title: 'La vita dei Cretesi', branches: [
  { label: 'Dove vivevano', explanation: 'Vivevano sull’isola di Creta.', items: [{ label: 'Creta', explanation: 'Un’isola nel Mar Mediterraneo.' }] },
  { label: 'Che cosa facevano', explanation: 'Coltivavano e viaggiavano sul mare.', items: [{ label: 'Le navi', explanation: 'Portavano merci in altri luoghi.' }] },
] };
function studyMockAnswer(text: string, history: Message[]): Partial<Message> | undefined {
  if (text === 'I continenti' || text === 'Mostrami i continenti e dove si trovano' || text === 'Intendevo una cartina') return { text: 'Tocca un continente per scoprire dove si trova', learningVisual: continentsVisual };
  if (text === 'Gli Egiziani') return { text: '', studyClarification: egyptFocus };
  if (text === 'I Cretesi') return { text: '', studyClarification: { topic: 'I Cretesi', question: 'Che cosa vuoi scoprire dei Cretesi?', choices: [{ label: 'Dove vivevano', reply: 'Dove vivevano i Cretesi' }, { label: 'La loro vita', reply: 'La vita dei Cretesi' }] } };
  if (text === 'I tipi di angoli') return { text: '', studyClarification: { topic: 'Gli angoli', question: 'Hai già i nomi degli angoli che stai studiando?', choices: [{ label: 'Ti dico i nomi', reply: 'Ti dico i nomi degli angoli' }, { label: 'Una prima scoperta', reply: 'Una prima scoperta degli angoli' }] } };
  if (text.includes('Non lo so. Aiutami')) return { text: 'Gli Egiziani vivevano vicino al Nilo. Partiamo da questa piccola scoperta.' };
  if (text === 'Spiegami l’angolo retto' || text.includes('Una prima scoperta degli angoli')) return { text: '', learningVisual: angleVisual };
  if (text.includes('Il Nilo') && !text.includes('punto selezionato')) return { text: '', learningVisual: nileVisual };
  if (text.includes('Dove vivevano i Cretesi')) return { text: '', learningVisual: creteVisual };
  if (text.includes('La vita dei Cretesi')) return { text: 'Tocca un ramo per iniziare.', topicMap: cretanMap };
  if (text === 'Come funziona il ciclo dell’acqua?') return { text: '', learningVisual: waterVisual };
  if (text.includes('Il punto selezionato è')) return { text: 'Restiamo sul punto che hai scelto e guardiamo un esempio semplice.' };
  if (history.some(message => message.learningVisual) && !text) return { text: 'Facciamo un piccolo passo avanti.' };
  return undefined;
}

async function mockAPI(page: Page, autoRead = false) {
  const chats: Conversation[] = [];
  const messages = new Map<string, Message[]>();
  const dictionary: DictionaryEntry[] = [];
  let authenticated = true;
  const settings = { model: 'test-model', prompt: 'Spiega una parola alla volta.', defaultPrompt: 'Spiega una parola alla volta.', autoRead, speechRate: 0.9 };
  const englishSettings = { ...settings, prompt: 'Aiuta con inglese in italiano.', defaultPrompt: 'Aiuta con inglese in italiano.' };
  const studySettings = Object.fromEntries(['history', 'geography', 'science', 'geometry'].map(subject => [subject, { ...settings, prompt: `Studiamo ${subject}.`, defaultPrompt: `Studiamo ${subject}.` }]));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace(/^\/api\/v1(?:\/families\/test)?/, ''); const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/invitations' || path === '/admin/access-requests') return json([]);
    if (path === '/dictionary') return json(dictionary);
    if (path === '/word-images') return json([]);
    if (path === '/status') return json({ ready: true, autoRead, speechRate: 0.9 });
    if (path === '/session') return json({ authenticated, portalAccess: authenticated, admin: true, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'Il nostro spazio', role: 'parent' }] });
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
      const studyAnswer = studyMockAnswer(request.postDataJSON().text, []); if (studyAnswer) { message.text = ''; message.images = []; Object.assign(message, studyAnswer); }
      const contextCase = clarificationCases.find(item => item.question === request.postDataJSON().text);
      if (contextCase) { message.text = ''; message.images = []; message.wordExplanation = undefined; message.wordClarification = { ...contextCase.clarification, examples: [] }; }
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'images', message: { ...message, text: '', status: 'streaming' } })}\n\ndata: ${JSON.stringify({ type: 'completed', message })}\n\n` });
    }
    if (path === '/admin/settings') { const subject = new URL(request.url()).searchParams.get('subject') ?? 'italian'; const selected = subject === 'english' ? englishSettings : studySettings[subject] ?? settings; if (method === 'PUT') Object.assign(selected, request.postDataJSON()); return json(selected); }
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
      const contextCase = clarificationCases.find(item => item.question === body.text);
      const pendingContext = history.at(-1)?.wordClarification;
      if (contextCase) {
        answer.text = ''; answer.wordClarification = { ...contextCase.clarification, examples: [] };
      } else if (pendingContext) {
        const item = clarificationCases.find(item => item.clarification.word === pendingContext.word)!;
        answer.text = '';
        if (body.text.startsWith('Non ho una frase')) answer.wordClarification = item.clarification;
        else if (body.text === 'Nessuno di questi.') answer.text = 'Questa parola ha più significati. Può indicare cose diverse: quando trovi una frase, possiamo capirla insieme.';
        else {
          const selected = body.text.includes(item.clarification.examples[1].sentence) ? 1 : 0;
          answer.wordExplanation = item.words[selected];
          dictionary.unshift({ subject: item.subject, id: `context-${pendingContext.word}`, ...answer.wordExplanation, firstAskedAt: date, lastAskedAt: date });
        }
      }
      const subject = chats.find(c => c.id === id)?.subject;
      if (subject && ['history', 'geography', 'science', 'geometry'].includes(subject)) Object.assign(answer, studyMockAnswer(body.text, history));
      history.push(user, answer);
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'started', message: { ...answer, studyClarification: undefined, learningVisual: undefined, wordClarification: undefined, wordExplanation: undefined, topicMap: undefined, sentenceMap: undefined, images: [], text: '', status: 'streaming' } })}\n\n${answer.studyClarification ? `data: ${JSON.stringify({ type: 'study_clarification', message: { ...answer, status: 'streaming' } })}\n\n` : ''}${answer.learningVisual ? `data: ${JSON.stringify({ type: 'learning_visual', message: { ...answer, status: 'streaming' } })}\n\n` : ''}${answer.wordClarification ? `data: ${JSON.stringify({ type: 'word_clarification', message: { ...answer, status: 'streaming' } })}\n\n` : ''}${answer.wordExplanation ? `data: ${JSON.stringify({ type: 'word_explanation', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.topicMap ? `data: ${JSON.stringify({ type: 'topic_map', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.sentenceMap ? `data: ${JSON.stringify({ type: 'sentence_map', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}${answer.images ? `data: ${JSON.stringify({ type: 'images', message: { ...answer, text: '', status: 'streaming' } })}\n\n` : ''}data: ${JSON.stringify({ type: 'delta', delta: answer.text })}\n\ndata: ${JSON.stringify({ type: 'completed', message: answer })}\n\n` });
    }
    return json({ message: 'Not found' }, 404);
  });
  return { chats, messages, dictionary, settings, englishSettings, studySettings };
}

// Capture the card on its own so fixed chat controls do not cover the review image.
async function captureStudyVisual(page: Page, path: string) {
  const markup = await page.locator('.learning-visual').last().evaluate(element => element.outerHTML);
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  const preview = await page.context().newPage();
  try {
    const viewport = page.viewportSize();
    if (viewport) await preview.setViewportSize(viewport);
    await preview.setContent(`<html lang="it"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<style>body{margin:0;padding:16px}.message{margin:0;width:100%;box-sizing:border-box}.learning-visual{margin:0}</style></head><body><article class="message assistant">${markup}</article></body></html>`);
    await preview.evaluate(() => document.fonts.ready);
    await preview.locator('.message').screenshot({ path });
  } finally { await preview.close(); }
}

async function openNavigation(page: Page) {
  const menu = page.getByRole('button', { name: 'Apri menu' });
  if (await menu.isVisible()) await menu.click();
}

for (const item of clarificationCases) {
  test(`word context for ${item.clarification.word} resumes after reload and selects the intended meaning`, async ({ page }, testInfo) => {
    const api = await mockAPI(page);
    await page.goto('/spazi/test');
    if (item.subject === 'english') await page.getByRole('radio', { name: 'Inglese', exact: true }).click();
    await page.getByLabel('Scrivi una parola o una frase').fill(item.question);
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    const clarification = page.getByRole('region', { name: `Il contesto di ${item.clarification.word}` }).last();
    await expect(clarification).toContainText(item.clarification.question);
    await expect(page.getByRole('button', { name: 'Non ho una frase', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Più facile', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fammi un esempio', exact: true })).toHaveCount(0);
    await expect(page.locator('.word-explanation')).toHaveCount(0);
    await expect(page.getByText('La risposta non è arrivata. Puoi riprovare.')).toHaveCount(0);
    expect(api.dictionary).toHaveLength(0);
    await page.reload();
    await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveAttribute('placeholder', `Scrivi la frase con «${item.clarification.word}»…`);
    await page.getByRole('button', { name: 'Non ho una frase', exact: true }).click();
    const choice = page.getByRole('button', { name: item.clarification.examples[1].sentence });
    await expect(choice).toBeVisible();
    expect(api.dictionary).toHaveLength(0);
    await page.screenshot({ path: `test-results/word-context-${item.clarification.word}-${testInfo.project.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(choice).toBeVisible();
    await choice.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.word-heading')).toHaveText(item.words[1].word);
    await expect(page.locator('.word-card-meaning > p')).toHaveText(item.words[1].meaning);
    await expect(page.locator('.sentence-map')).toHaveCount(0);
    await expect(choice).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Più facile', exact: true })).toBeVisible();
    expect(api.dictionary).toHaveLength(1);
    expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toBe(`Per «${item.clarification.word}», intendo questo esempio: «${item.clarification.examples[1].sentence}»`);
    await page.reload();
    await expect(page.locator('.word-heading')).toHaveText(item.words[1].word);
    await expect(choice).toHaveCount(0);
  });
}

test('word context accepts a typed sentence without starting a sentence map', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa significa formato?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByRole('button', { name: 'Non ho una frase', exact: true })).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('Il formato del foglio è A4.');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.word-card-meaning > p')).toHaveText('La forma e le dimensioni.');
  await expect(page.getByRole('region', { name: 'Mappa della frase' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Non ho una frase', exact: true })).toHaveCount(0);
  expect(api.dictionary).toHaveLength(1);
});

test('word context allows rejecting all examples without saving an arbitrary meaning', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa significa formato?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await page.getByRole('button', { name: 'Non ho una frase', exact: true }).click();
  await expect(page.getByRole('button', { name: /Il formato del foglio è A4/ })).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('Nessuno di questi.');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('Questa parola ha più significati.');
  expect(api.dictionary).toHaveLength(0);
  await expect(page.locator('.word-explanation')).toHaveCount(0);
});

test('word context is visible in coach previews and clears on the next preview', async ({ page }) => {
  await mockAPI(page);
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Domanda di prova').fill('Cosa significa formato?');
  await page.getByRole('button', { name: 'Prova le istruzioni', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Il contesto di formato' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Non ho una frase', exact: true })).toHaveCount(0);
  await page.getByLabel('Domanda di prova').fill('vigoroso');
  await page.getByRole('button', { name: 'Prova le istruzioni', exact: true }).click();
  await expect(page.locator('.word-heading')).toHaveText('vigoroso');
  await expect(page.getByRole('region', { name: 'Il contesto di formato' })).toHaveCount(0);
});

test('word cards survive reload, save one dictionary entry, and support practice', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
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
  await expect(answer.getByRole('region', { name: 'Significato', exact: true })).toBeInViewport({ ratio: 1 });
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
  await page.goto('/spazi/test/dizionario');
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
  await page.goto('/spazi/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('vigoroso');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant .word-explanation')).toBeVisible();
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Domanda di prova').fill('vigoroso');
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.locator('.preview-result').getByText('forte', { exact: true })).toBeVisible();
  expect(api.dictionary).toHaveLength(1);
  await page.getByRole('tab', { name: 'Scoperte dello spazio' }).click();
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
    await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'Il nostro spazio', role }] }) }));
    await page.route('**/api/v1/families/test/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready, autoRead: false, speechRate: 0.9 }) }));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/conversations/') || path.endsWith('/transcribe') || (path.endsWith('/conversations') && request.method() === 'POST')) chatRequests++;
    });
    await page.goto('/spazi/test');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fai una domanda' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Parla con Lumi' })).toHaveCount(0);
    await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/family-setup-${role}-${testInfo.project.name}.png`, fullPage: true });
    await expect(page.getByRole('link', { name: 'Apri Admin' })).toHaveCount(0);
    await expect(page.getByText('Un amministratore sta preparando Lumi. Il tuo angolino ti aspetta.')).toBeVisible();
    await page.goto('/spazi/test/domande/saved');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    await expect(page.getByRole('log', { name: 'Conversazione con Lumi' })).toHaveCount(0);
    expect(chatRequests).toBe(0);
    await page.goto('/spazi/test');
    await expect(page.getByRole('heading', { name: 'Lumi si sta preparando' })).toBeVisible();
    ready = true;
    await page.getByRole('button', { name: 'Controlla se è pronta' }).click();
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
    await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire meraviglia?');
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    await expect(page.getByText('Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.')).toBeVisible();
  });
}

for (const path of ['/', '/spazi/test']) {
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
  await page.goto('/spazi/test');
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
  await page.goto('/spazi/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await page.evaluate(() => { const channel = new BroadcastChannel('lumi-session'); channel.postMessage('logout'); channel.close(); });
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
  await page.clock.fastForward(180_000);
  expect(sessionRequests).toBe(1);
  await expect(page.getByRole('heading', { name: 'A presto!' })).toBeVisible();
});

test('a question opens its own chat and follow-ups stay there', async ({ page }) => {
  const state = await mockAPI(page); await page.goto('/spazi/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa vuol dire meraviglia?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page).toHaveURL(/\/domande\//);
  await expect(page.getByText('Meraviglia è una bella sorpresa, come quando vedi un arcobaleno.')).toBeVisible();
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  await expect(page.getByText('Proviamo con parole più semplici.')).toBeVisible();
  expect(state.chats).toHaveLength(1); expect(state.messages.get(state.chats[0].id)).toHaveLength(4);
  await page.getByRole('main').getByRole('link', { name: 'Fai una nuova domanda', exact: true }).click();
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
  await expect(page.getByText('Piano collegato per tutti gli spazi.')).toBeVisible();
  await page.getByRole('button', { name: 'Salva modello', exact: true }).click();
  await expect(page.getByText('Modello salvato per tutti gli spazi.')).toBeVisible();
  expect(globalRequests).toContain('/api/v1/admin/connection/complete');
  expect(globalRequests.every(path => !path.includes('/families/'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.goto('/spazi/test/coach');
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
  await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: false, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'test', name: 'Il nostro spazio', role: 'parent' }] }) }));
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/admin/')) requests.push(request.url()); });
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toHaveText('Questa parte è riservata agli amministratori.');
  await expect(page.getByRole('button', { name: /(?:Collega|Ricollega) ChatGPT/ })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('Admin keeps the family navbar and returns to the family it was opened from', async ({ page }, testInfo) => {
  await mockAPI(page);
  await page.route('**/api/v1/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, portalAccess: true, admin: true, email: 'user@example.test', csrfToken: 'csrf-test', families: [{ id: 'other', name: 'Un altro spazio', role: 'parent' }, { id: 'test', name: 'Il nostro spazio', role: 'parent' }] }) }));
  await page.goto('/spazi/test/coach');
  await expect(page.getByRole('heading', { name: 'Area coach' })).toBeVisible();
  await openNavigation(page);
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?family=test$/);
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.back-link')).toHaveText('Torna da Lumi');
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/spazi/test');
  await expect(page.locator('.portal-account')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/global-admin-navigation-${testInfo.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/spazi/test');
  await openNavigation(page);
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveAttribute('href', '/spazi/test');
  await expect(page.getByRole('link', { name: 'Area coach', exact: true })).toBeVisible();
  const closeMenu = page.getByRole('button', { name: 'Chiudi menu', exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.getByRole('link', { name: 'Torna da Lumi', exact: true }).click();
  await expect(page).toHaveURL(/\/spazi\/test$/);
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
  await expect(page.getByRole('link', { name: 'I tuoi spazi' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Il mio angolino' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Area coach', exact: true })).toHaveCount(0);
  expect(familyRequests).toHaveLength(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`subject choices support touch and keyboard without losing the question at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await mockAPI(page);
    await page.goto('/spazi/test');
    const picker = page.getByRole('radiogroup', { name: 'Scegli la materia' });
    await expect(picker.getByRole('radio')).toHaveCount(6);
    await expect(picker.getByRole('radio', { name: 'Italiano', exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const columns = await picker.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width <= 600 ? 2 : 3);
    for (const radio of await picker.getByRole('radio').all()) {
      const bounds = await radio.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const question = page.getByLabel('Scrivi una parola o una frase');
    await question.fill('La mia domanda');
    const english = picker.getByRole('radio', { name: 'Inglese', exact: true });
    await english.check();
    await expect(english).toBeChecked();
    await expect(question).toHaveValue('La mia domanda');
    await expect(question).toHaveAttribute('placeholder', 'Per esempio: come si dice «cane»?');
    await expect(page.locator('.subject-intro')).toHaveText('Impariamo l’inglese, con un aiuto in italiano.');
    await english.focus();
    await page.keyboard.press('ArrowRight');
    const history = picker.getByRole('radio', { name: 'Storia', exact: true });
    await expect(history).toBeChecked();
    await expect(history).toBeFocused();
    await expect(picker.getByRole('radio', { checked: true })).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(question).toBeFocused();
    await expect(question).toHaveValue('La mia domanda');
    await question.fill('');
    await history.focus();
    await page.screenshot({ path: `test-results/subject-picker-${width}-${testInfo.project.name}.png`, fullPage: true });
  });
}

test('home preserves its layout and account actions live in the sidebar', async ({ page }, testInfo) => {
  await mockAPI(page); await page.goto('/spazi/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('UN PEZZETTO ALLA VOLTA', { exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Esci', exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Cambia spazio' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/home-${testInfo.project.name}.png`, fullPage: true });
  await openNavigation(page);
  const account = page.getByRole('navigation', { name: 'Account e spazio' });
  await expect(account.getByText('Il nostro spazio', { exact: true })).toBeVisible();
  await expect(account.getByText('user@example.test')).toBeVisible();
  await expect(account.getByRole('button', { name: 'Esci', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/sidebar-${testInfo.project.name}.png`, fullPage: true });
  await page.locator('.sidebar-bottom').last().screenshot({ path: `test-results/sidebar-account-${testInfo.project.name}.png` });
  await account.getByRole('link', { name: 'Cambia spazio' }).click();
  await expect(page.getByRole('heading', { name: 'I tuoi spazi' })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole('button', { name: 'Esci', exact: true })).toBeVisible();
  const closeMenu = page.getByRole('button', { name: 'Chiudi menu', exact: true });
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.getByRole('link', { name: /Il nostro spazio/ }).click();
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('sidebar groups discoveries by last activity and keeps account actions visible', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  const now = new Date('2026-11-01T12:00:00Z');
  await page.clock.setFixedTime(now);
  const earlier = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const saved: Conversation[] = [
    { id: 'old', title: 'Gli animali del bosco', subject: 'italian', createdAt: earlier(20), updatedAt: earlier(20) },
    { id: 'yesterday', title: 'Perché le foglie cambiano colore?', subject: 'italian', createdAt: earlier(1), updatedAt: earlier(1) },
    { id: 'resumed', title: 'Una parola che abbiamo ripreso insieme', subject: 'italian', createdAt: earlier(30), updatedAt: new Date(now.getTime() - 3_600_000).toISOString() },
    { id: 'week', title: 'La differenza tra il Sole e le stelle', subject: 'italian', createdAt: earlier(4), updatedAt: earlier(4) },
    { id: 'latest', title: 'Come si racconta in inglese una passeggiata nel bosco?', subject: 'english', createdAt: now.toISOString(), updatedAt: now.toISOString() },
  ];
  for (let index = 0; index < 24; index++) saved.push({ id: `older-${index}`, title: `Una scoperta da ritrovare ${index + 1}`, subject: 'italian', createdAt: earlier(40 + index), updatedAt: earlier(40 + index) });
  api.chats.push(...saved);
  for (const conversation of saved) api.messages.set(conversation.id, []);
  await page.goto('/spazi/test');
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await openNavigation(page);
  const navigation = page.locator('.sidebar:visible, .mobile-nav-panel');
  const history = navigation.getByRole('region', { name: 'Le mie scoperte', exact: true });
  await expect(history.getByRole('heading', { level: 3 })).toHaveText(['Oggi', 'Ieri', 'Ultimi 7 giorni', 'Più tempo fa']);
  await expect(history.getByRole('region', { name: 'Oggi', exact: true }).getByRole('link')).toHaveText([
    /Come si racconta in inglese.*Inglese/,
    /Una parola che abbiamo ripreso insieme.*Italiano/,
  ]);
  await expect(history.getByRole('button', { name: /^Notifiche/ })).toHaveCount(0);
  const account = navigation.getByRole('navigation', { name: 'Account e spazio' });
  await expect(account.getByRole('button', { name: 'Esci', exact: true })).toBeInViewport();
  await page.screenshot({ path: `test-results/sidebar-organized-${testInfo.project.name}.png`, fullPage: true });
  await history.getByRole('link', { name: /Una scoperta da ritrovare 24/ }).scrollIntoViewIfNeeded();
  await expect(account.getByRole('link', { name: 'Cambia spazio' })).toBeInViewport();
  await expect(navigation.getByRole('link', { name: 'Area coach', exact: true })).toBeInViewport();
  await expect(history.getByRole('link', { name: 'Fai una nuova domanda', exact: true })).toBeInViewport();
  await history.getByRole('link', { name: /Come si racconta in inglese/ }).click();
  await expect(page).toHaveURL(/\/domande\/latest$/);
  await openNavigation(page);
  const selected = history.getByRole('link', { name: /Come si racconta in inglese/ });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await selected.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/sidebar-selected-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1000, height: 640 });
    await expect(account.getByRole('button', { name: 'Esci', exact: true })).toBeInViewport();
    await expect(selected).toBeInViewport();
    await page.screenshot({ path: 'test-results/sidebar-compact-desktop.png', fullPage: true });
  }
});

test('sidebar collapses, preserves drafts and remembers its width across navigation and reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop sidebar; mobile uses its own drawer.');
  await mockAPI(page);
  await page.route('**/api/v1/invitations', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'invite', familyId: 'alba', familyName: 'Spazio Alba', expiresAt: '2027-01-01T00:00:00Z' }]) }));
  await page.goto('/spazi/test');
  const sidebar = page.getByRole('complementary', { name: 'Menu laterale' });
  const question = page.getByLabel('Scrivi una parola o una frase');
  await question.fill('Una domanda da finire');
  await expect(sidebar.locator('.sidebar-bottom').getByRole('button', { name: 'Notifiche: 1' })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Comprimi menu laterale' }).focus();
  await page.keyboard.press('Enter');
  const expand = sidebar.getByRole('button', { name: 'Espandi menu laterale' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '76px');
  await expect(question).toHaveValue('Una domanda da finire');
  const discoveries = sidebar.getByRole('button', { name: 'Le mie scoperte', exact: true });
  await discoveries.click();
  await expect(page.getByRole('dialog', { name: 'Le mie scoperte' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(discoveries).toBeFocused();
  await expect(question).toHaveValue('Una domanda da finire');
  const notifications = sidebar.getByRole('button', { name: 'Notifiche: 1' });
  await expect(notifications.locator('.notification-count')).toBeInViewport();
  await notifications.click();
  await expect(page.getByRole('dialog', { name: 'Notifiche', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notifications).toBeFocused();
  await sidebar.getByRole('link', { name: 'Il mio dizionario' }).click();
  await expect(page.getByRole('heading', { name: 'Il mio dizionario' })).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '76px');
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '76px');
  await expect(sidebar.getByRole('link', { name: 'Il mio dizionario' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'test-results/sidebar-collapsed-desktop.png', fullPage: true });
  await expand.click();
  await expect(sidebar).toHaveCSS('width', '272px');
  await page.screenshot({ path: 'test-results/sidebar-expanded-desktop.png', fullPage: true });
  // A stored desktop preference must not remove labels from the phone menu.
  await sidebar.getByRole('button', { name: 'Comprimi menu laterale' }).click();
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: 'Apri menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Navigazione principale' });
  await expect(menu.getByText('Il mio dizionario', { exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Esci', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/sidebar-mobile-after-collapse.png' });
});

test('sidebar scrolls conversations while keeping account and notifications visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop sidebar; mobile history is covered separately.');
  await page.setViewportSize({ width: 1024, height: 720 });
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  for (let index = 0; index < 30; index++) {
    const id = `sidebar-${index}`;
    api.chats.push({ id, title: `La mia scoperta numero ${index + 1}`, subject: 'italian', createdAt: date, updatedAt: date });
    api.messages.set(id, []);
  }
  await page.goto('/spazi/test');
  const sidebar = page.getByRole('complementary', { name: 'Menu laterale' });
  const last = sidebar.getByRole('link', { name: /La mia scoperta numero 30/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Notifiche', exact: true })).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Esci', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/sidebar-long-history-desktop.png', fullPage: true });
  await last.click();
  await expect(page).toHaveURL(/\/domande\/sidebar-29$/);
  await expect(last).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('connection failures retain the written question', async ({ page }) => {
  await mockAPI(page);
  await page.route('**/api/v1/families/test/conversations/*/messages', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'Il piano ChatGPT non è disponibile.' }) }));
  await page.goto('/spazi/test'); await page.getByLabel('Scrivi una parola o una frase').fill('Che cosa vuol dire prato?'); await page.getByRole('button', { name: 'Scopriamo!' }).click();
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
    await page.goto('/spazi/test');
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
      await page.getByRole('link', { name: 'Area coach' }).last().click();
      await expect(page.getByRole('heading', { name: 'Area coach' })).toBeVisible();
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
  await page.goto('/spazi/test');
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
  await mockAPI(page); await page.goto('/spazi/test');
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
    await mockAPI(page); await page.goto('/spazi/test');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const paths = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat();
    });
    expect(paths).not.toContain('/');
    expect(paths.some(path => path.startsWith('/spazi/'))).toBe(false);
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
    await mockAPI(page); await page.goto('/spazi/test');
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
    await mockAPI(page, automatic); await page.goto('/spazi/test');
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
  await page.goto('/spazi/test');
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
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Domanda di prova').fill('Mostrami una roccia');
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.locator('.preview-result').getByRole('img', { name: 'Roccia' })).toBeVisible();
  await expect(page.locator('.preview-result')).toContainText('Ecco una roccia!');
});

test('sentence maps open one piece at a time, guide follow-ups and survive reload', async ({ page }, testInfo) => {
  const state = await mockAPI(page); await page.goto('/spazi/test');
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
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Scoperte dello spazio' }).click();
  await page.locator('.history-table').getByRole('button', { name: new RegExp(catMap.sentence) }).first().click();
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Mappa della frase' })).toBeVisible();
});

test('parent preview shows the sentence map', async ({ page }) => {
  await mockAPI(page); await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Domanda di prova').fill(catMap.sentence);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  const map = page.getByRole('region', { name: 'Mappa della frase' });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: /Dove/ }).click();
  await expect(map.getByText('Sopra il tappeto.')).toBeVisible();
});

test('explicit topic maps show all planets, expand gradually and preserve selected context', async ({ page }, testInfo) => {
  const state = await mockAPI(page); await page.goto('/spazi/test');
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
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Scoperte dello spazio' }).click();
  await page.locator('.history-table').getByRole('button').first().click();
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Mappa dell’argomento' })).toBeVisible();
});

test('parent preview shows a topic map and clears it for the next example', async ({ page }) => {
  await mockAPI(page); await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await page.getByLabel('Domanda di prova').fill(spaceQuestion);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  const map = page.getByRole('region', { name: 'Mappa dell’argomento' });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Le stelle', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Sole', exact: true })).toBeVisible();
  await page.getByLabel('Domanda di prova').fill(catMap.sentence);
  await page.getByRole('button', { name: 'Prova le istruzioni' }).click();
  await expect(page.getByRole('region', { name: 'Mappa della frase' })).toBeVisible();
  await expect(map).toHaveCount(0);
});


test('English cards retain their subject after reload and share a separate dictionary entry across directions', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await expect(page.getByRole('radio', { name: 'Italiano', exact: true })).toBeChecked();
  await expect(page.getByText('Matematica', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Inglese', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Come si dice cane?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.word-heading')).toHaveText('dog');
  await expect(page.locator('.example-translation')).toHaveText('Il cane è felice.');
  expect(api.chats[0].subject).toBe('english');
  await page.reload();
  await expect(page.locator('.chat-title')).toContainText('Inglese');
  await expect(page.locator('.word-heading')).toHaveText('dog');
  await page.getByLabel('Scrivi una parola o una frase').fill('Cosa significa dog?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.word-heading')).toHaveCount(2);
  expect(api.dictionary).toHaveLength(1);
  await page.screenshot({ path: `test-results/english-cards-${testInfo.project.name}.png`, fullPage: true });
  await openNavigation(page);
  await page.getByRole('link', { name: 'Il mio dizionario', exact: true }).click();
  await expect(page.getByText('Le parole che chiedi a Lumi compariranno qui.')).toBeVisible();
  await page.getByRole('radio', { name: 'Inglese', exact: true }).click();
  await page.getByRole('searchbox').fill('cane');
  await page.getByRole('button', { name: 'Ripassiamo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'dog', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mostra il significato' }).click();
  await expect(page.getByText('Il cane è felice.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('English sentence and topic maps keep translations and selected follow-up context', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByRole('radio', { name: 'Inglese', exact: true }).click();
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
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.settings.prompt);
  await page.getByRole('radio', { name: 'Inglese', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.englishSettings.prompt);
  await page.getByLabel('Istruzioni per Lumi').fill('Usa esempi inglesi molto brevi.');
  await page.getByRole('button', { name: 'Salva istruzioni', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Istruzioni salvate.');
  expect(api.settings.prompt).toBe('Spiega una parola alla volta.');
  expect(api.englishSettings.prompt).toBe('Usa esempi inglesi molto brevi.');
  await page.getByLabel('Domanda di prova').fill('Come si dice cane?');
  await page.getByRole('button', { name: 'Prova le istruzioni', exact: true }).click();
  await expect(page.locator('.preview-result .word-heading')).toHaveText('dog');
  expect(api.dictionary).toHaveLength(0);
  await page.getByRole('button', { name: 'Ripristina il testo iniziale', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.englishSettings.defaultPrompt);
  await page.getByRole('radio', { name: 'Italiano', exact: true }).click();
  await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.settings.prompt);
});

test('saved family and parent URLs open the matching space and coach pages', async ({ page }) => {
  await mockAPI(page);
  for (const [legacy, current, heading] of [
    ['/famiglie/test', '/spazi/test', 'Che cosa scopriamo oggi?'],
    ['/famiglie/test/genitore', '/spazi/test/coach', 'Area coach'],
    ['/famiglie/test/dizionario', '/spazi/test/dizionario', 'Il mio dizionario'],
    ['/admin/famiglie', '/admin/spazi', 'Spazi'],
  ]) {
    await page.goto(`${legacy}?family=test#sezione`);
    await expect(page).toHaveURL(`${new URL(current, page.url()).href}?family=test#sezione`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
});

test('mobile tabs open discoveries without losing the draft and restore keyboard focus', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mockAPI(page);
  await page.goto('/spazi/test');
  const tabs = page.getByRole('navigation', { name: 'Il tuo angolino' });
  const question = page.getByLabel('Scrivi una parola o una frase');
  await question.fill('Una domanda da finire');
  const discoveries = tabs.getByRole('button', { name: 'Scoperte', exact: true });
  await discoveries.click();
  const dialog = page.getByRole('dialog', { name: 'Le mie scoperte' });
  await expect(dialog.getByText('Cominciamo dalla prima?', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Fai una domanda' })).toBeVisible();
  await page.screenshot({ path: `test-results/discoveries-empty-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(discoveries).toBeFocused();
  await expect(question).toHaveValue('Una domanda da finire');
  await tabs.getByRole('link', { name: 'Dizionario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Il mio dizionario' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Dizionario', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Domanda', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Domanda', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('discoveries retry failures, scroll long history and reopen the current chat', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  for (let index = 0; index < 30; index++) {
    const id = `saved-${index}`;
    api.chats.push({ id, title: `La mia scoperta numero ${index + 1}`, subject: 'italian', createdAt: date, updatedAt: date });
    api.messages.set(id, []);
  }
  let unavailable = true;
  await page.route('**/api/v1/families/test/conversations', async route => {
    if (unavailable) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.fallback();
  });
  await page.goto('/spazi/test');
  const trigger = page.getByRole('button', { name: 'Scoperte', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Le mie scoperte' });
  await expect(dialog.getByRole('alert')).toContainText('Non riesco a caricare le tue scoperte.');
  unavailable = false;
  await dialog.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(dialog.getByRole('link')).toHaveCount(30);
  const last = dialog.getByRole('link', { name: /La mia scoperta numero 30/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Chiudi scoperte' })).toBeInViewport();
  await page.screenshot({ path: `test-results/discoveries-list-${testInfo.project.name}.png` });
  await last.click();
  await expect(page).toHaveURL(/\/domande\/saved-29$/);
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(last).toHaveAttribute('aria-current', 'page');
  await last.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 700 }, { width: 820, height: 900 }, { width: 740, height: 390 }]) {
  test(`compact mobile chrome leaves room for reading at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const api = await mockAPI(page);
    const date = new Date().toISOString();
    const title = 'Una domanda molto lunga per scoprire insieme tutte le parole che incontriamo';
    api.chats.push({ id: 'compact', title, subject: 'italian', createdAt: date, updatedAt: date });
    api.messages.set('compact', [{ id: 'compact-answer', conversationId: 'compact', role: 'assistant', status: 'completed', text: 'Una parola alla volta, scopriamo qualcosa di nuovo.', createdAt: date }]);
    await page.goto('/spazi/test/domande/compact');
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator('.question-heading')).toBeHidden();
    await expect(page.locator('.chat-disclosure')).toBeHidden();
    await expect(page.locator('.page-footer')).toBeHidden();
    const header = (await page.locator('.chat-title').boundingBox())!;
    const topbar = (await page.locator('.topbar').boundingBox())!;
    expect(header.height).toBe(52);
    expect(topbar.y).toBe(header.y);
    expect(topbar.height).toBe(header.height);
    const newQuestion = page.getByRole('link', { name: 'Fai una nuova domanda', exact: true });
    const notifications = page.locator('.topbar').getByRole('button', { name: 'Notifiche', exact: true });
    const menu = page.getByRole('button', { name: 'Apri menu' });
    const titleBox = (await heading.boundingBox())!;
    const controls = [newQuestion, notifications, menu];
    let previousRight = titleBox.x + titleBox.width;
    for (const control of controls) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = box.x + box.width;
    }
    expect(previousRight).toBeLessThanOrEqual(viewport.width);
    const tabs = page.getByRole('navigation', { name: 'Il tuo angolino' });
    expect((await tabs.boundingBox())!.height).toBe(52);
    await expect(tabs.getByRole('link', { name: 'Domanda', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Scoperte', exact: true })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Dizionario', exact: true })).toBeVisible();
    // Labels remain accessible, but do not consume a second visual row.
    expect(await tabs.locator('span').evaluateAll(labels => labels.every(label => label.getBoundingClientRect().height <= 1))).toBe(true);
    const readingHeight = await page.getByRole('region', { name: 'Leggi la conversazione' }).evaluate(area => area.clientHeight);
    expect(readingHeight).toBeGreaterThanOrEqual(viewport.width === 390 ? 440 : 100);
    await expect(page.getByLabel('Scrivi una parola o una frase')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Parla con Lumi' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Scopriamo!' })).toBeInViewport();
    expect((await page.getByRole('button', { name: 'Parla con Lumi' }).boundingBox())!.height).toBe(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/compact-chat-${viewport.width}-${testInfo.project.name}.png` });
    await notifications.click();
    await expect(page.getByRole('dialog', { name: 'Notifiche', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi notifiche' }).click();
    await expect(notifications).toBeFocused();
    await menu.click();
    await expect(page.getByRole('dialog', { name: 'Navigazione principale' })).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi menu' }).click();
    await expect(menu).toBeFocused();
    await newQuestion.click();
    await expect(page).toHaveURL(/\/spazi\/test$/);
    await expect(page.getByRole('heading', { name: 'Che cosa scopriamo oggi?' })).toBeVisible();
    await expect(page.locator('.page-footer')).toBeHidden();
    expect((await page.locator('.topbar').boundingBox())!.height).toBe(52);
  });
}

test('compact composer keeps recording, transcript review, and retry feedback visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: class {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
    } });
  });
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  api.chats.push({ id: 'voice', title: 'Una domanda a voce', subject: 'italian', createdAt: date, updatedAt: date });
  api.messages.set('voice', []);
  await page.route('**/api/v1/families/test/transcriptions*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'Una parola da scoprire' }) }));
  let fail = true;
  await page.route('**/api/v1/families/test/conversations/voice/messages', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'La risposta non è disponibile. Riprova.' }) }) : route.fallback());
  await page.goto('/spazi/test/domande/voice');
  await page.getByRole('button', { name: 'Parla con Lumi' }).click();
  const stop = page.getByRole('button', { name: /Ho finito/ });
  await expect(stop).toBeInViewport();
  const question = page.getByLabel('Scrivi una parola o una frase');
  await expect(question).toBeDisabled();
  await stop.click();
  await expect(question).toHaveValue('Una parola da scoprire');
  await expect(page.getByRole('status')).toContainText('Puoi correggerlo');
  await expect(page.getByRole('status')).toBeInViewport();
  const send = page.getByRole('button', { name: 'Scopriamo!' });
  await expect(send).toBeInViewport();
  await send.click();
  await expect(page.getByRole('alert')).toContainText('La risposta non è disponibile');
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(question).toHaveValue('Una parola da scoprire');
  await expect(send).toBeInViewport();
  fail = false;
  await send.click();
  await expect(page.locator('.message.assistant')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('desktop retains its conversation header and composer guidance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  api.chats.push({ id: 'desktop', title: 'La nostra scoperta', subject: 'english', createdAt: date, updatedAt: date });
  api.messages.set('desktop', []);
  await page.goto('/spazi/test/domande/desktop');
  await expect(page.getByRole('heading', { name: 'La nostra scoperta' })).toBeVisible();
  await expect(page.getByText('Inglese con Lumi', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continuiamo?' })).toBeVisible();
  await expect(page.getByText('Scrivi o parla con Lumi', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-disclosure')).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.mobile-tabs')).toBeHidden();
  await page.goto('/spazi/test');
  await expect(page.locator('.page-footer')).toBeVisible();
});

test('waiting scenes entertain until text or a learning card arrives', async ({ page }, testInfo) => {
  await page.clock.install();
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  api.chats.push({ id: 'waiting', title: 'Una piccola scoperta', subject: 'italian', createdAt: date, updatedAt: date });
  const answer: Message = { id: 'waiting-answer', conversationId: 'waiting', role: 'assistant', status: 'streaming', text: '', createdAt: date };
  api.messages.set('waiting', [answer]);
  await page.goto('/spazi/test/domande/waiting');
  const play = page.locator('.thinking-play');
  await expect(play).toBeVisible();
  await expect(play.getByRole('status')).toHaveText('Lumi sta pensando. La risposta sta arrivando.');
  await expect(play).toContainText('Ehi, stellina! Aspettami!');
  await expect(page.locator('.thinking-dots')).toHaveCount(0);
  await page.screenshot({ path: `test-results/waiting-star-${testInfo.project.name}.png` });
  const next = play.getByRole('button', { name: 'Un’altra magia' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(play).toContainText('Un’idea a testa in giù!');
  await page.clock.fastForward(8000);
  await expect(play).toContainText('Una bolla… due bolle… pop!');
  await page.screenshot({ path: `test-results/waiting-bubbles-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('.thinking-bubble-one').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.clock.fastForward(16000);
  await expect(play).toContainText('Una bolla… due bolle… pop!');
  await next.click();
  await expect(play).toContainText('Ehi, stellina! Aspettami!');

  answer.text = 'Ecco la prima piccola idea.';
  await page.clock.fastForward(2100);
  await expect(play).toHaveCount(0);
  await expect(page.locator('.message.assistant')).toContainText(answer.text);
  await expect(page.locator('.thinking-dots')).toBeVisible();

  answer.text = '';
  answer.wordExplanation = vigorousWord;
  await page.clock.fastForward(2100);
  await expect(play).toHaveCount(0);
  await expect(page.locator('.word-explanation')).toBeVisible();
  answer.wordExplanation = undefined;
  answer.status = 'interrupted';
  await page.clock.fastForward(2100);
  await expect(play).toHaveCount(0);
  await expect(page.getByText('La risposta si è interrotta', { exact: true })).toBeVisible();
});

test('long streaming answers respect reading position and keep the composer in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.clock.install();
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  api.chats.push({ id: 'long', title: 'Leggiamo un pezzetto alla volta', subject: 'italian', createdAt: date, updatedAt: date });
  const answer: Message = { id: 'long-answer', conversationId: 'long', role: 'assistant', status: 'streaming', text: 'Una parola nuova ci aiuta a raccontare quello che vediamo.\n\n'.repeat(35), createdAt: date };
  api.messages.set('long', [
    { id: 'old-question', conversationId: 'long', role: 'user', status: 'completed', text: 'Una vecchia domanda. '.repeat(150), createdAt: date },
    answer,
  ]);
  await page.goto('/spazi/test/domande/long');
  const reading = page.getByRole('region', { name: 'Leggi la conversazione' });
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect.poll(() => reading.evaluate(area => area.scrollTop)).toBeGreaterThan(0);
  const anchoredTop = await reading.evaluate(area => area.scrollTop);
  answer.text += 'Altro contenuto in arrivo. '.repeat(40);
  await page.clock.fastForward(2100);
  await expect(page.locator('.message.assistant')).toContainText('Altro contenuto in arrivo.');
  expect(await reading.evaluate(area => area.scrollTop)).toBeCloseTo(anchoredTop, 0);
  const composer = page.getByRole('region', { name: 'Fai una domanda' });
  const initialBox = (await composer.boundingBox())!;
  await reading.evaluate(area => { area.scrollTop = 0; });
  const latest = page.getByRole('button', { name: 'Ultima risposta', exact: true });
  await expect(latest).toBeVisible();
  answer.text += 'Ecco un altro pezzetto da leggere.';
  await page.clock.fastForward(2100);
  await expect(page.locator('.message.assistant')).toContainText('Ecco un altro pezzetto da leggere.');
  expect(await reading.evaluate(area => area.scrollTop)).toBe(0);
  await expect(latest).toBeVisible();
  await latest.click();
  await expect.poll(async () => {
    const area = (await reading.boundingBox())!;
    const response = (await page.locator('[data-message-id="long-answer"]').boundingBox())!;
    return Math.abs(response.y - area.y - 8);
  }).toBeLessThan(2);
  await expect(latest).toBeHidden();
  const finalBox = (await composer.boundingBox())!;
  expect(finalBox.y).toBeCloseTo(initialBox.y, 0);
  expect(finalBox.y + finalBox.height).toBeLessThanOrEqual(700);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('button', { name: 'Parla con Lumi' })).toBeInViewport();
});

test('late word cards keep the meaning visible through completion and reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.clock.install();
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  api.chats.push({ id: 'cards', title: 'Una parola', subject: 'english', createdAt: date, updatedAt: date });
  const answer: Message = { id: 'cards-answer', conversationId: 'cards', role: 'assistant', status: 'streaming', text: '', createdAt: date };
  api.messages.set('cards', [
    { id: 'cards-question', conversationId: 'cards', role: 'user', status: 'completed', text: 'apple', createdAt: date },
    answer,
  ]);
  await page.goto('/spazi/test/domande/cards');
  await expect(page.locator('.thinking-play')).toBeVisible();
  answer.wordExplanation = { word: 'apple', meaning: 'mela', example: 'I eat an apple. '.repeat(30), exampleTranslation: 'Mangio una mela. '.repeat(30), sourceWord: 'apple', sourceLanguage: 'en' };
  await page.clock.fastForward(2100);
  const meaning = page.getByRole('region', { name: 'Significato', exact: true });
  await expect(meaning).toBeInViewport({ ratio: 1 });
  const reading = page.getByRole('region', { name: 'Leggi la conversazione' });
  const top = await reading.evaluate(area => area.scrollTop);
  answer.images = rockImages;
  await page.clock.fastForward(2100);
  await expect(page.locator('.word-images')).toBeVisible();
  await expect(meaning).toBeInViewport({ ratio: 1 });
  expect(await reading.evaluate(area => area.scrollTop)).toBeCloseTo(top, 0);
  answer.status = 'completed';
  await page.clock.fastForward(2100);
  await expect(page.locator('.thinking-dots')).toHaveCount(0);
  await expect(meaning).toBeInViewport({ ratio: 1 });
  expect(await reading.evaluate(area => area.scrollTop)).toBeCloseTo(top, 0);
  await page.reload();
  await expect(meaning).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Ultima risposta', exact: true })).toBeHidden();
});

test('chat adapts to keyboard viewport changes and small landscape screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByLabel('Scrivi una parola o una frase').fill('Meraviglia');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.getByLabel('Scrivi una parola o una frase').fill('Un’altra domanda');
  // Desktop Chromium does not open an OS keyboard: model its visual viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 480 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const tabs = page.getByRole('navigation', { name: 'Il tuo angolino' });
  await expect(tabs).toBeHidden();
  const send = page.getByRole('button', { name: 'Scopriamo!' });
  const keyboardBox = (await send.boundingBox())!;
  expect(keyboardBox.y + keyboardBox.height).toBeLessThanOrEqual(480);
  await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveValue('Un’altra domanda');
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(tabs).toBeVisible();
  await page.setViewportSize({ width: 740, height: 390 });
  await expect(send).toBeInViewport();
  await expect(tabs).toBeInViewport();
  expect(await page.getByRole('region', { name: 'Leggi la conversazione' }).evaluate(area => area.clientHeight)).toBeGreaterThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('study narrows Egiziani to the Nilo and reopens a real cartographic attachment', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  for (const name of ['Italiano', 'Inglese', 'Storia', 'Geografia', 'Scienze', 'Geometria']) await expect(page.getByRole('radio', { name, exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Storia', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Gli Egiziani');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByRole('button', { name: 'Il Nilo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Più facile', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Il Nilo', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/study-focus-${testInfo.project.name}.png` });
  await page.getByRole('button', { name: 'Il Nilo', exact: true }).click();
  const map = page.getByRole('img', { name: 'Cartina: Il Nilo', exact: true });
  await expect(map).toBeVisible();
  await expect(page.getByText('La risposta non è arrivata. Puoi riprovare.')).toHaveCount(0);
  expect(api.chats[0].subject).toBe('history');
  expect(api.dictionary).toHaveLength(0);
  await map.locator('.map-pin').click();
  await expect(page.getByText('L’acqua del fiume aiutava a coltivare i campi.')).toBeVisible();
  await captureStudyVisual(page, `test-results/study-nile-${testInfo.project.name}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Più facile', exact: true }).click();
  expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('Il punto selezionato è «Il Nilo»');
  await expect(map).toHaveCount(1);
  await page.reload();
  await expect(map).toBeVisible();
});

test('study asks which angles and allows a first discovery without another clarification', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByRole('radio', { name: 'Geometria', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('I tipi di angoli');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByText('Hai già i nomi degli angoli che stai studiando?')).toBeVisible();
  await expect(page.locator('.geometry-drawing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Una prima scoperta', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Angolo retto: 90 gradi, angolo retto' })).toBeVisible();
  await page.getByRole('img', { name: 'Angolo retto: 90 gradi, angolo retto' }).click();
  await expect(page.getByText('Prova a guardare un angolo del tuo quaderno.')).toBeVisible();
  await captureStudyVisual(page, `test-results/study-angle-${testInfo.project.name}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fammi un esempio', exact: true }).click();
  expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('Il punto selezionato è «Angolo retto»');
  await expect(page.locator('.geometry-drawing')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('img', { name: 'Angolo retto: 90 gradi, angolo retto' })).toBeVisible();
});

test('study accepts not knowing and keeps the input available for a free example', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByRole('radio', { name: 'Storia', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Gli Egiziani');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByLabel('Scrivi una parola o una frase')).toHaveAttribute('placeholder', 'Scrivi o racconta un esempio…');
  await page.getByRole('button', { name: 'Non lo so', exact: true }).click();
  await expect(page.getByText('Gli Egiziani vivevano vicino al Nilo. Partiamo da questa piccola scoperta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Non lo so', exact: true })).toHaveCount(0);
  expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('Non lo so. Aiutami');
});

test('study displays an explorable science cycle with readable labels', async ({ page }, testInfo) => {
  await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByRole('radio', { name: 'Scienze', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('Come funziona il ciclo dell’acqua?');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByRole('group', { name: 'Schema: Il ciclo dell’acqua' })).toBeVisible();
  await page.locator('.diagram-drawing').getByText('Le nuvole', { exact: true }).click();
  await expect(page.getByText('Si formano piccole gocce.')).toBeVisible();
  await page.getByRole('button', { name: 'La pioggia', exact: true }).click();
  await expect(page.getByText('Le gocce cadono sulla terra.')).toBeVisible();
  await captureStudyVisual(page, `test-results/study-water-cycle-${testInfo.project.name}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('study supports Cretesi maps and the island of Crete', async ({ page }, testInfo) => {
  await mockAPI(page);
  await page.goto('/spazi/test');
  await page.getByRole('radio', { name: 'Storia', exact: true }).click();
  await page.getByLabel('Scrivi una parola o una frase').fill('I Cretesi');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await page.getByRole('button', { name: 'La loro vita', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mappa dell’argomento' })).toBeVisible();
  await page.getByRole('button', { name: 'Dove vivevano', exact: true }).click();
  await expect(page.getByText('Vivevano sull’isola di Creta.')).toBeVisible();
  await page.getByLabel('Scrivi una parola o una frase').fill('Dove vivevano i Cretesi');
  await page.getByRole('button', { name: 'Scopriamo!' }).click();
  await expect(page.getByRole('img', { name: 'Cartina: Creta' })).toBeVisible();
  await captureStudyVisual(page, `test-results/study-crete-${testInfo.project.name}.png`);
});

test('study previews and saves separate coach instructions for each new subject', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/spazi/test/coach');
  await page.getByRole('tab', { name: 'Come insegna' }).click();
  for (const [subject, label] of [['history', 'Storia'], ['geography', 'Geografia'], ['science', 'Scienze'], ['geometry', 'Geometria']]) {
    await page.getByRole('radio', { name: label, exact: true }).check();
    await expect(page.getByLabel('Istruzioni per Lumi')).toHaveValue(api.studySettings[subject].prompt);
  }
  await page.getByLabel('Istruzioni per Lumi').fill('Usa figure grandi e poche parole.');
  await page.getByRole('button', { name: 'Salva istruzioni', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Istruzioni salvate.');
  expect(api.studySettings.geometry.prompt).toBe('Usa figure grandi e poche parole.');
  expect(api.settings.prompt).toBe('Spiega una parola alla volta.');
  await page.getByLabel('Domanda di prova').fill('Spiegami l’angolo retto');
  await page.getByRole('button', { name: 'Prova le istruzioni', exact: true }).click();
  await expect(page.locator('.preview-result .geometry-drawing')).toBeVisible();
  expect(api.chats).toHaveLength(0);
  expect(api.dictionary).toHaveLength(0);
});

for (const [width, height] of [[320, 640], [390, 760], [430, 880]]) {
  test(`study mobile makes drawings and their selected explanation usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const api = await mockAPI(page);
    const date = new Date().toISOString();
    const figures: LearningVisual = { kind: 'geometry', title: 'Confrontiamo gli angoli', summary: 'Guarda quanto si aprono.', figures: [
      { shape: 'angle', degrees: 45, label: 'Angolo acuto', explanation: 'Si apre meno di un angolo retto.' },
      { shape: 'angle', degrees: 90, label: 'Angolo retto', explanation: 'Come un angolo del quaderno.' },
      { shape: 'angle', degrees: 130, label: 'Angolo ottuso', explanation: 'Si apre più di un angolo retto.' },
    ] };
    api.chats.push({ id: 'mobile-angles', subject: 'geometry', title: 'Confrontiamo gli angoli', createdAt: date, updatedAt: date });
    api.messages.set('mobile-angles', [{ id: 'mobile-angles-answer', conversationId: 'mobile-angles', role: 'assistant', status: 'completed', text: '', createdAt: date, learningVisual: figures }]);
    await page.goto('/spazi/test/domande/mobile-angles');
    await expect(page.locator('.visual-heading h3')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.geometry-drawing')).toHaveCount(1);
    await expect(page.locator('.geometry-drawing')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `test-results/study-mobile-angles-initial-${width}-${testInfo.project.name}.png` });
    await expect(page.getByRole('button', { name: 'Angolo acuto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Fammi un esempio', exact: true }).click();
    await expect(page.getByText('Restiamo sul punto che hai scelto e guardiamo un esempio semplice.')).toBeVisible();
    expect(api.messages.get('mobile-angles')!.at(-2)!.text).toContain('Il punto selezionato è «Angolo acuto»');
    await page.getByRole('button', { name: 'Angolo ottuso', exact: true }).click();
    await expect(page.locator('.visual-explanation')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('img', { name: 'Angolo ottuso: 130 gradi, angolo ottuso' })).toBeVisible();
    await page.getByRole('button', { name: 'Angolo retto', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Angolo retto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.visual-explanation')).toContainText('Come un angolo del quaderno.');
    expect(await page.locator('.visual-read').evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/study-mobile-angles-${width}-${testInfo.project.name}.png` });

    const cycle: LearningVisual = { kind: 'diagram', title: 'Il viaggio dell’acqua', summary: 'Segui le frecce: il viaggio ricomincia.', layout: 'cycle', nodes: [
      { id: 'a', label: 'Il Sole scalda l’acqua', explanation: 'Il Sole riscalda l’acqua del mare.', symbol: 'sun' },
      { id: 'b', label: 'L’acqua sale come vapore', explanation: 'Piccole parti d’acqua salgono nell’aria.', symbol: 'sea' },
      { id: 'c', label: 'Si formano le nuvole', explanation: 'Il vapore si trasforma in goccioline.', symbol: 'cloud' },
      { id: 'd', label: 'La pioggia scende', explanation: 'Le gocce tornano sulla terra.', symbol: 'rain' },
      { id: 'e', label: 'L’acqua entra nei fiumi', explanation: 'L’acqua si raccoglie e scorre nei fiumi.', symbol: 'river' },
      { id: 'f', label: 'L’acqua torna al mare', explanation: 'Dal mare il viaggio dell’acqua può ricominciare.', symbol: 'sea' },
    ], edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'], ['f', 'a']].map(([from, to]) => ({ from, to })) };
    api.chats.push({ id: 'mobile-cycle', subject: 'science', title: 'Il viaggio dell’acqua', createdAt: date, updatedAt: date });
    api.messages.set('mobile-cycle', [{ id: 'mobile-cycle-answer', conversationId: 'mobile-cycle', role: 'assistant', status: 'completed', text: '', createdAt: date, learningVisual: cycle }]);
    await page.goto('/spazi/test/domande/mobile-cycle');
    await expect(page.locator('.visual-heading h3')).toBeInViewport({ ratio: 1 });
    const board = page.getByRole('group', { name: 'Schema: Il viaggio dell’acqua' });
    await expect(board.getByRole('button')).toHaveCount(6);
    await expect(board.locator('.diagram-connections > path')).toHaveCount(6);
    const buttons = await board.getByRole('button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, fits: element.scrollWidth <= element.clientWidth + 1 }; }));
    for (const button of buttons) { expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); expect(button.fits).toBe(true); }
    expect(await board.locator('.diagram-connections > path').evaluateAll(paths => paths.every(path => !/NaN|Infinity/.test(path.getAttribute('d') ?? '')))).toBe(true);
    await board.getByRole('button', { name: 'L’acqua torna al mare', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.visual-explanation')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.visual-explanation')).toContainText('Dal mare il viaggio dell’acqua può ricominciare.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureStudyVisual(page, `test-results/study-mobile-cycle-${width}-${testInfo.project.name}.png`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await board.getByRole('button', { name: 'Si formano le nuvole', exact: true }).click();
    await expect(board.getByRole('button', { name: 'Si formano le nuvole', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const [width, height] of [[320, 640], [390, 760], [430, 880]]) {
  test(`world continents stay readable and selected at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} } });
      const state = window as unknown as { activeUtterance?: SpeechSynthesisUtterance };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => [{ voiceURI: 'it', lang: 'it-IT', localService: true }], addEventListener() {}, removeEventListener() {},
        cancel() { state.activeUtterance = undefined; },
        speak(utterance: SpeechSynthesisUtterance) { state.activeUtterance = utterance; queueMicrotask(() => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)); },
      } });
    });
    const api = await mockAPI(page);
    await page.goto('/spazi/test');
    await page.getByRole('radio', { name: 'Geografia', exact: true }).click();
    await page.getByLabel('Scrivi una parola o una frase').fill('I continenti');
    await page.getByRole('button', { name: 'Scopriamo!' }).click();
    const map = page.getByRole('group', { name: 'Cartina: I continenti' });
    await expect(map).toBeVisible();
    await expect(map.locator('.map-feature')).toHaveCount(6);
    const originalPaths = await map.locator('.map-feature > path').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
    await expect(page.locator('.message.assistant > p').first()).toHaveText('Tocca un continente per scoprire dove si trova');
    expect(api.messages.get(api.chats[0].id)!.at(-1)!.text).toBe('Tocca un continente per scoprire dove si trova');
    await page.getByRole('button', { name: 'Riascolta', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { activeUtterance: SpeechSynthesisUtterance }).activeUtterance.text)).not.toMatch(/\*\*|__/);
    await page.getByRole('button', { name: 'Ferma la voce', exact: true }).click();
    for (let turn = 0; turn < 2; turn++) {
      await page.getByRole('button', { name: 'Più facile', exact: true }).click();
      expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('Il punto selezionato è «Africa»');
    }
    const oceania = map.locator('.map-continent-label').filter({ hasText: 'Oceania' });
    if (testInfo.project.name === 'android') await oceania.tap(); else await oceania.click();
    await expect(page.locator('.visual-explanation')).toContainText('Comprende l’Australia, la Nuova Zelanda');
    await expect(page.locator('.visual-explanation')).toBeInViewport({ ratio: 1 });
    await page.locator('.visual-read').click();
    expect(await page.evaluate(() => (window as unknown as { activeUtterance: SpeechSynthesisUtterance }).activeUtterance.text)).toBe('Oceania.');
    await page.evaluate(() => (window as unknown as { activeUtterance: SpeechSynthesisUtterance }).activeUtterance.onend?.(new Event('end') as SpeechSynthesisEvent));
    await expect.poll(() => page.evaluate(() => (window as unknown as { activeUtterance?: SpeechSynthesisUtterance }).activeUtterance?.text)).toContain('Comprende l’Australia');
    await page.getByRole('button', { name: 'Più facile', exact: true }).click();
    expect(api.messages.get(api.chats[0].id)!.at(-2)!.text).toContain('Il punto selezionato è «Oceania»');
    await expect(page.getByRole('button', { name: 'Oceania', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Seleziona Europa', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.visual-explanation')).toContainText('Qui c’è anche l’Italia.');
    await expect(page.locator('.visual-explanation')).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Antartide', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.visual-explanation')).toContainText('Polo Sud');
    const labelsFit = await map.locator('.map-continent-label, .map-ocean-label').evaluateAll(labels => labels.every(label => {
      const box = (label as SVGGraphicsElement).getBBox();
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= 360 && box.y + box.height <= 250;
    }));
    expect(labelsFit).toBe(true);
    expect(await map.locator('.map-feature > path').evaluateAll(paths => paths.map(path => path.getAttribute('d')))).toEqual(originalPaths);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureStudyVisual(page, `test-results/continents-${width}-${testInfo.project.name}.png`);
    await page.reload();
    await expect(map.locator('.map-feature')).toHaveCount(6);
    expect(api.messages.get(api.chats[0].id)![1].learningVisual?.kind).toBe('map');
  });
}

test('world continents can split America into seven selectable places', async ({ page }, testInfo) => {
  const api = await mockAPI(page);
  const date = new Date().toISOString();
  const visual = structuredClone(continentsVisual);
  visual.features = visual.features.filter(f => f.id !== 'continents-america');
  visual.features.push(
    { id: 'continents-north-america', label: 'America del Nord', explanation: 'A nord.' },
    { id: 'continents-south-america', label: 'America del Sud', explanation: 'A sud.' },
  );
  api.chats.push({ id: 'seven', subject: 'geography', title: 'Sette continenti', createdAt: date, updatedAt: date });
  api.messages.set('seven', [{ id: 'seven-answer', conversationId: 'seven', role: 'assistant', status: 'completed', text: '', createdAt: date, learningVisual: visual }]);
  await page.goto('/spazi/test/domande/seven');
  const map = page.getByRole('group', { name: 'Cartina: I continenti' });
  await expect(map.locator('.map-feature')).toHaveCount(7);
  await page.getByRole('button', { name: 'America del Sud', exact: true }).click();
  await expect(page.locator('.visual-explanation')).toContainText('A sud.');
  await captureStudyVisual(page, `test-results/continents-seven-${testInfo.project.name}.png`);
});
