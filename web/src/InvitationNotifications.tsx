import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell, X } from 'lucide-react';
import { getSessionQueryKey, listReceivedInvitationsOptions, listReceivedInvitationsQueryKey } from './api/@tanstack/react-query.gen';
import { acceptReceivedInvitation, declineInvitation } from './api/sdk.gen';
import { useAccount } from './portal-state';
import { errorMessage } from './lib';
import { LoadingSkeleton } from './LoadingSkeleton';

export function useInvitationNotifications(enabled: boolean) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { signingOut } = useAccount();
  const invitations = useQuery({ ...listReceivedInvitationsOptions(), enabled: enabled && !signingOut, refetchInterval: 60_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const count = invitations.data?.length ?? 0;
  async function act(id: string, accept: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (accept) {
        const { data } = await acceptReceivedInvitation({ path: { invitationId: id }, throwOnError: true });
        await Promise.all([
          qc.invalidateQueries({ queryKey: getSessionQueryKey() }),
          qc.invalidateQueries({ queryKey: listReceivedInvitationsQueryKey() }),
        ]);
        setOpen(false);
        await navigate({ to: '/famiglie/$familyId', params: { familyId: data.id } });
      } else {
        await declineInvitation({ path: { invitationId: id }, throwOnError: true });
        await qc.invalidateQueries({ queryKey: listReceivedInvitationsQueryKey() });
      }
    } catch (e) {
      setError(errorMessage(e));
      void invitations.refetch();
    } finally { setBusy(false); }
  }
  const button = <button type="button" className="notification-button" aria-label={count ? `Inviti ricevuti: ${count}` : 'Inviti ricevuti'} aria-haspopup="dialog" aria-expanded={open && enabled} onClick={e => {
    trigger.current = e.currentTarget; setError(''); setOpen(true); void invitations.refetch();
  }}><Bell size={20} aria-hidden="true"/><span className="notification-label">Inviti ricevuti</span>{count > 0 && <span className="notification-count" aria-hidden="true">{count}</span>}</button>;
  const dialog = <Dialog.Root open={open && enabled} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog-panel invitation-dialog" finalFocus={trigger}>
      <Dialog.Title>Inviti ricevuti</Dialog.Title>
      <Dialog.Description>Scegli se entrare nelle famiglie che ti hanno invitato.</Dialog.Description>
      <Dialog.Close className="icon-button close-dialog" aria-label="Chiudi inviti" disabled={busy}><X size={20}/></Dialog.Close>
      {invitations.isPending && <LoadingSkeleton label="Caricamento degli inviti" rows={2}/>}
      {invitations.isError && <div><p role="alert">{errorMessage(invitations.error)}</p><button className="text-button" onClick={() => void invitations.refetch()}>Riprova</button></div>}
      {error && <p role="alert">{error}</p>}
      {invitations.data?.length === 0 && <p>Non hai inviti in attesa.</p>}
      {invitations.data?.map(invitation => <article className="received-invitation" key={invitation.id} aria-label={invitation.familyName}>
        <h3>{invitation.familyName}</h3><p>Ti invita a entrare nella famiglia.</p>
        <small>Scade il {new Date(invitation.expiresAt).toLocaleDateString('it')}</small>
        <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void act(invitation.id, true)}>Accetta</button><button className="text-button" disabled={busy} onClick={() => void act(invitation.id, false)}>Rifiuta</button></div>
      </article>)}
    </Dialog.Popup></Dialog.Portal>
  </Dialog.Root>;
  return { button, dialog };
}
