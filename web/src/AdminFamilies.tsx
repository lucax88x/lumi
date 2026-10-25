import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { listAdminFamiliesOptions } from './api/@tanstack/react-query.gen';
import { updateFamilyAccess } from './api/sdk.gen';
import type { AdminFamily } from './api/types.gen';
import { FamilyAccessManager } from './Portal';
import { errorMessage } from './lib';

export function AdminFamilies() {
  const qc = useQueryClient();
  const families = useQuery({ ...listAdminFamiliesOptions(), refetchInterval: 30_000 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function toggle(family: AdminFamily) {
    if (family.accessEnabled && !window.confirm(`Sospendere l’accesso a ${family.name} per tutti i suoi membri?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await updateFamilyAccess({ path: { familyId: family.id }, body: { accessEnabled: !family.accessEnabled }, throwOnError: true });
      setNotice(`Accesso ${family.accessEnabled ? 'sospeso' : 'riattivato'} per ${family.name}.`);
      await qc.invalidateQueries();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const filtered = families.data?.filter(f => f.name.toLocaleLowerCase('it').includes(search.trim().toLocaleLowerCase('it')));
  return <section className="admin-card" aria-labelledby="admin-families-title">
    <div className="section-heading"><span className="section-icon lilac"><Users size={22}/></span><div><h2 id="admin-families-title">Tutte le famiglie</h2><p>Abilita o sospendi l’accesso e gestisci membri e inviti di ogni famiglia.</p></div></div>
    <label htmlFor="family-search">Cerca una famiglia</label><input id="family-search" type="search" value={search} onChange={e => setSearch(e.target.value)}/>
    {families.isPending && <p role="status">Carico le famiglie…</p>}
    {families.isError && <div><p role="alert">{errorMessage(families.error)}</p><button className="text-button" onClick={() => void families.refetch()}>Riprova</button></div>}
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {notice && <p className="notice success-notice" role="status">{notice}</p>}
    {filtered?.length === 0 && <p>{families.data?.length ? 'Nessuna famiglia trovata.' : 'Non ci sono ancora famiglie.'}</p>}
    <div className="admin-family-list">{filtered?.map(f => <article key={f.id} className="admin-family" aria-label={f.name}>
      <div className="admin-family-heading"><div><h3>{f.name}</h3><p>{f.memberCount} {f.memberCount === 1 ? 'membro' : 'membri'}</p></div><span className={`connection-pill ${f.accessEnabled ? 'connected' : ''}`}>{f.accessEnabled ? 'Accesso attivo' : 'Accesso sospeso'}</span></div>
      <div className="button-row"><button className="soft-button" aria-expanded={selected === f.id} aria-controls={`family-access-${f.id}`} onClick={() => setSelected(selected === f.id ? '' : f.id)}>{selected === f.id ? 'Chiudi gestione' : 'Gestisci membri e inviti'}</button><button className={`text-button ${f.accessEnabled ? 'danger-text' : ''}`} disabled={busy} onClick={() => void toggle(f)}>{f.accessEnabled ? 'Sospendi accesso' : 'Riattiva accesso'}</button></div>
      {selected === f.id && <div id={`family-access-${f.id}`}><FamilyAccessManager key={f.id} family={f}/></div>}
    </article>)}</div>
  </section>;
}
