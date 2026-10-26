import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import { getSessionOptions, getSessionQueryKey, listMembersOptions, listInvitationsOptions } from './api/@tanstack/react-query.gen';
import { acceptInvitation, createFamily, createInvitation, logout, removeMember, revokeInvitation, updateMember } from './api/sdk.gen';
import { AccountContext, SessionContext, familyID, useSession } from './portal-state';
import { errorMessage, setCSRF } from './lib';
import { Avatar, type Mood } from './Avatar';
import type { Family } from './api/types.gen';
import { LoadingSkeleton } from './LoadingSkeleton';
import { AppShell } from './pages';

function login() { window.location.assign(`/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.hash)}`); }

function PortalStatus({ title, description, children, footer, mood = 'idle', loading = false }: { title: string; description: string; children?: ReactNode; footer?: ReactNode; mood?: Mood; loading?: boolean }) {
  return <main className="portal-status-page">
    <section className="portal-card portal-status-card" aria-labelledby="portal-status-title" role={loading ? 'status' : undefined}>
      <span className="portal-status-brand">lumi<span>.</span></span>
      <div className="portal-status-art" aria-hidden="true"><Avatar mood={mood}/></div>
      <h1 id="portal-status-title">{title}</h1>
      <p className="portal-status-description">{description}</p>
      {children && <div className="portal-status-actions">{children}</div>}
      {footer}
    </section>
  </main>;
}

