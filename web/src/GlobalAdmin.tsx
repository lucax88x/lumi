import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, Link2, LoaderCircle, Mic, RefreshCw, Save, ShieldCheck, Unplug } from 'lucide-react';
import { getAdminSettingsOptions, getConnectionOptions, listModelsOptions } from './api/@tanstack/react-query.gen';
import { completeConnection, disconnect, startConnection, updateAdminSettings } from './api/sdk.gen';
import type { OAuthStart } from './api/types.gen';
import { useSession } from './portal-state';
import { errorMessage } from './lib';

export function GlobalAdminPage({ familyId }: { familyId: string }) {
  const session = useSession();
  return <div className="admin-page">
    {familyId ? <Link className="back-link" to="/spazi/$familyId" params={{ familyId }}><ArrowLeft size={16}/>Torna da Lumi</Link> : <Link className="back-link" to="/"><ArrowLeft size={16}/>Torna da Lumi</Link>}
    <div className="admin-heading"><span className="admin-badge"><ShieldCheck size={24}/></span><div><span className="eyebrow">PER TUTTI GLI SPAZI</span><h1>Admin</h1><p>Gestisci il piano ChatGPT, il modello e la trascrizione condivisi.</p></div></div>
    {session.admin ? <SharedConnection/> : <p role="alert">Questa parte è riservata agli amministratori.</p>}
  </div>;
}

type SharedAction = 'connect' | 'finish' | 'disconnect' | 'model';

