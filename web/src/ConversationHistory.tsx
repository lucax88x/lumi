import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Plus } from 'lucide-react';
import { listConversationsOptions } from './api/@tanstack/react-query.gen';
import { LoadingSkeleton } from './LoadingSkeleton';
import { shortDate } from './lib';
import { subjectLabel } from './subjects';

export function ConversationHistory({ familyId, close }: { familyId: string; close?: () => void }) {
  const chats = useQuery(listConversationsOptions({ path: { familyId } }));
  const pathname = useRouterState({ select: s => s.location.pathname });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 6);
  const periods = [
    { label: 'Oggi', since: today.getTime() },
    { label: 'Ieri', since: yesterday.getTime() },
    { label: 'Ultimi 7 giorni', since: week.getTime() },
    { label: 'Più tempo fa', since: -Infinity },
  ];
  const groups = periods.map(period => ({ ...period, conversations: [] as NonNullable<typeof chats.data> }));
  const conversations = [...(chats.data ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const conversation of conversations) {
    groups.find(group => Date.parse(conversation.updatedAt) >= group.since)?.conversations.push(conversation);
  }

  return <div className="sidebar-history">
    {chats.isPending && <LoadingSkeleton label="Caricamento delle scoperte" rows={3}/>}
    {chats.data?.length === 0 && <div className="history-empty"><MessageCircle size={24} aria-hidden="true"/><p>Qui ritrovi le tue domande.<br/>Cominciamo dalla prima?</p><Link className="soft-button" to="/spazi/$familyId" params={{ familyId }} onClick={close}><Plus size={18}/>Fai una domanda</Link></div>}
    {chats.isError && <div className="notice error-notice" role="alert"><p>Non riesco a caricare le tue scoperte.</p><button className="soft-button" onClick={() => void chats.refetch()}>Riprova</button></div>}
    {groups.filter(group => group.conversations.length > 0).map(group => <section className="history-group" key={group.label} aria-label={group.label}>
      <h3>{group.label}</h3>
      <ul>{group.conversations.map(conversation => {
        const selected = pathname === `/spazi/${familyId}/domande/${conversation.id}`;
        return <li key={conversation.id}><Link to="/spazi/$familyId/domande/$id" params={{ familyId, id: conversation.id }} onClick={close} aria-current={selected ? 'page' : undefined} className={`history-item ${selected ? 'active' : ''}`} title={conversation.title}>
          <span className="history-title">{conversation.title}</span>
          <span className="history-meta"><span className={`history-subject history-subject-${conversation.subject}`}>{subjectLabel(conversation.subject)}</span><time dateTime={conversation.updatedAt}>{shortDate(conversation.updatedAt)}</time></span>
        </Link></li>;
      })}</ul>
    </section>)}
  </div>;
}
