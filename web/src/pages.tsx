import { familyID, familyPath, useAccount, useSession } from './portal-state';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowRight, ArrowRightLeft, ChevronRight, Flower2, Heart, History, House, LockKeyhole, LogOut, Menu, MessageCircle, Send, Sparkles, Square, UsersRound, Volume2, WifiOff, X } from 'lucide-react';
import { listConversationsOptions, listConversationsQueryKey, getConversationOptions, getConversationQueryKey, getStatusOptions } from './api/@tanstack/react-query.gen';
import { createConversation } from './api/sdk.gen';
import type { Message, SendMessage, ConversationDetail, PublicStatus } from './api/types.gen';
import { Avatar, type Mood } from './Avatar';
import { Recorder } from './Recorder';
import { WordImages } from './WordImages';
import { SentenceMap } from './SentenceMap';
import { TopicMap } from './TopicMap';
import { useSpeech } from './speech';
import { errorMessage, readStream, shortDate } from './lib';

function Navigation({ familyId, close }: { familyId: string; close?: () => void }) {
  const session = useSession();
  const family = session.families.find(f => f.id === familyId);
  const { signout, signingOut } = useAccount();
  const chats = useQuery({ ...listConversationsOptions({ path: { familyId } }), enabled: Boolean(familyId) });
  const pathname = useRouterState({ select: s => s.location.pathname });
  const homeLink = familyId ? { to: '/famiglie/$familyId' as const, params: { familyId } } : { to: '/' as const };
  return <>
    <Link className="brand" {...homeLink} onClick={close}><span className="brand-symbol"><Sparkles size={24}/></span><span>lumi<span className="brand-dot">.</span></span></Link>
    <p className="brand-tagline">Una piccola luce per imparare</p>
    <nav aria-label="Navigazione principale" className="main-nav">
      <Link className={`nav-item ${pathname === `/famiglie/${familyId}` ? 'selected' : ''}`} {...homeLink} onClick={close}><House size={20}/>Il mio angolino<span className="nav-dot"/></Link>
    </nav>
    <div className="history-heading"><span>LE MIE SCOPERTE</span><History size={15}/></div>
    <div className="sidebar-history">
      {!familyId && <p className="history-empty">Scegli una famiglia per vedere le tue scoperte.</p>}
      {chats.data?.length === 0 && <p className="history-empty">Le tue domande saranno qui.<br/>Pronte da riscoprire!</p>}
      {chats.isError && <button className="text-button" onClick={() => void chats.refetch()}>Ricarica le mie domande</button>}
      {chats.data?.map(c => <Link key={c.id} to="/famiglie/$familyId/domande/$id" params={{ familyId: familyId, id: c.id }} onClick={close} className={`history-item ${pathname === `/famiglie/${familyId}/domande/${c.id}` ? 'active' : ''}`}><MessageCircle size={17}/><span>{c.title}<small>{shortDate(c.createdAt)}</small></span></Link>)}
    </div>
    <div className="sidebar-bottom">
      {familyId && <Link to="/famiglie/$familyId/genitore" params={{ familyId }} className="sidebar-action" onClick={close}><LockKeyhole size={17}/>Angolo del genitore</Link>}
      {session.admin && <Link to="/admin" search={{ family: familyId || undefined }} className="sidebar-action" onClick={close}><LockKeyhole size={17}/>Admin</Link>}
      <nav className="sidebar-account" aria-label="Account e famiglia">
        <div className="sidebar-identity">
          <UsersRound size={17} aria-hidden="true"/>
          <div><span className="sidebar-family" title={family?.name}>{family?.name ?? 'Lumi'}</span><span className="sidebar-email" title={session.email}>{session.email}</span></div>
        </div>
        <div className="sidebar-account-actions">
          <Link to="/" className="sidebar-action" onClick={close}><ArrowRightLeft size={17}/>Cambia famiglia</Link>
          <button type="button" className="sidebar-action" disabled={signingOut} onClick={() => void signout()}><LogOut size={17}/>Esci</button>
        </div>
      </nav>
    </div>
  </>;
}