function SharedConnection() {
  const qc = useQueryClient();
  const connection = useQuery({ ...getConnectionOptions(), refetchInterval: 30_000 });
  const settings = useQuery(getAdminSettingsOptions());
  const models = useQuery({ ...listModelsOptions(), enabled: connection.data?.connected === true, retry: false });
  const [flow, setFlow] = useState<OAuthStart | null>(null);
  const [callback, setCallback] = useState(''); const [model, setModel] = useState<string | null>(null);
  const [pending, setPending] = useState<SharedAction | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const busy = pending !== null;
  async function run(name: SharedAction, action: () => Promise<void>) {
    setPending(name); setError(''); setNotice('');
    try { await action(); await qc.invalidateQueries(); }
    catch (e) { setError(errorMessage(e)); } finally { setPending(null); }
  }
  async function connect() {
    await run('connect', async () => { const { data } = await startConnection({ throwOnError: true }); setFlow(data); setCallback(''); });
  }
  async function finish(e: React.FormEvent) {
    e.preventDefault(); const url = callback; setCallback('');
    await run('finish', async () => { const { data } = await completeConnection({ body: { callbackUrl: url }, throwOnError: true }); setFlow(null); setModel(null); setNotice(data.message || 'Piano collegato per tutti gli spazi.'); });
  }
  const selectedModel = model ?? settings.data?.model ?? '';
  return <>
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {notice && <p className="notice success-notice" role="status"><Check size={17}/>{notice}</p>}
    <section className="admin-card">
      <div className="section-heading"><span className="section-icon lilac"><Link2 size={22}/></span><div><h2>Piano ChatGPT condiviso</h2><p>Le risposte di tutti gli spazi usano questo abbonamento.</p></div><span className={`connection-pill ${connection.data?.connected ? 'connected' : ''}`}>{connection.data?.connected ? 'Collegato' : 'Da collegare'}</span></div>
      {connection.isError && <p className="error-text">{errorMessage(connection.error)}</p>}
      {connection.data?.email && <p className="account-email">{connection.data.email}</p>}
      {connection.data?.message && <p className="notice">{connection.data.message}</p>}
      <div className="shared-connection-actions">
        <div className="shared-connection-links">
          <button className={`shared-action ${connection.data?.connected ? 'shared-action-secondary' : 'primary-button'}`} disabled={busy || connection.isPending} onClick={() => void connect()}>{pending === 'connect' ? <LoaderCircle className="spin" size={17}/> : <Link2 size={17}/>}<span>{pending === 'connect' ? 'Apertura…' : connection.data?.connected ? 'Ricollega ChatGPT' : 'Collega ChatGPT'}</span></button>
          <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer" className="shared-action shared-action-secondary">Utilizzo del piano<ExternalLink size={15}/></a>
        </div>
        {connection.data?.connected && <button className="shared-action shared-action-danger" disabled={busy} onClick={() => {
          if (window.confirm('Scollegare ChatGPT per tutti gli spazi? Le nuove risposte saranno sospese finché non ricolleghi il piano.')) void run('disconnect', async () => { await disconnect({ throwOnError: true }); setFlow(null); setCallback(''); setNotice('Piano scollegato per tutti gli spazi.'); });
        }}>{pending === 'disconnect' ? <LoaderCircle className="spin" size={17}/> : <Unplug size={17}/>}<span>{pending === 'disconnect' ? 'Scollegamento…' : 'Scollega per tutti'}</span></button>}
      </div>
      {flow && <form className="oauth-flow" onSubmit={e => void finish(e)}><h3>Completa il collegamento dal browser</h3><ol><li><a className="text-link" href={flow.authorizationUrl} target="_blank" rel="noreferrer">Apri il consenso ChatGPT<ExternalLink size={15}/></a> e autorizza l’uso del piano.</li><li>Alla fine il browser prova ad aprire <code>127.0.0.1:1455</code>. È normale che la pagina non si apra.</li><li>Copia l’URL completo dalla barra degli indirizzi e incollalo qui.</li></ol><label htmlFor="callback">URL finale di ritorno</label><input id="callback" value={callback} onChange={e => setCallback(e.target.value)} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:1455/auth/callback?…" maxLength={8192}/><p className="field-hint">Scade alle {new Date(flow.expiresAt).toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit' })}. L’URL contiene un codice temporaneo: non condividerlo.</p><div className="button-row"><button className="primary-button shared-action" disabled={busy || !callback.trim()}>{pending === 'finish' ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>}Completa collegamento</button><button className="text-button" type="button" disabled={busy} onClick={() => { setFlow(null); setCallback(''); }}>Annulla</button></div></form>}
    </section>
    <section className="admin-card"><h2>Modello per tutti gli spazi</h2><p>Le nuove risposte e le prove dei coach usano questo modello.</p>
      {settings.isError && <p className="error-text">{errorMessage(settings.error)}</p>}
      <label htmlFor="shared-model">Modello ChatGPT</label><div className="input-with-button shared-model-picker"><select id="shared-model" disabled={busy || !connection.data?.connected} value={selectedModel} onChange={e => setModel(e.target.value)}><option value="" disabled>Collega ChatGPT e scegli un modello</option>{selectedModel && !models.data?.some(m => m.slug === selectedModel) && <option value={selectedModel}>{selectedModel} (da verificare)</option>}{models.data?.map(m => <option key={m.slug} value={m.slug}>{m.displayName}</option>)}</select><button type="button" className="icon-button shared-action-secondary" aria-label="Aggiorna modelli" title="Aggiorna modelli" disabled={busy || models.isFetching || !connection.data?.connected} onClick={() => void models.refetch()}><RefreshCw className={models.isFetching ? 'spin' : undefined} size={18}/></button></div>
      {models.isError && <p className="error-text">{errorMessage(models.error)}</p>}
      <div className="shared-model-actions"><button className="primary-button shared-action" disabled={busy || !settings.data || !selectedModel || !connection.data?.connected} onClick={() => void run('model', async () => { await updateAdminSettings({ body: { ...settings.data!, model: selectedModel }, throwOnError: true }); setModel(null); setNotice('Modello salvato per tutti gli spazi.'); })}>{pending === 'model' ? <LoaderCircle className="spin" size={17}/> : <Save size={17}/>}<span>{pending === 'model' ? 'Salvataggio…' : 'Salva modello'}</span></button></div>
    </section>
    <section className="admin-card"><div className="section-heading"><span className="section-icon mint"><Mic size={22}/></span><div><h2>Trascrizione OpenAI</h2><p>La chiave API rimane in .env sul server ed è usata per i vocali di tutti gli spazi. La fatturazione API è separata dal piano ChatGPT.</p></div><span className={`connection-pill ${connection.data?.transcriptionConfigured ? 'connected' : ''}`}>{connection.data?.transcriptionConfigured ? 'Chiave configurata' : 'Chiave non configurata'}</span></div><p className="field-hint">La chiave non viene mostrata nel browser. Dopo una modifica sul server, riavvia Lumi.</p></section>
  </>;
}
