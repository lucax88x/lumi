import { ArrowRight } from 'lucide-react';
import { StudyClarification } from './StudyClarification';
import { LearningVisual } from './LearningVisual';
import { SubjectPicker, subjectLabel, subjects } from './subjects';
import { familyID, familyPath, useAccount, useSession } from './portal-state';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowDown, ArrowRightLeft, BookOpen, Flower2, Heart, History, House, LockKeyhole, LogOut, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Plus, Send, ShieldCheck, Sparkles, Square, UsersRound, Volume2, WifiOff, X } from 'lucide-react';
import { listConversationsQueryKey, listDictionaryWordsQueryKey, getConversationOptions, getConversationQueryKey, getStatusOptions } from './api/@tanstack/react-query.gen';
import { createConversation } from './api/sdk.gen';
import type { Message, SendMessage, PublicStatus, Subject } from './api/types.gen';
import { Avatar, type Mood } from './Avatar';
import { Recorder } from './Recorder';
import { WordImages } from './WordImages';
import { SentenceMap } from './SentenceMap';
import { TopicMap } from './TopicMap';
import { WordExplanation } from './WordExplanation';
import { WordClarification } from './WordClarification';
import { LoadingSkeleton } from './LoadingSkeleton';
import { useInvitationNotifications } from './InvitationNotifications';
import { ConversationHistory } from './ConversationHistory';
import { useSpeech } from './speech';
import { errorMessage, messageSpeechParts, readStream } from './lib';