export function AppShell({ familyId = familyID(), checkConnection = true, children }: { familyId?: string; checkConnection?: boolean; children?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const status = useQuery({ ...getStatusOptions({ path: { familyId } }), enabled: checkConnection && Boolean(familyId) });
  // Keep the error screen visible during retries, until a request succeeds.
  const connectionError = !online || (checkConnection && (status.isError || status.errorUpdatedAt > status.dataUpdatedAt));
  const location = useRouterState({ select: s => s.location.pathname });
  useEffect(() => {
    // The HTML splash outlives React startup and is removed only once the
    // first connection check resolves (or the browser is already offline).
    if (checkConnection && status.isPending && online) return;
    const root = document.getElementById('root');
    if (root) { root.hidden = false; root.inert = false; }
    document.getElementById('lumi-splash')?.remove();
  }, [checkConnection, status.isPending, online]);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => { window.speechSynthesis?.cancel(); }, [location]);
  useEffect(() => { if (connectionError) { setMenu(false); window.speechSynthesis?.cancel(); } }, [connectionError]);
  return <>
    {connectionError && <main className="connection-error-page" aria-labelledby="connection-error-title">
      <div role="alert"><WifiOff size={40} aria-hidden="true"/><h1 id="connection-error-title">Non riesco a raggiungere Lumi.</h1><p>Controlla la connessione e riprova.</p></div>
      <button className="primary-button" disabled={!online || status.isFetching} onClick={() => void status.refetch()}>{status.isFetching ? 'Riprovo…' : 'Riprova'}</button>
    </main>}
    <div className="app-shell" hidden={connectionError} inert={connectionError}>
    <aside className="sidebar"><Navigation familyId={familyId}/></aside>
    <div className="main-shell">
      <header className="topbar"><button className="icon-button" aria-label="Apri menu" onClick={() => setMenu(true)}><Menu size={22}/></button><span className="topbar-brand">lumi.</span></header>
      <main id="main">{children ?? <Outlet/>}</main>
      <footer className="page-footer"><Heart size={13}/> Un piccolo aiuto, una scoperta alla volta.<span>Lumi è un assistente artificiale.</span></footer>
    </div>
    <Dialog.Root open={menu && !connectionError} onOpenChange={setMenu}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="mobile-nav-panel"><Dialog.Title className="sr-only">Le tue domande</Dialog.Title><Dialog.Close className="icon-button close-dialog" aria-label="Chiudi menu"><X size={20}/></Dialog.Close><Navigation familyId={familyId} close={() => setMenu(false)}/></Dialog.Popup></Dialog.Portal></Dialog.Root>
  </div></>;
}

const actionText = { next: 'Continua con il prossimo pezzetto.', simplify: 'Puoi spiegarmi questo pezzetto con parole più facili?', example: 'Mi fai un esempio di questo pezzetto?' };

export function ChatPage({ id }: { id?: string }) {
  const familyId = familyID();
  const session = useSession();
  const status = useQuery(getStatusOptions({ path: { familyId } }));
  if (!status.data) return null;
  if (!status.data.ready) {
    const isAdmin = session.admin;
    return <div className="family-setup">
      <section className="portal-card portal-status-card" aria-labelledby="family-setup-title">
        <div className="portal-status-art" aria-hidden="true"><Avatar/></div>
        <h1 id="family-setup-title">Lumi si sta preparando</h1>
        <p className="portal-status-description">{isAdmin ? 'Apri Admin per preparare Lumi per tutte le famiglie.' : 'Un amministratore sta preparando Lumi. Il tuo angolino ti aspetta.'}</p>
        <div className="portal-status-actions">
          {isAdmin && <Link className="primary-button" to="/admin" search={{ family: familyId }}><LockKeyhole size={17}/>Apri Admin</Link>}
          <button className={isAdmin ? 'text-button' : 'primary-button'} disabled={status.isFetching} onClick={() => void status.refetch()}>{status.isFetching ? 'Controllo…' : 'Controlla se è pronta'}</button>
        </div>
      </section>
    </div>;
  }
  return <ReadyChatPage id={id} status={status.data}/>;
}

