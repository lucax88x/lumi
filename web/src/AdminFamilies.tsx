import { useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Drawer } from '@base-ui/react/drawer';
import { Dialog } from '@base-ui/react/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, UsersRound, X } from 'lucide-react';
import { listAdminFamiliesOptions } from './api/@tanstack/react-query.gen';
import { deleteAdminFamily, updateFamilyAccess } from './api/sdk.gen';
import type { AdminFamily } from './api/types.gen';
import { FamilyAccessManager } from './Portal';
import { errorMessage } from './lib';
import { LoadingSkeleton } from './LoadingSkeleton';
import { useSession } from './portal-state';

export function AdminFamiliesPage() {
  const session = useSession();
  const search = useRouterState({ select: s => s.location.search });
  return <div className="admin-page">
    <Link className="back-link" to="/admin" search={search}><ArrowLeft size={16}/>Torna ad Admin</Link>
    <div className="admin-heading"><span className="admin-badge"><UsersRound size={24}/></span><div><span className="eyebrow">AMMINISTRAZIONE</span><h1>Spazi</h1><p>Gestisci gli accessi, i membri e gli inviti di tutti gli spazi.</p></div></div>
    {session.admin ? <AdminFamilies/> : <p role="alert">Questa parte è riservata agli amministratori.</p>}
  </div>;
}

function AdminFamilies() {
  const qc = useQueryClient();
  const families = useQuery({ ...listAdminFamiliesOptions(), refetchInterval: 30_000 });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<AdminFamily | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const cancelDelete = useRef<HTMLButtonElement | null>(null);
  async function toggle(family: AdminFamily) {
    if (family.accessEnabled && !window.confirm(`Sospendere l’accesso a ${family.name} per tutti i suoi membri?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await updateFamilyAccess({ path: { familyId: family.id }, body: { accessEnabled: !family.accessEnabled }, throwOnError: true });
      setNotice(`Accesso ${family.accessEnabled ? 'sospeso' : 'riattivato'} per ${family.name}.`);
      await qc.invalidateQueries();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setDeleteError(''); setNotice('');
    try {
      await deleteAdminFamily({ path: { familyId: deleting.id }, throwOnError: true });
      const filter = { predicate: (query: { queryKey: readonly unknown[] }) => {
        const key = query.queryKey[0] as { path?: { familyId?: string } } | undefined;
        return key?.path?.familyId === deleting.id || (query.queryKey[0] === 'pending-question' && query.queryKey[1] === deleting.id);
      } };
      await qc.cancelQueries(filter);
      qc.removeQueries(filter);
      setNotice(`Spazio «${deleting.name}» eliminato definitivamente.`);
      setDeleting(null);
      await qc.invalidateQueries();
    } catch (e) { setDeleteError(errorMessage(e)); await qc.invalidateQueries(); } finally { setBusy(false); }
  }
  const filtered = families.data?.filter(f => f.name.toLocaleLowerCase('it').includes(search.trim().toLocaleLowerCase('it')));
  return <section className="admin-card" aria-labelledby="admin-families-title">
    <div className="section-heading"><span className="section-icon lilac"><Users size={22}/></span><div><h2 id="admin-families-title">Tutti gli spazi</h2><p>Abilita o sospendi l’accesso e gestisci membri e inviti di ogni spazio.</p></div></div>
    <label htmlFor="family-search">Cerca uno spazio</label><input id="family-search" type="search" value={search} onChange={e => setSearch(e.target.value)}/>
    {families.isPending && <LoadingSkeleton label="Caricamento degli spazi"/>}
    {families.isError && <div><p role="alert">{errorMessage(families.error)}</p><button className="text-button" onClick={() => void families.refetch()}>Riprova</button></div>}
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {notice && <p className="notice success-notice" role="status">{notice}</p>}
    {filtered?.length === 0 && <p>{families.data?.length ? 'Nessuno spazio trovato.' : 'Non ci sono ancora spazi.'}</p>}
    <div className="admin-family-list">{filtered?.map(f => <article key={f.id} className="admin-family" aria-label={f.name}>
      <div className="admin-family-heading"><div><h3>{f.name}</h3><p>{f.memberCount} {f.memberCount === 1 ? 'membro' : 'membri'}</p></div><span className={`connection-pill ${f.accessEnabled ? 'connected' : ''}`}>{f.accessEnabled ? 'Accesso attivo' : 'Accesso sospeso'}</span></div>
      <div className="button-row admin-family-actions">
        <Drawer.Root swipeDirection="right">
          <Drawer.Trigger className="soft-button">Gestisci membri e inviti</Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Backdrop className="dialog-backdrop family-drawer-backdrop"/>
            <Drawer.Viewport className="family-drawer-viewport">
              <Drawer.Popup className="family-drawer admin-card">
                <header className="family-drawer-header">
                  <div><span className="eyebrow">MEMBRI E INVITI</span><Drawer.Title>{f.name}</Drawer.Title><Drawer.Description>Gestisci le persone che possono accedere allo spazio.</Drawer.Description></div>
                  <Drawer.Close className="icon-button" aria-label="Chiudi gestione spazio"><X size={20}/></Drawer.Close>
                </header>
                <Drawer.Content className="family-drawer-content"><FamilyAccessManager family={f}/></Drawer.Content>
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.Root>
        <button className={`text-button ${f.accessEnabled ? 'danger-text' : ''}`} disabled={busy} onClick={() => void toggle(f)}>{f.accessEnabled ? 'Sospendi accesso' : 'Riattiva accesso'}</button>
        {!f.accessEnabled && <button className="text-button danger-text" disabled={busy} onClick={() => { setDeleteError(''); setDeleting(f); }}>Elimina spazio</button>}
      </div>
    </article>)}</div>
    <Dialog.Root open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}>
      <Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog-panel" initialFocus={cancelDelete}>
        <Dialog.Title>Eliminare {deleting?.name}?</Dialog.Title>
        <Dialog.Description>Verranno eliminati definitivamente conversazioni, dizionario, impostazioni, appartenenze e inviti dello spazio. Questa azione non può essere annullata.</Dialog.Description>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div className="button-row"><Dialog.Close ref={cancelDelete} className="soft-button" disabled={busy}>Annulla</Dialog.Close><button className="primary-button danger-button" disabled={busy} onClick={() => void remove()}>{busy ? 'Elimino…' : 'Elimina definitivamente'}</button></div>
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
