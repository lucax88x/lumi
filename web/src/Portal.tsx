import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSessionOptions, getSessionQueryKey, listMembersOptions, listInvitationsOptions } from './api/@tanstack/react-query.gen';
import { acceptInvitation, createFamily, createInvitation, logout, removeMember, revokeInvitation, updateMember } from './api/sdk.gen';
import { AccountContext, SessionContext, familyID, useSession } from './portal-state';
import { errorMessage, setCSRF } from './lib';
import { Avatar, type Mood } from './Avatar';
import type { Family } from './api/types.gen';

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
  const [expired, setExpired] = useState(false); const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const session = useQuery({ ...getSessionOptions(), enabled: !expired && !signingOut, retry: false, staleTime: 0, refetchInterval: 60_000 });
  const inFamily = pathname.startsWith('/famiglie/') && session.data?.portalAccess && session.data.families.some(f => f.id === familyID());
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
  const account = <footer className="portal-account"><span>{session.data.email}</span><button className="text-button" disabled={signingOut} onClick={() => void signout()}>Esci</button></footer>;
  return <SessionContext.Provider value={session.data}>
    <AccountContext.Provider value={{ signout, signingOut }}>
      {!session.data.portalAccess ? <PortalStatus title="Il tuo angolino ti aspetta" description="Accesso in attesa di approvazione. Un amministratore deve abilitare il tuo account prima di entrare." footer={account}><button className="primary-button" disabled={session.isFetching} onClick={login}>Controlla l’accesso</button></PortalStatus> : <><Outlet/>{!inFamily && pathname !== '/admin' && account}</>}
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
  return <main className="portal-card"><img src="/lumi.svg" alt="Lumi"/><h1>Le tue famiglie</h1>{session.admin && <Link className="soft-button" to="/admin">Admin</Link>}<p>Ogni famiglia ha le proprie scoperte. Lumi usa un unico piano condiviso.</p><div className="family-list">{session.families.map(f => <Link className="soft-button" key={f.id} to="/famiglie/$familyId" params={{ familyId: f.id }}>{f.name}<small>{f.role === 'parent' ? 'Genitore' : 'Membro'}</small></Link>)}</div><form onSubmit={create}><label htmlFor="family-name">Crea una famiglia</label><input id="family-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Il nome della famiglia"/><button className="primary-button" disabled={busy || !name.trim()}>Crea famiglia</button></form>{error && <p role="alert">{error}</p>}</main>;
}
export function InvitationPage() {
  const [token] = useState(() => window.location.hash.slice(1)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const qc = useQueryClient(); const navigate = useNavigate();
  async function accept() {
    setBusy(true); setError('');
    try { const { data } = await acceptInvitation({ body: { token }, throwOnError: true }); window.history.replaceState(null, '', '/invito'); await qc.invalidateQueries({ queryKey: getSessionQueryKey() }); await navigate({ to: '/famiglie/$familyId', params: { familyId: data.id } }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <main className="portal-card"><h1>Un invito per te</h1><p>Entra nella famiglia con l’indirizzo email verificato a cui è destinato l’invito.</p><button className="primary-button" disabled={busy || !token} onClick={() => void accept()}>Accetta invito</button>{!token && <p>Questo invito non è completo.</p>}{error && <p role="alert">{error}</p>}</main>;
}
export function FamilyMembers() {
  const session = useSession(); const qc = useQueryClient(); const family = session.families.find(f => f.id === familyID()); const path = { familyId: familyID() };
  const members = useQuery({ ...listMembersOptions({ path }), enabled: family?.role === 'parent' });
  const invitations = useQuery({ ...listInvitationsOptions({ path }), enabled: family?.role === 'parent' });
  const [email, setEmail] = useState(''); const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await qc.invalidateQueries(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  if (family?.role !== 'parent') return <main className="portal-card"><p>Questa parte è riservata ai genitori.</p></main>;
  return <main className="portal-card members-card"><Link to="/famiglie/$familyId/genitore" params={path}>← Torna al genitore</Link><h1>{family.name}</h1><h2>I membri</h2>{members.isError && <p role="alert">{errorMessage(members.error)}</p>}{members.data?.map(m => <div className="member-row" key={m.userId}><span>{m.email}</span><select aria-label={`Ruolo di ${m.email}`} disabled={busy} value={m.role} onChange={e => void run(() => updateMember({ path: { ...path, userId: m.userId }, body: { role: e.target.value as Family['role'] }, throwOnError: true }))}><option value="parent">Genitore</option><option value="member">Membro</option></select><button className="text-button danger-text" disabled={busy} onClick={() => { if (window.confirm(`Rimuovere ${m.email} dalla famiglia?`)) void run(() => removeMember({ path: { ...path, userId: m.userId }, throwOnError: true })); }}>Rimuovi</button></div>)}
    <h2>Invita una persona</h2><form onSubmit={e => { e.preventDefault(); void run(async () => { const { data } = await createInvitation({ path, body: { email }, throwOnError: true }); setUrl(data.url); setEmail(''); }); }}><label htmlFor="invite-email">Email della persona</label><input id="invite-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/><button className="primary-button" disabled={busy}>Crea link di invito</button></form><p className="field-hint">Il link dura sette giorni. La persona deve verificare l’email e avere l’approvazione dell’amministratore.</p>{url && <div className="notice"><label htmlFor="invite-link">Link da condividere</label><input id="invite-link" value={url} readOnly onFocus={e => e.target.select()}/><button className="text-button" onClick={() => void navigator.clipboard.writeText(url).catch(() => setError('Seleziona e copia il link.'))}>Copia link</button></div>}
    <h2>Inviti in attesa</h2>{invitations.isError && <p role="alert">{errorMessage(invitations.error)}</p>}{invitations.data?.map(i => <div className="member-row" key={i.id}><span>{i.email}<small>Scade il {new Date(i.expiresAt).toLocaleDateString('it')}</small></span><button className="text-button" disabled={busy} onClick={() => void run(() => revokeInvitation({ path: { ...path, invitationId: i.id }, throwOnError: true }))}>Revoca</button></div>)}{error && <p className="error-text" role="alert">{error}</p>}
  </main>;
}