function Navigation({ familyId, close, notifications, collapsed = false, toggleCollapsed, openDiscoveries }: { familyId: string; close?: () => void; notifications?: ReactNode; collapsed?: boolean; toggleCollapsed?: () => void; openDiscoveries?: (trigger: HTMLButtonElement) => void }) {
  const session = useSession();
  const family = session.families.find(f => f.id === familyId);
  const { signout, signingOut } = useAccount();
  const pathname = useRouterState({ select: s => s.location.pathname });
  const homeLink = familyId ? { to: '/spazi/$familyId' as const, params: { familyId } } : { to: '/' as const };
  return <>
    <div className="sidebar-header">
      <Link className="brand" {...homeLink} onClick={close} aria-label="Lumi" title={collapsed ? 'Lumi' : undefined}><span className="brand-symbol"><Sparkles size={24} aria-hidden="true"/></span><span className="brand-word">lumi<span className="brand-dot">.</span></span></Link>
      {toggleCollapsed && <button type="button" className="sidebar-toggle" onClick={toggleCollapsed} aria-label={collapsed ? 'Espandi menu laterale' : 'Comprimi menu laterale'} title={collapsed ? 'Espandi menu laterale' : 'Comprimi menu laterale'} aria-expanded={!collapsed} aria-controls="sidebar-navigation">{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button>}
    </div>
    <p className="brand-tagline">Una piccola luce per imparare</p>
    <div className="sidebar-navigation" id={toggleCollapsed ? 'sidebar-navigation' : undefined}>
    <nav aria-label="Navigazione principale" className="main-nav">
      {familyId ? <Link className={`nav-item ${pathname === `/spazi/${familyId}` ? 'selected' : ''}`} aria-label="Il mio angolino" title={collapsed ? 'Il mio angolino' : undefined} aria-current={pathname === `/spazi/${familyId}` ? 'page' : undefined} {...homeLink} onClick={close}><House size={20} aria-hidden="true"/><span className="sidebar-label">Il mio angolino</span></Link> : <Link to="/" onClick={close} aria-label="I tuoi spazi" title={collapsed ? 'I tuoi spazi' : undefined} className={`nav-item ${pathname === '/' ? 'selected' : ''}`}><UsersRound size={20} aria-hidden="true"/><span className="sidebar-label">I tuoi spazi</span></Link>}
      {familyId && <Link to="/spazi/$familyId/dizionario" params={{ familyId }} aria-label="Il mio dizionario" title={collapsed ? 'Il mio dizionario' : undefined} aria-current={pathname === `/spazi/${familyId}/dizionario` ? 'page' : undefined} onClick={close} className={`nav-item ${pathname === `/spazi/${familyId}/dizionario` ? 'selected' : ''}`}><BookOpen size={20} aria-hidden="true"/><span className="sidebar-label">Il mio dizionario</span></Link>}
      {familyId && collapsed && <button type="button" className="nav-item" aria-label="Le mie scoperte" title="Le mie scoperte" aria-haspopup="dialog" onClick={event => openDiscoveries?.(event.currentTarget)}><History size={20} aria-hidden="true"/></button>}
    </nav>
    {familyId && !collapsed && <section className="sidebar-discoveries" aria-label="Le mie scoperte"><div className="history-heading"><h2>Le mie scoperte</h2><Link to="/spazi/$familyId" params={{ familyId }} onClick={close} className="history-new" aria-label="Fai una nuova domanda" title="Fai una nuova domanda"><Plus size={18} aria-hidden="true"/></Link></div><ConversationHistory familyId={familyId} close={close}/></section>}
    <div className="sidebar-bottom">
      <div className="sidebar-tools">
      {notifications}
      {family?.role === 'parent' && <Link to="/spazi/$familyId/coach" params={{ familyId }} className={`sidebar-action ${pathname === `/spazi/${familyId}/coach` ? 'selected' : ''}`} aria-label="Area coach" title={collapsed ? 'Area coach' : undefined} aria-current={pathname === `/spazi/${familyId}/coach` ? 'page' : undefined} onClick={close}><LockKeyhole size={19} aria-hidden="true"/><span className="sidebar-label">Area coach</span></Link>}
      {session.admin && <nav className="sidebar-admin" aria-label="Amministrazione">
        <Link to="/admin" search={{ family: familyId || undefined }} className={`sidebar-action ${pathname === '/admin' ? 'selected' : ''}`} aria-label="Admin" title={collapsed ? 'Admin' : undefined} aria-current={pathname === '/admin' ? 'page' : undefined} onClick={close}><ShieldCheck size={19} aria-hidden="true"/><span className="sidebar-label">Admin</span></Link>
        <Link to="/admin/spazi" search={{ family: familyId || undefined }} className={`sidebar-action ${pathname === '/admin/spazi' ? 'selected' : ''}`} aria-label="Spazi gestiti" title={collapsed ? 'Spazi gestiti' : undefined} aria-current={pathname === '/admin/spazi' ? 'page' : undefined} onClick={close}><UsersRound size={19} aria-hidden="true"/><span className="sidebar-label">Spazi gestiti</span></Link>
      </nav>}
      </div>
      <nav className="sidebar-account" aria-label="Account e spazio">
        <div className="sidebar-identity">
          <UsersRound size={17} aria-hidden="true"/>
          <div><span className="sidebar-family" title={family?.name}>{family?.name ?? 'Lumi'}</span><span className="sidebar-email" title={session.email}>{session.email}</span></div>
        </div>
        <div className="sidebar-account-actions">
          {familyId && <Link to="/" className="sidebar-action" aria-label="Cambia spazio" title={collapsed ? 'Cambia spazio' : undefined} onClick={close}><ArrowRightLeft size={19} aria-hidden="true"/><span className="sidebar-label">Cambia spazio</span></Link>}
          <button type="button" className="sidebar-action" aria-label="Esci" title={collapsed ? 'Esci' : undefined} disabled={signingOut} onClick={() => void signout()}><LogOut size={19} aria-hidden="true"/><span className="sidebar-label">Esci</span></button>
        </div>
      </nav>
    </div>
    </div>
  </>;
}

export function AppShell({ familyId, checkConnection, children }: { familyId: string; checkConnection: boolean; children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [discoveries, setDiscoveries] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('lumi-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try { localStorage.setItem('lumi-sidebar-collapsed', String(collapsed)); } catch { /* The menu also works when storage is unavailable. */ }
  }
  function openDiscoveries(trigger: HTMLButtonElement) {
    discoveriesTrigger.current = trigger;
    setDiscoveries(true);
  }
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const discoveriesTrigger = useRef<HTMLButtonElement>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const status = useQuery({ ...getStatusOptions({ path: { familyId } }), enabled: checkConnection && Boolean(familyId) });
  // Keep the error screen visible during retries, until a request succeeds.
  const connectionError = !online || (checkConnection && (status.isError || status.errorUpdatedAt > status.dataUpdatedAt));
  const notifications = useInvitationNotifications(!connectionError);
  const location = useRouterState({ select: s => s.location.pathname });
  const inConversation = Boolean(familyId) && location.startsWith(`/spazi/${familyId}/domande/`);
  const inDictionary = location === `/spazi/${familyId}/dizionario`;
  const inChat = Boolean(familyId) && (inConversation || location === `/spazi/${familyId}`);
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
  useEffect(() => { setMenu(false); setDiscoveries(false); window.speechSynthesis?.cancel(); }, [location, familyId]);
  useEffect(() => { if (connectionError) { setMenu(false); setDiscoveries(false); window.speechSynthesis?.cancel(); } }, [connectionError]);
  // Follow the visible viewport when a phone's keyboard opens or closes.
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!inChat || !viewport) return;
    const update = () => {
      shell.current?.style.setProperty('--chat-height', `${viewport.height}px`);
      shell.current?.classList.toggle('keyboard-open', window.innerHeight - viewport.height > 150);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => { viewport.removeEventListener('resize', update); shell.current?.style.removeProperty('--chat-height'); shell.current?.classList.remove('keyboard-open'); };
  }, [inChat]);
  return <>
    {connectionError && <main className="connection-error-page" aria-labelledby="connection-error-title">
      <div role="alert"><WifiOff size={40} aria-hidden="true"/><h1 id="connection-error-title">Non riesco a raggiungere Lumi.</h1><p>Controlla la connessione e riprova.</p></div>
      <button className="primary-button" disabled={!online || status.isFetching} onClick={() => void status.refetch()}>{status.isFetching ? 'Riprovo…' : 'Riprova'}</button>
    </main>}
    <div ref={shell} className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${familyId ? 'family-shell' : ''} ${inConversation ? 'chat-shell' : ''}`} hidden={connectionError} inert={connectionError}>
    <aside className="sidebar" aria-label="Menu laterale"><Navigation familyId={familyId} notifications={notifications.button} collapsed={sidebarCollapsed} toggleCollapsed={toggleSidebar} openDiscoveries={openDiscoveries}/></aside>
    <div className="main-shell">
      <header className="topbar"><Link {...(familyId ? { to: '/spazi/$familyId' as const, params: { familyId } } : { to: '/' as const })} className="topbar-brand" aria-label={familyId ? 'Lumi, fai una domanda' : 'Lumi, i tuoi spazi'}>lumi<span>.</span></Link><div className="topbar-actions">{notifications.button}<button ref={menuTrigger} className="menu-button" aria-label="Apri menu" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={20}/><span>Menu</span></button></div></header>
      <main id="main">{children}</main>
      <footer className="page-footer"><Heart size={13}/> Un piccolo aiuto, una scoperta alla volta.<span>Lumi è un assistente artificiale.</span></footer>
      {familyId && <nav className="mobile-tabs" aria-label="Il tuo angolino">
        <Link to="/spazi/$familyId" params={{ familyId }} className={!inDictionary && (inConversation || location === `/spazi/${familyId}`) ? 'selected' : ''} aria-current={location === `/spazi/${familyId}` ? 'page' : undefined}><MessageCircle size={23} aria-hidden="true"/><span>Domanda</span></Link>
        <button type="button" className={discoveries ? 'selected' : ''} aria-haspopup="dialog" aria-expanded={discoveries} onClick={event => openDiscoveries(event.currentTarget)}><History size={23} aria-hidden="true"/><span>Scoperte</span></button>
        <Link to="/spazi/$familyId/dizionario" params={{ familyId }} className={inDictionary ? 'selected' : ''} aria-current={inDictionary ? 'page' : undefined}><BookOpen size={23} aria-hidden="true"/><span>Dizionario</span></Link>
      </nav>}
    </div>
    <Dialog.Root open={menu && !connectionError} onOpenChange={setMenu}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="mobile-nav-panel" finalFocus={menuTrigger}><Dialog.Title className="sr-only">Navigazione principale</Dialog.Title><Dialog.Close className="icon-button close-dialog" aria-label="Chiudi menu"><X size={20}/></Dialog.Close><Navigation familyId={familyId} close={() => setMenu(false)}/></Dialog.Popup></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={discoveries && !connectionError} onOpenChange={setDiscoveries}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="discoveries-panel" finalFocus={discoveriesTrigger}><div className="discoveries-heading"><div><Dialog.Title>Le mie scoperte</Dialog.Title><Dialog.Description>Riprendi una domanda quando vuoi.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Chiudi scoperte"><X size={22}/></Dialog.Close></div>{familyId && <ConversationHistory familyId={familyId} close={() => setDiscoveries(false)}/>}</Dialog.Popup></Dialog.Portal></Dialog.Root>
    {notifications.dialog}
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
        <p className="portal-status-description">{isAdmin ? 'Apri Admin per preparare Lumi per tutti gli spazi.' : 'Un amministratore sta preparando Lumi. Il tuo angolino ti aspetta.'}</p>
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
  const [selectedSubject, setSelectedSubject] = useState<Subject>('italian');
  const subject = detail.data?.conversation.subject ?? selectedSubject;
  const isStudy = ['history', 'geography', 'science', 'geometry'].includes(subject);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [live, setLive] = useState<Message | null>(null);
  const [pendingUser, setPendingUser] = useState<Message | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{ kind: 'sentence' | 'topic' | 'visual'; context: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const readingArea = useRef<HTMLDivElement>(null);
  const followAnswer = useRef(true);
  const revealedStudy = useRef<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(status.speechRate);
  const speechRef = useRef(speech); speechRef.current = speech;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); speechRef.current.stop(); }; }, []);
  useEffect(() => { speechRef.current.stop(); revealedStudy.current = null; }, [id]);
  // Only the plain question is handed across the route transition; it stays in memory.
  useEffect(() => {
    if (!id) return;
    const text = qc.getQueryData<string>(['pending-question', familyId, id]);
    if (text) { qc.removeQueries({ queryKey: ['pending-question', familyId, id] }); setQueued(text); }
  }, [id, qc]);
  useEffect(() => { if (queued && id && detail.data) { const text = queued; setQueued(null); void submit('message', text); } }, [queued, id, detail.data]);
  useEffect(() => {
    const area = readingArea.current;
    if (!area) return;
    const latest = live ?? detail.data?.messages.at(-1);
    if (isStudy && latest?.role === 'assistant' && (latest.learningVisual || latest.topicMap || latest.studyClarification) && revealedStudy.current !== latest.id) {
      const article = [...area.querySelectorAll<HTMLElement>('[data-message-id]')].find(element => element.dataset.messageId === latest.id);
      if (article) {
        revealedStudy.current = latest.id;
        followAnswer.current = false;
        area.scrollTop += article.getBoundingClientRect().top - area.getBoundingClientRect().top - 8;
        setShowLatest(false);
        return;
      }
    }
    if (followAnswer.current) area.scrollTop = area.scrollHeight;
  }, [detail.dataUpdatedAt, pendingUser?.id, live?.text, live?.status, live?.images, live?.sentenceMap, live?.topicMap, live?.wordExplanation, live?.wordClarification, live?.studyClarification, live?.learningVisual, busy]);

  function updateReadingPosition(area: HTMLDivElement) {
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
    followAnswer.current = nearBottom;
    const viewport = area.getBoundingClientRect();
    const readingStudy = isStudy && [...area.querySelectorAll<HTMLElement>('.learning-visual, .topic-map, .study-clarification')].some(lesson => {
      const bounds = lesson.getBoundingClientRect();
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    });
    setShowLatest(!nearBottom && !readingStudy);
  }

  async function submit(action: SendMessage['action'] = 'message', override?: string) {
    const currentVisual = (live ?? detail.data?.messages.at(-1))?.learningVisual;
    const firstPoint = currentVisual?.kind === 'geometry' ? currentVisual.figures[0] : currentVisual?.kind === 'diagram' ? currentVisual.nodes[0] : currentVisual?.features[0];
    const focus = mapFocus ?? (currentVisual && firstPoint ? { kind: 'visual', context: `Il punto selezionato è «${firstPoint.label}», nella visuale «${currentVisual.title}».` } : null);
    const focusedText = action !== 'message' && focus ? `${focus.kind !== 'sentence' ? (action === 'simplify' ? 'Puoi spiegarmi questo punto con parole più facili?' : action === 'example' ? 'Mi fai un esempio di questo punto?' : actionText[action]) : actionText[action]} ${focus.context}` : null;
    const requestAction = focusedText ? 'message' : action;
    const text = focusedText ?? override ?? draft.trim();
    if (locked.current || recording || (id && !detail.data) || (!text && action === 'message')) return;
    speech.stop(); setError(''); locked.current = true; setBusy(true); followAnswer.current = true; setShowLatest(false);
    if (action === 'message') setMapFocus(null);
    try {
      if (!id) {
        const newID = crypto.randomUUID();
        await createConversation({ path: { familyId: familyId }, body: { subject, id: newID, title: [...text].slice(0, 80).join('') }, throwOnError: true });
        if (!mounted.current) return;
        qc.setQueryData(['pending-question', familyId, newID], text);
        await qc.invalidateQueries({ queryKey: listConversationsQueryKey({ path: { familyId: familyId } }) });
        await navigate({ to: '/spazi/$familyId/domande/$id', params: { familyId: familyId, id: newID } });
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
        if (event.type === 'completed' && event.message && status.autoRead) speechRef.current.speak(messageSpeechParts(event.message), event.message.id);
        if (event.type === 'failed') { setError(event.error?.message ?? 'La risposta si è interrotta. Puoi riprovare.'); if (action === 'message' && override === undefined) setDraft(text); }
      }, controller.current.signal);
    } catch (e) {
      if (mounted.current) { setError(errorMessage(e)); setLive(previous => previous ? { ...previous, status: 'interrupted' } : null); if (action === 'message') setDraft(text); }
    } finally {
      if (id) {
        await qc.invalidateQueries({ queryKey: listDictionaryWordsQueryKey({ path: { familyId } }) });
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
  const latestMessage = messages.at(-1);
  const clarificationMessage = latestMessage?.role === 'assistant' && latestMessage.status === 'completed' && latestMessage.wordClarification ? latestMessage : undefined;
  const clarification = clarificationMessage?.wordClarification;
  const studyClarificationMessage = latestMessage?.role === 'assistant' && latestMessage.status === 'completed' && latestMessage.studyClarification ? latestMessage : undefined;
  const studyClarification = studyClarificationMessage?.studyClarification;
  const externallyBusy = detail.data?.messages.some(m => m.status === 'streaming') ?? false;
  const mood: Mood = recording ? 'listening' : busy ? 'thinking' : speech.speaking ? 'speaking' : 'idle';
  const canSend = !busy && !recording && !externallyBusy && (!id || Boolean(detail.data)) && navigator.onLine;
  return <div className={`child-page ${id ? 'conversation-page' : 'home-page'} ${id && isStudy ? 'study-conversation' : ''}`}>
    {!id ? <>
      <section className="welcome"><div className="welcome-art"><Avatar mood={mood}/></div><div className="welcome-copy"><p>Ciao, sono Lumi!</p><h1>Che cosa vuoi capire?<br/>Scopriamolo insieme.</h1><p>Puoi scrivere o parlare. Ti aiuto un pezzetto alla volta.</p></div></section>
    </> : <>
      <header className="chat-title"><Avatar mood={mood}/><div><h1 title={detail.data?.conversation.title}>{detail.data?.conversation.title ?? 'La tua domanda'}</h1><p className="chat-subject">{subjectLabel(subject)} con Lumi</p></div><Link to="/spazi/$familyId" params={{ familyId }} className="new-question" aria-label="Fai una nuova domanda"><Plus size={20}/><span>Nuova domanda</span></Link></header>
      <div className="chat-reading-area">
      <div ref={readingArea} className="chat-scroll" tabIndex={0} role="region" aria-label="Leggi la conversazione" onScroll={event => updateReadingPosition(event.currentTarget)}>
      {detail.isPending && <LoadingSkeleton label="Caricamento della conversazione" variant="messages" rows={2}/>}
      {detail.isError && <p role="alert" className="notice error-notice">{errorMessage(detail.error)} <button className="text-button" onClick={() => void detail.refetch()}>Riprova</button></p>}
      <div className="messages" role="log" aria-label="Conversazione con Lumi" aria-live="off">
        {messages.map(m => <article key={m.id} data-message-id={m.id} className={`message ${m.role}`}><div className="message-label">{m.role === 'user' ? <><span className="you-dot"/>La tua domanda</> : <><Sparkles size={15}/>Lumi</>}</div><p>{m.text || ((m.wordExplanation || m.wordClarification || m.studyClarification || m.learningVisual) ? '' : m.status === 'streaming' ? 'Accendo una piccola idea…' : (m.images?.length || m.sentenceMap || m.topicMap) ? '' : 'La risposta non è arrivata. Puoi riprovare.')}</p><SentenceMap map={m.sentenceMap} onSelect={index => { speech.stop(); setMapFocus(index !== null && m.sentenceMap ? { kind: 'sentence', context: `Il pezzetto è «${m.sentenceMap.parts[index].text}», nella frase «${m.sentenceMap.sentence}».` } : null); }} readingPart={speech.activeMessageId?.startsWith(`${m.id}:part:`) ? Number(speech.activeMessageId.split(':').at(-1)) : undefined} onRead={m.status === 'completed' ? (text, index) => speech.activeMessageId === `${m.id}:part:${index}` ? speech.stop() : speech.speak(text, `${m.id}:part:${index}`) : undefined}/><TopicMap map={m.topicMap} onSelect={point => { speech.stop(); setMapFocus(point && m.topicMap ? { kind: 'topic', context: `Il punto è «${point.label}», nel ramo «${point.branch}» della mappa «${m.topicMap.title}».` } : null); }} readingNode={speech.activeMessageId?.startsWith(`${m.id}:topic:`) ? speech.activeMessageId.split(':').at(-1) : undefined} onRead={m.status === 'completed' ? (text, node) => speech.activeMessageId === `${m.id}:topic:${node}` ? speech.stop() : speech.speak(text, `${m.id}:topic:${node}`) : undefined}/><WordExplanation explanation={m.wordExplanation} readingPart={speech.activeMessageId?.startsWith(`${m.id}:word:`) ? speech.activeMessageId.split(':').at(-1) : undefined} onRead={m.status === 'completed' ? (text, part) => speech.activeMessageId === `${m.id}:word:${part}` ? speech.stop() : speech.speak(text, `${m.id}:word:${part}`) : undefined}/><WordClarification clarification={m.wordClarification} disabled={!canSend} onChoose={m.id === clarificationMessage?.id && clarification ? sentence => void submit('message', `Per «${clarification.word}», intendo questo esempio: «${sentence}»`) : undefined}/><StudyClarification clarification={m.studyClarification} disabled={!canSend} onChoose={m.id === studyClarificationMessage?.id && studyClarification ? reply => void submit('message', `Per «${studyClarification.topic}»: ${reply}`) : undefined}/><LearningVisual visual={m.learningVisual} onSelect={label => { speech.stop(); setMapFocus(label && m.learningVisual ? { kind: 'visual', context: `Il punto selezionato è «${label}», nella visuale «${m.learningVisual.title}».` } : null); }} readingNode={speech.activeMessageId?.startsWith(`${m.id}:visual:`) ? speech.activeMessageId.split(':').at(-1) : undefined} onRead={m.status === 'completed' ? (text, node) => speech.activeMessageId === `${m.id}:visual:${node}` ? speech.stop() : speech.speak(text, `${m.id}:visual:${node}`) : undefined}/><WordImages images={m.images}/>{m.role === 'assistant' && <div className="message-tools">{m.status === 'completed' && <button className="listen-button" onClick={() => speech.activeMessageId === m.id ? speech.stop() : speech.speak(messageSpeechParts(m), m.id)}>{speech.activeMessageId === m.id ? <><Square size={16}/>Ferma la voce</> : <><Volume2 size={16}/>Riascolta</>}</button>}{m.status === 'interrupted' && <span className="partial-label">La risposta si è interrotta</span>}{m.status === 'streaming' && <span className="thinking-dots" aria-label="Lumi sta pensando"><i/><i/><i/></span>}</div>}</article>)}
      </div>
      {lastAnswer && !clarification && !studyClarification && !busy && <div className="followups">
        <button className="soft-button" disabled={!canSend} onClick={() => void submit('simplify')}><Flower2 size={17}/>Più facile</button>
        <button className="soft-button" disabled={!canSend} onClick={() => void submit('example')}><Sparkles size={17}/>Fammi un esempio</button>
        {(mapFocus || ['history', 'geography', 'science', 'geometry'].includes(subject)) && <button className="soft-button" disabled={!canSend} onClick={() => void submit('next')}>Continua<ArrowRight size={17}/></button>}
      </div>}
      </div>
      {showLatest && <button className="latest-answer" onClick={() => { const area = readingArea.current; followAnswer.current = true; setShowLatest(false); area?.scrollTo({ top: area.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><ArrowDown size={18}/>Ultima risposta</button>}
      </div>
    </>}
    {speech.blocked && <p className="notice">La voce ha bisogno di un tocco, oppure di una voce {speech.missingLanguage === 'en' ? 'inglese' : 'italiana'} installata sul dispositivo. {lastAnswer && <button className="text-button" onClick={() => speech.speak(messageSpeechParts(lastAnswer), lastAnswer.id)}>Tocca per ascoltare</button>}</p>}
    <section className="question-card" aria-label="Fai una domanda">
      <div className="question-heading"><h2>{studyClarification ? 'Che cosa vuoi scoprire?' : clarification ? `La frase con «${clarification.word}»` : id ? 'Continuiamo?' : 'Che cosa scopriamo oggi?'}</h2>{id && <span className="composer-hint">Scrivi o parla con Lumi</span>}</div>
      {!id && <><SubjectPicker value={selectedSubject} disabled={busy || recording} onChange={value => { speech.stop(); setSelectedSubject(value); }}/><p className="subject-intro">{subjects.find(item => item.id === subject)?.hint}</p></>}
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label htmlFor="question" className="sr-only">Scrivi una parola o una frase</label>
        <textarea id="question" ref={textarea} value={draft} onChange={e => { setDraft(e.target.value); setTranscribed(false); }} placeholder={studyClarification ? 'Scrivi o racconta un esempio…' : clarification ? clarification.examples.length ? 'Scrivi quello che intendi…' : `Scrivi la frase con «${clarification.word}»…` : id ? 'Scrivi un’altra domanda…' : subjects.find(item => item.id === subject)?.example} rows={id ? 1 : 2} maxLength={4000} disabled={busy || recording} aria-describedby={transcribed ? 'transcript-review' : undefined}/>
        {transcribed && <p id="transcript-review" className="transcript-note" role="status">Ho scritto quello che hai detto. Puoi correggerlo, poi tocca «Scopriamo!».</p>}
        <div className="composer-bottom"><Recorder key={subject} subject={subject} disabled={busy || externallyBusy || (Boolean(id) && !detail.data)} onStart={speech.stop} onState={setRecording} onText={text => { setDraft(text); setTranscribed(true); textarea.current?.focus(); }}/><button type="submit" className="primary-button send-button" disabled={!canSend || !draft.trim()}>{busy || externallyBusy ? 'Lumi pensa…' : 'Scopriamo!'}<Send size={19}/></button></div>
      </form>
      {clarification && clarification.examples.length === 0 && <button type="button" className="text-button no-context-button" disabled={!canSend} onClick={() => void submit('message', `Non ho una frase per «${clarification.word}».`)}>Non ho una frase</button>}
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {id && <p className="chat-disclosure">Lumi è un assistente artificiale e può sbagliare.</p>}
    </section>
    {!id && <p className="gentle-note"><Heart size={15}/>Qui tutte le domande sono benvenute. Anche quelle piccolissime.</p>}
  </div>;
}