export function PortalRoot() {
  const qc = useQueryClient();
  const pathname = useRouterState({ select: s => s.location.pathname });
  const requestedFamily = useRouterState({ select: s => s.location.search.family });
  const [expired, setExpired] = useState(false); const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const session = useQuery({ ...getSessionOptions(), enabled: !expired && !signingOut, retry: false, staleTime: 0, refetchInterval: 60_000 });
  const inFamily = pathname.startsWith('/famiglie/') && session.data?.portalAccess && session.data.families.some(f => f.id === familyID() && f.accessEnabled !== false);
  useEffect(() => {
    if (expired || (!session.isPending && !inFamily)) { document.getElementById('lumi-splash')?.remove(); const root = document.getElementById('root'); if (root) { root.hidden = false; root.inert = false; } }
    setCSRF(expired ? '' : session.data?.csrfToken ?? '');
  }, [expired, inFamily, session.data, session.isPending]);
  useEffect(() => {
    const invalidate = () => { setExpired(true); };
    window.addEventListener('lumi-session-expired', invalidate);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumi-session') : null;
    if (channel) channel.onmessage = invalidate;
    return () => { window.removeEventListener('lumi-session-expired', invalidate); channel?.close(); };
  }, []);
  useEffect(() => {
    if (!expired) return;
    // Disable the session observer before clearing its cache, so it cannot
    // immediately recreate the query after a 401 or a logout.
    window.speechSynthesis?.cancel();
    void qc.cancelQueries().then(() => qc.clear());
  }, [expired, qc]);
  async function signout() {
    if (signingOut) return;
    setSigningOut(true); setError('');
    try { await logout({ throwOnError: true }); }
    catch (e) { setError(errorMessage(e)); }
    finally { setExpired(true); const channel = new BroadcastChannel('lumi-session'); channel.postMessage('logout'); channel.close(); }
  }
  if (expired) return <PortalStatus title="A presto!" description="La sessione è terminata. Accedi per tornare nel tuo angolino.">{error && <p className="notice error-notice" role="alert">{error}</p>}<button className="primary-button" onClick={login}>Accedi a Lumi</button></PortalStatus>;
  if (session.isPending) return <PortalStatus title="Controllo l’accesso…" description="Un attimo, il tuo angolino ti aspetta." mood="thinking" loading/>;
  if (!session.data) return <PortalStatus title="Accedi a Lumi" description={errorMessage(session.error)}><button className="primary-button" onClick={login}>Accedi a Lumi</button><button className="text-button" onClick={() => void session.refetch()}>Riprova</button></PortalStatus>;
  const available = session.data.families.filter(f => f.accessEnabled !== false);
  const shellFamilyId = inFamily ? familyID() : (pathname === '/admin' || pathname.startsWith('/admin/')) ? (available.find(f => f.id === requestedFamily) ?? available[0])?.id ?? '' : '';
  const account = <footer className="portal-account"><span>{session.data.email}</span><button className="text-button" disabled={signingOut} onClick={() => void signout()}>Esci</button></footer>;
  return <SessionContext.Provider value={session.data}>
    <AccountContext.Provider value={{ signout, signingOut }}>
      {!session.data.portalAccess ? <PortalStatus title="Il tuo angolino ti aspetta" description="Accesso in attesa di approvazione. Un amministratore deve abilitare il tuo account prima di entrare." footer={account}><button className="primary-button" disabled={session.isFetching} onClick={login}>Controlla l’accesso</button></PortalStatus> : <AppShell familyId={shellFamilyId} checkConnection={Boolean(inFamily)}><Outlet/></AppShell>}
    </AccountContext.Provider>
  </SessionContext.Provider>;
}
export function FamilyHub() {
  const session = useSession(); const qc = useQueryClient(); const navigate = useNavigate();
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const { data } = await createFamily({ body: { name }, throwOnError: true }); await qc.invalidateQueries({ queryKey: getSessionQueryKey() }); await navigate({ to: '/famiglie/$familyId', params: { familyId: data.id } }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="portal-card"><img src="/lumi.svg" alt="Lumi"/><h1>Le tue famiglie</h1><p>Ogni famiglia ha le proprie scoperte. Lumi usa un unico piano condiviso.</p><div className="family-list">{session.families.map(f => f.accessEnabled === false ? <div className="soft-button suspended-family" key={f.id}>{f.name}<small>Accesso sospeso</small></div> : <Link className="soft-button" key={f.id} to="/famiglie/$familyId" params={{ familyId: f.id }}>{f.name}<small>{f.role === 'parent' ? 'Genitore' : 'Membro'}</small></Link>)}</div><form onSubmit={create}><label htmlFor="family-name">Crea una famiglia</label><input id="family-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Il nome della famiglia"/><button className="primary-button" disabled={busy || !name.trim()}>Crea famiglia</button></form>{error && <p role="alert">{error}</p>}</section>;
}
export function InvitationPage() {
  const [token] = useState(() => window.location.hash.slice(1)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const qc = useQueryClient(); const navigate = useNavigate();
  async function accept() {
    setBusy(true); setError('');
    try { const { data } = await acceptInvitation({ body: { token }, throwOnError: true }); window.history.replaceState(null, '', '/invito'); await qc.invalidateQueries({ queryKey: getSessionQueryKey() }); await navigate({ to: '/famiglie/$familyId', params: { familyId: data.id } }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="portal-card"><h1>Un invito per te</h1><p>Entra nella famiglia con l’indirizzo email verificato a cui è destinato l’invito.</p><button className="primary-button" disabled={busy || !token} onClick={() => void accept()}>Accetta invito</button>{!token && <p>Questo invito non è completo.</p>}{error && <p role="alert">{error}</p>}</section>;
}
export function FamilyMembers() {
  const session = useSession(); const family = session.families.find(f => f.id === familyID());
  return <div className="admin-page">
    <Link className="back-link" to="/famiglie/$familyId/genitore" params={{ familyId: familyID() }}><ArrowLeft size={16}/>Torna al genitore</Link>
    <div className="admin-heading"><span className="admin-badge"><UsersRound size={24}/></span><div><span className="eyebrow">GESTISCI LA FAMIGLIA</span><h1>{family?.name ?? 'La famiglia'}</h1><p>Gestisci chi può entrare e invita le persone della tua famiglia.</p></div></div>
    {family?.role === 'parent' ? <>
      <div className="admin-toolbar"><span className="private-label"><ShieldCheck size={15}/>Accesso privato</span></div>
      <FamilyAccessManager key={family.id} family={family} variant="page"/>
    </> : <p role="alert">Questa parte è riservata ai genitori.</p>}
  </div>;
}

export function FamilyAccessManager({ family, variant = 'embedded' }: { family: Pick<Family, 'id' | 'name'>; variant?: 'page' | 'embedded' }) {
  const qc = useQueryClient(); const path = { familyId: family.id };
  const members = useQuery(listMembersOptions({ path }));
  const invitations = useQuery(listInvitationsOptions({ path }));
  const [email, setEmail] = useState(''); const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const page = variant === 'page';
  const Heading = page ? 'h2' : 'h3';
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await qc.invalidateQueries(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <div className={page ? undefined : 'members-card'}>
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    <section className={page ? 'admin-card' : undefined}>
      <div className={page ? 'section-heading' : undefined}>{page && <span className="section-icon lilac"><UsersRound size={22}/></span>}<div><Heading>I membri</Heading>{page && <p>Scegli il ruolo di ogni persona e gestisci gli accessi alla famiglia.</p>}</div></div>
      {members.isPending && <LoadingSkeleton label="Caricamento dei membri" rows={2}/>}
      {members.isError && <p role="alert">{errorMessage(members.error)}</p>}
      {members.data?.map(m => <div className="member-row" key={m.userId}>
        <span>{m.email}</span>
        <select aria-label={`Ruolo di ${m.email}`} disabled={busy} value={m.role} onChange={e => void run(() => updateMember({ path: { ...path, userId: m.userId }, body: { role: e.target.value as Family['role'] }, throwOnError: true }))}><option value="parent">Genitore</option><option value="member">Membro</option></select>
        <button className="text-button danger-text" disabled={busy} onClick={() => { if (window.confirm(`Rimuovere ${m.email} dalla famiglia?`)) void run(() => removeMember({ path: { ...path, userId: m.userId }, throwOnError: true })); }}>Rimuovi</button>
      </div>)}
    </section>
    <section className={page ? 'admin-card' : undefined}>
      <div className={page ? 'section-heading' : undefined}>{page && <span className="section-icon peach"><UserPlus size={22}/></span>}<div><Heading>Invita una persona</Heading>{page && <p>Crea un link personale per entrare nella famiglia.</p>}</div></div>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { const { data } = await createInvitation({ path, body: { email }, throwOnError: true }); setUrl(data.url); setEmail(''); }); }}>
        <label htmlFor="invite-email">Email della persona</label><input id="invite-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/>
        <div className="button-row"><button className="primary-button" disabled={busy}><UserPlus size={17}/>Crea link di invito</button></div>
      </form>
      <p className="field-hint">Il link dura sette giorni. La persona deve verificare l’email e avere l’approvazione dell’amministratore.</p>
      {url && <div className="notice"><label htmlFor="invite-link">Link da condividere</label><input id="invite-link" value={url} readOnly onFocus={e => e.target.select()}/><button className="text-button" onClick={() => void navigator.clipboard.writeText(url).catch(() => setError('Seleziona e copia il link.'))}>Copia link</button></div>}
    </section>
    <section className={page ? 'admin-card' : undefined}>
      <div className={page ? 'section-heading' : undefined}>{page && <span className="section-icon mint"><Mail size={22}/></span>}<div><Heading>Inviti in attesa</Heading>{page && <p>Controlla gli inviti ancora validi e revoca quelli che non servono più.</p>}</div></div>
      {invitations.isPending && <LoadingSkeleton label="Caricamento degli inviti" rows={2}/>}
      {invitations.data?.length === 0 && <p>Nessun invito in attesa.</p>}
      {invitations.isError && <p role="alert">{errorMessage(invitations.error)}</p>}
      {invitations.data?.map(i => <div className="member-row" key={i.id}><span>{i.email}<small>Scade il {new Date(i.expiresAt).toLocaleDateString('it')}</small></span><button className="text-button" disabled={busy} onClick={() => void run(async () => { await revokeInvitation({ path: { ...path, invitationId: i.id }, throwOnError: true }); setUrl(''); })}>Revoca</button></div>)}
    </section>
  </div>;
}
