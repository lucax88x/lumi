import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { ChatPage } from './pages';
import { AdminPage } from './Admin';
import { DictionaryPage } from './Dictionary';
import { GlobalAdminPage } from './GlobalAdmin';
import { AdminFamiliesPage } from './AdminFamilies';
import './lib';
import { ErrorPage, PortalRoot, FamilyHub, FamilyMembers, InvitationPage } from './Portal';
import { familyID, useSession } from './portal-state';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canonicalSpacePath } from './space-navigation';
import './styles.css';

const pathname = canonicalSpacePath(window.location.pathname);
if (pathname !== window.location.pathname) {
  window.history.replaceState(window.history.state, '', pathname + window.location.search + window.location.hash);
}

function FamilyLayout() {
  const session = useSession(); const qc = useQueryClient(); const id = familyID();
  useEffect(() => {
    window.speechSynthesis?.cancel();
    const filter = { predicate: (query: Query) => (query.queryKey[0] as { path?: { familyId?: string } } | undefined)?.path?.familyId === id || (query.queryKey[0] === 'pending-question' && query.queryKey[1] === id) };
    return () => { void qc.cancelQueries(filter); qc.removeQueries(filter); };
  }, [id, qc]);
  if (!session.families.some(f => f.id === id)) return <section className="portal-card"><h1>Spazio non disponibile</h1><a href="/">Torna ai tuoi spazi</a></section>;
  if (session.families.find(f => f.id === id)?.accessEnabled === false) return <section className="portal-card"><h1>Accesso sospeso</h1><p>L’accesso a questo spazio è sospeso. Contatta un amministratore.</p><a href="/">Torna ai tuoi spazi</a></section>;
  return <Outlet key={id}/>;
}
function GlobalAdminLayout() {
  const session = useSession();
  const { family: requestedFamily } = globalAdmin.useSearch();
  const available = session.families.filter(f => f.accessEnabled !== false);
  const id = available.find(f => f.id === requestedFamily)?.id ?? available[0]?.id ?? '';
  return <GlobalAdminPage familyId={id}/>;
}
const root = createRootRoute({ component: () => window.location.pathname === '/errore' ? <Outlet/> : <PortalRoot/>, notFoundComponent: () => <div className="empty-state"><h1>Questa pagina si è nascosta!</h1><a href="/">Torniamo da Lumi</a></div> });
const errorRoute = createRoute({ getParentRoute: () => root, path: '/errore', component: ErrorPage });
const home = createRoute({ getParentRoute: () => root, path: '/', component: FamilyHub });
const invitation = createRoute({ getParentRoute: () => root, path: '/invito', component: InvitationPage });
const globalAdmin = createRoute({
  getParentRoute: () => root,
  path: '/admin',
  validateSearch: (search: Record<string, unknown>): { family?: string } => typeof search.family === 'string' ? { family: search.family } : {},
  component: GlobalAdminLayout,
});
const adminFamilies = createRoute({
  getParentRoute: () => root,
  path: '/admin/spazi',
  validateSearch: (search: Record<string, unknown>): { family?: string } => typeof search.family === 'string' ? { family: search.family } : {},
  component: AdminFamiliesPage,
});
const family = createRoute({ getParentRoute: () => root, path: '/spazi/$familyId', component: FamilyLayout });
const familyHome = createRoute({ getParentRoute: () => family, path: '/', component: () => <ChatPage/> });
const chat = createRoute({ getParentRoute: () => family, path: '/domande/$id', component: () => { const { id } = chat.useParams(); return <ChatPage key={id} id={id}/>; } });
const dictionary = createRoute({ getParentRoute: () => family, path: '/dizionario', component: DictionaryPage });
const admin = createRoute({ getParentRoute: () => family, path: '/coach', component: AdminPage });
const members = createRoute({ getParentRoute: () => family, path: '/membri', component: FamilyMembers });
const router = createRouter({ routeTree: root.addChildren([errorRoute, home, invitation, globalAdmin, adminFamilies, family.addChildren([familyHome, chat, dictionary, admin, members])]), defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
