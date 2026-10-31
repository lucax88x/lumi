import { SubjectPicker, subjectLabel } from './subjects';
import { familyID, familyPath, useSession } from './portal-state';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Tabs } from '@base-ui/react/tabs';
import { Switch } from '@base-ui/react/switch';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowLeft, Check, ChevronRight, Eye, FileText, LoaderCircle, RefreshCw, Save, Settings2, ShieldCheck, Trash2, Volume2, X } from 'lucide-react';
import { getSettingsOptions, listDictionaryWordsOptions, listDictionaryWordsQueryKey, listConversationsOptions, listConversationsQueryKey, getConversationOptions } from './api/@tanstack/react-query.gen';
import { updateSettings, deleteConversation, clearConversations, deleteDictionaryWord, clearDictionary } from './api/sdk.gen';
import type { Settings, Subject, WordImage, SentenceMap as SentenceMapData, TopicMap as TopicMapData, WordExplanation as WordExplanationData } from './api/types.gen';
import { errorMessage, readStream, shortDate } from './lib';
import { useSpeech } from './speech';
import { WordImages } from './WordImages';
import { SentenceMap } from './SentenceMap';
import { TopicMap } from './TopicMap';
import { WordExplanation } from './WordExplanation';
import { LoadingSkeleton } from './LoadingSkeleton';

export function AdminPage() {
  const familyId = familyID();
  const session = useSession();
  const family = session.families.find(f => f.id === familyId);
  return <div className="admin-page">
    <Link className="back-link" to="/spazi/$familyId" params={{ familyId: familyId }}><ArrowLeft size={16}/>Torna da Lumi</Link>
    <div className="admin-heading"><span className="admin-badge"><ShieldCheck size={24}/></span><div><span className="eyebrow">UNO SPAZIO PER TE</span><h1>Area coach</h1><p>Prepara Lumi, scegli la sua voce e segui le piccole scoperte.</p></div></div>
    {family?.role === 'parent' ? <AdminPanel/> : <p role="alert">Questa parte è riservata ai coach.</p>}
  </div>;
}
function AdminPanel() {
  const familyId = familyID();
  const settings = useQuery(getSettingsOptions({ path: { familyId } }));
  const session = useSession();
  return <>
    <div className="admin-toolbar"><span className="private-label"><ShieldCheck size={15}/>Accesso privato</span><Link className="text-button" to="/spazi/$familyId/membri" params={{ familyId: familyId }}>Gestisci lo spazio</Link></div>
    <Tabs.Root defaultValue="settings" className="admin-tabs"><Tabs.List className="tab-list"><Tabs.Tab value="settings"><Settings2 size={17}/>Impostazioni</Tabs.Tab><Tabs.Tab value="prompt"><FileText size={17}/>Come insegna</Tabs.Tab><Tabs.Tab value="history"><Eye size={17}/>Scoperte dello spazio</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="settings">
        <section className="admin-card"><h2>Un piano condiviso</h2><p>Il collegamento ChatGPT e il modello sono gestiti dall’amministratore per tutti gli spazi.</p>{session.admin && <Link className="text-button" to="/admin" search={{ family: familyId }}>Apri Admin</Link>}</section>
        {settings.isPending && <section className="admin-card"><LoadingSkeleton label="Caricamento delle impostazioni"/></section>}
        {settings.data && <Preferences initial={settings.data}/>}
        {settings.isError && <p className="error-text">{errorMessage(settings.error)}</p>}
      </Tabs.Panel>
      <Tabs.Panel value="prompt">{settings.isPending && <section className="admin-card"><LoadingSkeleton label="Caricamento delle istruzioni" variant="messages" rows={1}/></section>}{settings.data && <SubjectPromptEditor/>}</Tabs.Panel>
      <Tabs.Panel value="history"><HistoryPanel/><DictionaryPanel/></Tabs.Panel>
    </Tabs.Root>
  </>;
}

