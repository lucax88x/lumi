import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell, X } from 'lucide-react';
import { getSessionQueryKey, listReceivedInvitationsOptions, listReceivedInvitationsQueryKey, listAccessRequestsOptions, listAccessRequestsQueryKey } from './api/@tanstack/react-query.gen';
import { acceptReceivedInvitation, declineInvitation, decideAccessRequest } from './api/sdk.gen';
import type { PendingAccessRequest } from './api/types.gen';
import { useAccount, useSession } from './portal-state';
import { errorMessage } from './lib';
import { LoadingSkeleton } from './LoadingSkeleton';

export function useInvitationNotifications(enabled: boolean) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { admin } = useSession();
  const { signingOut } = useAccount();
  const active = enabled && !signingOut;
  const invitations = useQuery({ ...listReceivedInvitationsOptions(), enabled: active, refetchInterval: 30_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const requests = useQuery({ ...listAccessRequestsOptions(), enabled: active && admin, refetchInterval: 30_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const count = (invitations.data?.length ?? 0) + (admin ? requests.data?.length ?? 0 : 0);
  async function act(id: string, accept: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (accept) {
        const { data } = await acceptReceivedInvitation({ path: { invitationId: id }, throwOnError: true });
        await Promise.all([
          qc.invalidateQueries({ queryKey: getSessionQueryKey() }),
          qc.invalidateQueries({ queryKey: listReceivedInvitationsQueryKey() }),
        ]);
        setOpen(false);
        await navigate({ to: '/spazi/$familyId', params: { familyId: data.id } });
      } else {
        await declineInvitation({ path: { invitationId: id }, throwOnError: true });
        await qc.invalidateQueries({ queryKey: listReceivedInvitationsQueryKey() });
      }
    } catch (e) {
      setError(errorMessage(e));
      void invitations.refetch();
    } finally { lock.current = false; setBusy(false); }
  }
  async function decide(request: PendingAccessRequest, decision: 'approve' | 'reject') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await decideAccessRequest({ path: { requestId: request.id }, body: { decision, attempt: request.attempt }, throwOnError: true });
      setNotice(decision === 'approve' ? `Accesso approvato per ${request.email}.` : `Richiesta rifiutata per ${request.email}. Potrà riprovare tra 24 ore.`);
      await qc.invalidateQueries({ queryKey: listAccessRequestsQueryKey() });
    } catch (e) {
      setError(errorMessage(e));
      void requests.refetch();
    } finally { lock.current = false; setBusy(false); }
  }
  const button = <button type="button" className="notification-button" aria-label={count ? `Notifiche: ${count}` : 'Notifiche'} aria-haspopup="dialog" aria-expanded={open && enabled} onClick={e => {
    trigger.current = e.currentTarget; setError(''); setNotice(''); setOpen(true); void invitations.refetch(); if (admin) void requests.refetch();
  }}><Bell size={20} aria-hidden="true"/><span className="notification-label">Notifiche</span>{count > 0 && <span className="notification-count" aria-hidden="true">{count}</span>}</button>;
  const dialog = <Dialog.Root open={open && enabled} onOpenChange={value => { if (!lock.current) setOpen(value); }}>
    <Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog-panel invitation-dialog" finalFocus={trigger}>
      <Dialog.Title>Notifiche</Dialog.Title>
      <Dialog.Description>{admin ? 'Gestisci le richieste di accesso e gli inviti agli spazi.' : 'Scegli se entrare negli spazi che ti hanno invitato.'}</Dialog.Description>
      <Dialog.Close className="icon-button close-dialog" aria-label="Chiudi notifiche" disabled={busy}><X size={20}/></Dialog.Close>
      {error && <p className="notice error-notice" role="alert">{error}</p>}
      {notice && <p className="notice success-notice" role="status">{notice}</p>}
      {admin && <section aria-labelledby="access-requests-title">
        <h3 id="access-requests-title">Richieste di accesso</h3>
        {requests.isPending && <LoadingSkeleton label="Caricamento delle richieste" rows={2}/>}
        {requests.isError && <div><p role="alert">{errorMessage(requests.error)}</p><button className="text-button" onClick={() => void requests.refetch()}>Riprova le richieste</button></div>}
        {requests.data?.length === 0 && <p>Non ci sono richieste di accesso in attesa.</p>}
        {requests.data?.map(request => <article className="received-invitation" key={request.id} aria-label={request.email}>
          <h4>{request.email}</h4><p>Chiede di entrare in Lumi.</p>
          <small>Richiesta del {new Date(request.requestedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</small>
          <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void decide(request, 'approve')}>Approva</button><button className="text-button" disabled={busy} onClick={() => void decide(request, 'reject')}>Rifiuta</button></div>
        </article>)}
      </section>}
      <section aria-labelledby="space-invitations-title">
        <h3 id="space-invitations-title">Inviti agli spazi</h3>
        {invitations.isPending && <LoadingSkeleton label="Caricamento degli inviti" rows={2}/>}
        {invitations.isError && <div><p role="alert">{errorMessage(invitations.error)}</p><button className="text-button" onClick={() => void invitations.refetch()}>Riprova</button></div>}
        {invitations.data?.length === 0 && <p>Non hai inviti in attesa.</p>}
        {invitations.data?.map(invitation => <article className="received-invitation" key={invitation.id} aria-label={invitation.familyName}>
          <h4>{invitation.familyName}</h4><p>Ti invita a entrare nello spazio.</p>
          <small>Scade il {new Date(invitation.expiresAt).toLocaleDateString('it')}</small>
          <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void act(invitation.id, true)}>Accetta</button><button className="text-button" disabled={busy} onClick={() => void act(invitation.id, false)}>Rifiuta</button></div>
        </article>)}
      </section>
    </Dialog.Popup></Dialog.Portal>
  </Dialog.Root>;
  return { button, dialog };
}
