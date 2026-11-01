import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessRequestOptions, getAccessRequestQueryKey } from './api/@tanstack/react-query.gen';
import { requestAccess } from './api/sdk.gen';
import { errorMessage } from './lib';

export function AccessRequestGate() {
  const qc = useQueryClient();
  const request = useQuery({ ...getAccessRequestOptions(), refetchInterval: 10_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const retryAt = request.data?.retryAfter ? new Date(request.data.retryAfter).getTime() : 0;
  useEffect(() => {
    if (!retryAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const status = request.data?.status;
  const waiting = status === 'pending';
  const coolingDown = status === 'rejected' && now < retryAt;
  async function send() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await requestAccess({ throwOnError: true });
      qc.setQueryData(getAccessRequestQueryKey(), data);
    } catch (e) {
      const cooldown = e && typeof e === 'object' && 'status' in e && e.status === 'rejected';
      if (!cooldown) setError(errorMessage(e));
      setNow(Date.now());
      void request.refetch();
    } finally { setBusy(false); }
  }
  return <div className="access-request-gate">
    <p role="status">{waiting ? 'Richiesta inviata. Un amministratore la controllerà. L’accesso si aggiornerà qui.' : status === 'rejected' ? 'La richiesta è stata rifiutata.' : status === 'approved' ? 'Accesso approvato. Sto controllando la sessione…' : 'Per entrare in Lumi, invia una richiesta agli amministratori.'}</p>
    {status === 'rejected' && retryAt > 0 && <p>{coolingDown ? 'Puoi inviare una nuova richiesta dal ' : 'Puoi inviare una nuova richiesta. L’attesa è terminata il '}{new Date(retryAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}.</p>}
    {request.isError && <div><p className="error-text" role="alert">{errorMessage(request.error)}</p><button className="text-button" onClick={() => void request.refetch()}>Riprova</button></div>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy || !request.data || waiting || coolingDown || status === 'approved'} onClick={() => void send()}>{busy ? 'Invio…' : waiting ? 'Richiesta inviata' : status === 'rejected' ? 'Invia una nuova richiesta' : 'Richiedi accesso'}</button>
  </div>;
}