function Preferences({ initial }: { initial: Settings }) {
  const familyId = familyID();
  const qc = useQueryClient(); const [value, setValue] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const [englishVoice, setEnglishVoice] = useState(() => { try { return localStorage.getItem('lumi-voice-en') ?? ''; } catch { return ''; } });
  const speech = useSpeech(value.speechRate); const [voice, setVoice] = useState(() => { try { return localStorage.getItem('lumi-voice') ?? ''; } catch { return ''; } });
  useEffect(() => { setValue(initial); }, [initial]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try { await updateSettings({ path: { familyId: familyId }, body: value, throwOnError: true }); setSaved(true); await qc.invalidateQueries(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <form className="admin-card" onSubmit={save}><div className="section-heading"><span className="section-icon peach"><Settings2 size={22}/></span><div><h2>Risposte e voce</h2><p>Un ritmo tranquillo, parole facili da seguire.</p></div></div>
    <p className="field-hint">Modello condiviso: {value.model || 'in attesa dell’amministratore'}.</p>
    <div className="switch-row"><label htmlFor="autoplay"><strong>Lettura automatica</strong><span>Lumi legge ogni risposta appena è completa.</span></label><Switch.Root id="autoplay" className="switch" checked={value.autoRead} onCheckedChange={autoRead => setValue({ ...value, autoRead })}><Switch.Thumb className="switch-thumb"/></Switch.Root></div>
    <label htmlFor="speed">Velocità della voce <span className="label-value">{value.speechRate.toFixed(1)}×</span></label><input type="range" id="speed" min="0.5" max="1.5" step="0.1" value={value.speechRate} onChange={e => setValue({ ...value, speechRate: Number(e.target.value) })}/><div className="range-labels"><span>Con calma</span><span>Più veloce</span></div>
    <label htmlFor="voice">Voce italiana di questo dispositivo</label><select id="voice" value={voice} onChange={e => { setVoice(e.target.value); try { localStorage.setItem('lumi-voice', e.target.value); } catch { /* optional preference */ } }}><option value="">Italiana automatica (preferisci locale)</option>{speech.voices.filter(v => v.lang.toLowerCase().startsWith('it')).map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? ' · sul dispositivo' : ''}</option>)}</select><p className="field-hint">Le voci dipendono da Android o dal browser. La scelta vale su questo dispositivo.</p>
    <label htmlFor="english-voice">Voce inglese di questo dispositivo</label><select id="english-voice" value={englishVoice} onChange={e => { speech.stop(); setEnglishVoice(e.target.value); try { localStorage.setItem('lumi-voice-en', e.target.value); } catch { /* optional preference */ } }}><option value="">Inglese automatica (preferisci locale)</option>{speech.voices.filter(v => v.lang.toLowerCase().startsWith('en')).map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? ' · sul dispositivo' : ''}</option>)}</select>
    <button type="button" className="soft-button" onClick={() => speech.speaking ? speech.stop() : speech.speak([{ text: 'Hello! The dog is happy.', language: 'en' }, { text: 'Ciao! Il cane è felice.', language: 'it' }])}><Volume2 size={17}/>Prova la voce inglese</button>
    <div className="button-row"><button type="button" className="soft-button" onClick={() => speech.speaking ? speech.stop() : speech.speak('Ciao! Sono Lumi. Scopriamo insieme una parola, un pezzetto alla volta.')}><Volume2 size={17}/>{speech.speaking ? 'Ferma la prova' : 'Prova la voce'}</button><button className="primary-button" disabled={busy}><Save size={17}/>{busy ? 'Salvataggio…' : 'Salva impostazioni'}</button></div>{speech.blocked && <p className="notice">Installa o abilita una voce {speech.missingLanguage === 'en' ? 'inglese' : 'italiana'} nelle impostazioni vocali del dispositivo.</p>}{error && <p className="error-text" role="alert">{error}</p>}{saved && <p className="success-text" role="status">Impostazioni salvate.</p>}
  </form>;
}

function SubjectPromptEditor() {
  const familyId = familyID();
  const [subject, setSubject] = useState<Subject>('italian');
  const settings = useQuery(getSettingsOptions({ path: { familyId }, query: { subject } }));
  return <><SubjectPicker value={subject} onChange={setSubject}/>{settings.isPending && <LoadingSkeleton label="Caricamento delle istruzioni"/>}{settings.isError && <p className="error-text" role="alert">{errorMessage(settings.error)} <button className="text-button" onClick={() => void settings.refetch()}>Riprova</button></p>}{settings.data && <PromptEditor key={subject} subject={subject} initial={settings.data}/>}</>;
}

