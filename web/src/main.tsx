import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { AppShell, ChatPage } from './pages';
import { AdminPage } from './Admin';
import { GlobalAdminPage } from './GlobalAdmin';
import './lib';
import { PortalRoot, FamilyHub, FamilyMembers, InvitationPage } from './Portal';
import { familyID, useSession } from './portal-state';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import './styles.css';

function FamilyLayout() {
  const session = useSession(); const qc = useQueryClient(); const id = familyID();
  useEffect(() => {
    window.speechSynthesis?.cancel();
    const filter = { predicate: (query: Query) => (query.queryKey[0] as { path?: { familyId?: string } } | undefined)?.path?.familyId === id || (query.queryKey[0] === 'pending-question' && query.queryKey[1] === id) };
    return () => { void qc.cancelQueries(filter); qc.removeQueries(filter); };
  }, [id, qc]);
  if (!session.families.some(f => f.id === id)) return <main className="portal-card"><h1>Famiglia non disponibile</h1><a href="/">Torna alle tue famiglie</a></main>;
  return <AppShell key={id}/>;
}
function GlobalAdminLayout() {
  const session = useSession();
  const { family: requestedFamily } = globalAdmin.useSearch();
  const id = session.families.find(f => f.id === requestedFamily)?.id ?? session.families[0]?.id ?? '';
  return <AppShell familyId={id} checkConnection={false}><GlobalAdminPage familyId={id}/></AppShell>;
}
const root = createRootRoute({ component: PortalRoot, notFoundComponent: () => <div className="empty-state"><h1>Questa pagina si è nascosta!</h1><a href="/">Torniamo da Lumi</a></div> });
const home = createRoute({ getParentRoute: () => root, path: '/', component: FamilyHub });
const invitation = createRoute({ getParentRoute: () => root, path: '/invito', component: InvitationPage });
const globalAdmin = createRoute({
  getParentRoute: () => root,
  path: '/admin',
  validateSearch: (search: Record<string, unknown>): { family?: string } => typeof search.family === 'string' ? { family: search.family } : {},
  component: GlobalAdminLayout,
});
const family = createRoute({ getParentRoute: () => root, path: '/famiglie/$familyId', component: FamilyLayout });
const familyHome = createRoute({ getParentRoute: () => family, path: '/', component: () => <ChatPage/> });
const chat = createRoute({ getParentRoute: () => family, path: '/domande/$id', component: () => { const { id } = chat.useParams(); return <ChatPage key={id} id={id}/>; } });
const admin = createRoute({ getParentRoute: () => family, path: '/genitore', component: AdminPage });
const members = createRoute({ getParentRoute: () => family, path: '/membri', component: FamilyMembers });
const router = createRouter({ routeTree: root.addChildren([home, invitation, globalAdmin, family.addChildren([familyHome, chat, admin, members])]), defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