function ReadyChatPage({ id, status }: { id?: string; status: PublicStatus }) {
  const familyId = familyID();
  const navigate = useNavigate(); const qc = useQueryClient();
  const detail = useQuery({ ...getConversationOptions({ path: { familyId: familyId, conversationId: id ?? '' } }), enabled: Boolean(id), refetchInterval: query => query.state.data?.messages.some(m => m.status === 'streaming') ? 2000 : false });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [live, setLive] = useState<Message | null>(null);
  const [pendingUser, setPendingUser] = useState<Message | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{ kind: 'sentence' | 'topic'; context: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(status.speechRate);
  const speechRef = useRef(speech); speechRef.current = speech;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); speechRef.current.stop(); }; }, []);
  useEffect(() => { speechRef.current.stop(); }, [id]);
  // Only the plain question is handed across the route transition; it stays in memory.
  useEffect(() => {
    if (!id) return;
    const text = qc.getQueryData<string>(['pending-question', familyId, id]);
    if (text) { qc.removeQueries({ queryKey: ['pending-question', familyId, id] }); setQueued(text); }
  }, [id, qc]);
  useEffect(() => { if (queued && id && detail.data) { const text = queued; setQueued(null); void submit('message', text); } }, [queued, id, detail.data]);
  useEffect(() => { if (live) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [live?.id, live?.status, live?.images, live?.sentenceMap, live?.topicMap]);

  async function submit(action: SendMessage['action'] = 'message', override?: string) {
    const focusedText = action !== 'message' && mapFocus ? `${mapFocus.kind === 'topic' ? (action === 'simplify' ? 'Puoi spiegarmi questo punto della mappa con parole più facili?' : action === 'example' ? 'Mi fai un esempio di questo punto della mappa?' : actionText[action]) : actionText[action]} ${mapFocus.context}` : null;
    const requestAction = focusedText ? 'message' : action;
    const text = focusedText ?? override ?? draft.trim();
    if (locked.current || recording || (!text && action === 'message')) return;
    speech.stop(); setError(''); locked.current = true; setBusy(true);
    if (action === 'message') setMapFocus(null);
    try {
      if (!id) {
        const newID = crypto.randomUUID();
        await createConversation({ path: { familyId: familyId }, body: { id: newID, title: [...text].slice(0, 80).join('') }, throwOnError: true });
        if (!mounted.current) return;
        qc.setQueryData(['pending-question', familyId, newID], text);
        await qc.invalidateQueries({ queryKey: listConversationsQueryKey({ path: { familyId: familyId } }) });
        await navigate({ to: '/famiglie/$familyId/domande/$id', params: { familyId: familyId, id: newID } });
        return;
      }
      const requestId = crypto.randomUUID();
      const sentText = requestAction === 'message' ? text : actionText[requestAction];
      setPendingUser({ id: `pending-${requestId}`, conversationId: id, role: 'user', text: sentText, status: 'completed', createdAt: new Date().toISOString() });
      setLive(null); setDraft(''); setTranscribed(false);
      controller.current = new AbortController();
      await readStream(familyPath(`/conversations/${encodeURIComponent(id)}/messages`, familyId), { requestId, action: requestAction, text }, event => {
        if (!mounted.current) return;
        if (event.message) setLive(event.message);
        if (event.type === 'delta') setLive(previous => previous ? { ...previous, text: previous.text + (event.delta ?? '') } : previous);
        if (event.type === 'completed' && event.message && status.autoRead) speechRef.current.speak(event.message.text, event.message.id);
        if (event.type === 'failed') setError(event.error?.message ?? 'La risposta si è interrotta. Puoi riprovare.');
      }, controller.current.signal);
    } catch (e) {
      if (mounted.current) { setError(errorMessage(e)); setLive(previous => previous ? { ...previous, status: 'interrupted' } : null); if (action === 'message') setDraft(text); }
    } finally {
      if (id) {
        await qc.invalidateQueries({ queryKey: getConversationQueryKey({ path: { familyId: familyId, conversationId: id } }) });
        await qc.invalidateQueries({ queryKey: listConversationsQueryKey({ path: { familyId: familyId } }) });
      }
      if (mounted.current) { setBusy(false); setPendingUser(null); }
      locked.current = false;
    }
  }
  const messages = [...(detail.data?.messages ?? [])];
  if (pendingUser && !messages.some(m => m.role === 'user' && m.text === pendingUser.text && new Date(m.createdAt).getTime() >= new Date(pendingUser.createdAt).getTime() - 1000)) messages.push(pendingUser);
  if (live) { const index = messages.findIndex(m => m.id === live.id); if (index >= 0) messages[index] = live; else messages.push(live); }
  const lastAnswer = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'completed');
  const externallyBusy = detail.data?.messages.some(m => m.status === 'streaming') ?? false;
  const mood: Mood = recording ? 'listening' : busy ? 'thinking' : speech.speaking ? 'speaking' : 'idle';
  const canSend = !busy && !recording && !externallyBusy && navigator.onLine;
  return <div className={`child-page ${id ? 'conversation-page' : 'home-page'}`}>
    {!id ? <>
      <section className="welcome"><div className="welcome-art"><span className="avatar-bubble">Ciao! Sono Lumi <span>✦</span></span><Avatar mood={mood}/><span className="art-flower">✳</span><span className="art-star">✧</span><span className="art-caption">La tua compagna di scoperte</span></div></section>
    </> : <>
      <div className="conversation-heading"><Link to="/famiglie/$familyId" params={{ familyId: familyId }} className="back-link"><House size={16}/>Il mio angolino</Link><ChevronRight size={15}/><span>Una nuova scoperta</span></div>
      <div className="chat-title"><Avatar mood={mood}/><div><span className="eyebrow">SCOPRIAMO INSIEME</span><h1>{detail.data?.conversation.title ?? 'La tua domanda'}</h1><p>Non c’è fretta. Facciamo un pezzetto alla volta.</p></div></div>
      {detail.isPending && <p role="status" className="loading-text">Cerco la tua domanda…</p>}
      {detail.isError && <p role="alert" className="notice error-notice">{errorMessage(detail.error)} <button className="text-button" onClick={() => void detail.refetch()}>Riprova</button></p>}
      <div className="messages" role="log" aria-label="Conversazione con Lumi" aria-live="off">
        {messages.map(m => <article key={m.id} className={`message ${m.role}`}><div className="message-label">{m.role === 'user' ? <><span className="you-dot"/>La tua domanda</> : <><Sparkles size={15}/>Lumi</>}</div><p>{m.text || (m.status === 'streaming' ? 'Accendo una piccola idea…' : (m.images?.length || m.sentenceMap || m.topicMap) ? '' : 'La risposta non è arrivata. Puoi riprovare.')}</p><SentenceMap map={m.sentenceMap} onSelect={index => { speech.stop(); setMapFocus(index !== null && m.sentenceMap ? { kind: 'sentence', context: `Il pezzetto è «${m.sentenceMap.parts[index].text}», nella frase «${m.sentenceMap.sentence}».` } : null); }} readingPart={speech.activeMessageId?.startsWith(`${m.id}:part:`) ? Number(speech.activeMessageId.split(':').at(-1)) : undefined} onRead={m.status === 'completed' ? (text, index) => speech.activeMessageId === `${m.id}:part:${index}` ? speech.stop() : speech.speak(text, `${m.id}:part:${index}`) : undefined}/><TopicMap map={m.topicMap} onSelect={point => { speech.stop(); setMapFocus(point && m.topicMap ? { kind: 'topic', context: `Il punto è «${point.label}», nel ramo «${point.branch}» della mappa «${m.topicMap.title}».` } : null); }} readingNode={speech.activeMessageId?.startsWith(`${m.id}:topic:`) ? speech.activeMessageId.split(':').at(-1) : undefined} onRead={m.status === 'completed' ? (text, node) => speech.activeMessageId === `${m.id}:topic:${node}` ? speech.stop() : speech.speak(text, `${m.id}:topic:${node}`) : undefined}/><WordImages images={m.images}/>{m.role === 'assistant' && <div className="message-tools">{m.status === 'completed' && <button className="listen-button" onClick={() => speech.activeMessageId === m.id ? speech.stop() : speech.speak(m.text, m.id)}>{speech.activeMessageId === m.id ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Riascolta</>}</button>}{m.status === 'interrupted' && <span className="partial-label">La risposta si è interrotta</span>}{m.status === 'streaming' && <span className="thinking-dots" aria-label="Lumi sta pensando"><i/><i/><i/></span>}</div>}</article>)}
        <div ref={bottom}/>
      </div>
      {lastAnswer && !busy && <div className="followups">
        <button className="soft-button" disabled={!canSend} onClick={() => void submit('simplify')}><Flower2 size={17}/>Più facile</button>
        <button className="soft-button" disabled={!canSend} onClick={() => void submit('example')}><Sparkles size={17}/>Fammi un esempio</button>
      </div>}
    </>}
    {speech.blocked && <p className="notice">La voce ha bisogno di un tocco, oppure di una voce italiana installata sul dispositivo. {lastAnswer && <button className="text-button" onClick={() => speech.speak(lastAnswer.text, lastAnswer.id)}>Tocca per ascoltare</button>}</p>}
    <section className="question-card" aria-label="Fai una domanda">
      <div className="question-heading"><span className="tiny-spark"><Sparkles size={20}/></span><h2>{id ? 'Vuoi chiedermi qualcosa?' : 'Che cosa scopriamo oggi?'}</h2></div>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label htmlFor="question" className="sr-only">Scrivi una parola o una frase</label>
        <textarea id="question" ref={textarea} value={draft} onChange={e => { setDraft(e.target.value); setTranscribed(false); }} placeholder={id ? 'Scrivi qui, oppure raccontamelo a voce…' : 'Scrivi qui una parola o una frase…'} rows={id ? 2 : 3} maxLength={4000} disabled={busy || recording}/>
        {transcribed && <p className="transcript-note">Ho capito questo. Va bene? Puoi correggerlo e poi premere «Scopriamo!».</p>}
        <div className="composer-bottom"><Recorder disabled={busy || externallyBusy} onStart={speech.stop} onState={setRecording} onText={text => { setDraft(text); setTranscribed(true); textarea.current?.focus(); }}/><span className="or-label">oppure</span><button type="submit" className="primary-button send-button" disabled={!canSend || !draft.trim()}>{busy ? 'Un attimo…' : 'Scopriamo!'}<ArrowRight size={19}/></button></div>
      </form>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
    </section>
    {!id && <p className="gentle-note"><Heart size={15}/>Qui tutte le domande sono benvenute. Anche quelle piccolissime.</p>}
  </div>;
}