function PromptEditor({ initial, subject }: { initial: Settings; subject: Subject }) {
  const familyId = familyID();
  const qc = useQueryClient(); const [prompt, setPrompt] = useState(initial.prompt); const [sample, setSample] = useState(subject === 'english' ? 'The cat is on the mat.' : 'La gatta si accoccolò sul tappeto.'); const [preview, setPreview] = useState(''); const [previewImages, setPreviewImages] = useState<WordImage[]>([]); const [previewMap, setPreviewMap] = useState<SentenceMapData>(); const [previewTopicMap, setPreviewTopicMap] = useState<TopicMapData>(); const [previewWord, setPreviewWord] = useState<WordExplanationData>(); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null); useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setPrompt(initial.prompt); }, [initial.prompt]);
  async function test() {
    setBusy(true); setPreview(''); setPreviewImages([]); setPreviewMap(undefined); setPreviewTopicMap(undefined); setPreviewWord(undefined); setError(''); controller.current = new AbortController();
    try { await readStream(familyPath('/admin/preview', familyId), { subject, text: sample, prompt, model: initial.model }, e => { if (e.type === 'delta') setPreview(p => p + (e.delta ?? '')); if (e.message) { setPreview(e.message.text); setPreviewImages(e.message.images ?? []); setPreviewMap(e.message.sentenceMap); setPreviewTopicMap(e.message.topicMap); setPreviewWord(e.message.wordExplanation); } if (e.error) setError(e.error.message); }, controller.current.signal); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="admin-card"><h2>Come Lumi accompagna le scoperte · {subjectLabel(subject)}</h2><p>Queste istruzioni guidano il tono e il metodo. Le modifiche salvate valgono dai prossimi messaggi, anche nelle chat già aperte.</p><label htmlFor="prompt">Istruzioni per Lumi</label><textarea className="prompt-input" id="prompt" rows={18} maxLength={20000} value={prompt} onChange={e => { setPrompt(e.target.value); setSaved(false); }}/><div className="button-row"><button className="text-button" onClick={() => setPrompt(initial.defaultPrompt)}><RefreshCw size={16}/>Ripristina il testo iniziale</button><button className="primary-button" disabled={saving || !prompt.trim()} onClick={async () => { setSaving(true); setError(''); try { await updateSettings({ path: { familyId: familyId }, query: { subject }, body: { ...initial, prompt }, throwOnError: true }); setSaved(true); await qc.invalidateQueries(); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }}><Save size={17}/>Salva istruzioni</button></div>{saved && <p className="success-text" role="status">Istruzioni salvate.</p>}
    <div className="preview-section"><h3>Una piccola prova</h3><p className="field-hint">Usa le istruzioni qui sopra senza salvarle. Consuma il piano ChatGPT e non entra nella cronologia.</p><label htmlFor="sample">Parola o frase di prova</label><input id="sample" value={sample} onChange={e => setSample(e.target.value)} maxLength={4000}/><button className="soft-button" disabled={busy || !initial.model || !sample.trim() || !prompt.trim()} onClick={() => void test()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Eye size={17}/>}Prova le istruzioni</button>{(preview || previewImages.length > 0 || previewMap || previewTopicMap || previewWord) && <div className="preview-result"><span className="eyebrow">LUMI RISPONDE</span><p>{preview}</p><SentenceMap map={previewMap}/><TopicMap map={previewTopicMap}/><WordExplanation explanation={previewWord}/><WordImages images={previewImages}/></div>}</div>{error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}

function HistoryPanel() {
  const familyId = familyID();
  const qc = useQueryClient(); const chats = useQuery(listConversationsOptions({ path: { familyId: familyId } })); const [selected, setSelected] = useState<string | null>(null); const [remove, setRemove] = useState<string | null>(null);
  const detail = useQuery({ ...getConversationOptions({ path: { familyId: familyId, conversationId: selected ?? '' } }), enabled: Boolean(selected) });
  return <section className="admin-card"><div className="section-heading"><div><h2>Scoperte dello spazio</h2><p>Rileggi le conversazioni e gestisci ciò che viene conservato.</p></div><button className="text-button danger-text" disabled={!chats.data?.length} onClick={() => setRemove('all')}><Trash2 size={16}/>Elimina tutto</button></div>
    {chats.isPending && <LoadingSkeleton label="Caricamento delle conversazioni"/>}
    {chats.data?.length === 0 && <div className="empty-state"><FileText size={30}/><p>Le prime domande compariranno qui.</p></div>}{chats.isError && <p className="error-text">{errorMessage(chats.error)}</p>}
    <div className="history-table">{chats.data?.map(c => <div className="history-row" key={c.id}><button onClick={() => setSelected(c.id)}><span>{c.title}</span><small>{subjectLabel(c.subject)} · {shortDate(c.createdAt)}</small></button><button className="icon-button danger-text" aria-label={`Elimina ${c.title}`} onClick={() => setRemove(c.id)}><Trash2 size={17}/></button></div>)}</div>
    <Dialog.Root open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog-panel history-dialog"><Dialog.Close className="icon-button close-dialog" aria-label="Chiudi conversazione"><X size={20}/></Dialog.Close><Dialog.Title>{detail.data?.conversation.title ?? 'Conversazione'}</Dialog.Title><Dialog.Description>La cronologia della domanda.</Dialog.Description>{detail.isPending && <LoadingSkeleton label="Caricamento della conversazione" variant="messages" rows={2}/>}{detail.isError && <p className="error-text">{errorMessage(detail.error)}</p>}{detail.data?.messages.map(m => <article key={m.id} className={`message ${m.role}`}><strong>{m.role === 'user' ? 'Domanda' : 'Lumi'}</strong><p>{m.text}</p><SentenceMap map={m.sentenceMap}/><TopicMap map={m.topicMap}/><WordExplanation explanation={m.wordExplanation}/><WordImages images={m.images}/>{m.status !== 'completed' && <small>{m.status === 'streaming' ? 'In corso' : 'Risposta non completata'}</small>}</article>)}</Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Confirm open={remove !== null} onClose={() => setRemove(null)} title={remove === 'all' ? 'Eliminare tutte le scoperte?' : 'Eliminare questa conversazione?'} description="La conversazione e i suoi messaggi verranno eliminati dal server. Le parole nel dizionario restano disponibili. Questa operazione non si può annullare." action="Elimina" onConfirm={async () => { if (remove === 'all') await clearConversations({ path: { familyId: familyId }, throwOnError: true }); else if (remove) await deleteConversation({ path: { familyId: familyId, conversationId: remove }, throwOnError: true }); qc.removeQueries({ predicate: q => Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'object' && q.queryKey[0]?._id === 'getConversation' }); await qc.invalidateQueries({ queryKey: listConversationsQueryKey({ path: { familyId: familyId } }) }); }}/>
  </section>;
}

function Confirm({ open, onClose, title, description, action, onConfirm }: { open: boolean; onClose: () => void; title: string; description: string; action: string; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog-panel"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>{error && <p className="error-text" role="alert">{error}</p>}<div className="button-row"><button className="soft-button" disabled={busy} onClick={onClose}>Annulla</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>{busy ? 'Un attimo…' : action}</button></div></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}

function DictionaryPanel() {
  const familyId = familyID();
  const qc = useQueryClient();
  const words = useQuery(listDictionaryWordsOptions({ path: { familyId } }));
  const [remove, setRemove] = useState<{ id: string; word: string } | 'all' | null>(null);
  return <section className="admin-card">
    <div className="section-heading"><div><h2>Il dizionario</h2><p>Le parole restano qui anche quando elimini le conversazioni.</p></div><button className="text-button danger-text" disabled={!words.data?.length} onClick={() => setRemove('all')}><Trash2 size={16}/>Svuota il dizionario</button></div>
    {words.isPending && <LoadingSkeleton label="Caricamento delle parole"/>}
    {words.isError && <p role="alert" className="error-text">{errorMessage(words.error)} <button className="text-button" onClick={() => void words.refetch()}>Riprova</button></p>}
    {words.data?.length === 0 && <p>Non ci sono ancora parole salvate.</p>}
    <div className="history-table">{words.data?.map(word => <div className="history-row" key={word.id}><span>{word.word}<small>{subjectLabel(word.subject)}</small></span><button className="icon-button danger-text" aria-label={`Elimina la parola ${word.word}`} onClick={() => setRemove({ id: word.id, word: word.word })}><Trash2 size={17}/></button></div>)}</div>
    <Confirm open={remove !== null} onClose={() => setRemove(null)} title={remove === 'all' ? 'Svuotare il dizionario?' : `Eliminare la parola «${remove?.word ?? ''}»?`} description="Le schede selezionate verranno eliminate dal dizionario. Le conversazioni restano disponibili. Questa operazione non si può annullare." action="Elimina" onConfirm={async () => {
      if (remove === 'all') await clearDictionary({ path: { familyId }, throwOnError: true });
      else if (remove) await deleteDictionaryWord({ path: { familyId, entryId: remove.id }, throwOnError: true });
      await qc.invalidateQueries({ queryKey: listDictionaryWordsQueryKey({ path: { familyId } }) });
    }}/>
  </section>;
}
