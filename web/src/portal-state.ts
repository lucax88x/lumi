import { createContext, useContext } from 'react';
import type { Session } from './api/types.gen';
export const SessionContext = createContext<Session>({ authenticated: false, portalAccess: false, admin: false, email: '', csrfToken: '', families: [] });
export const AccountContext = createContext({ signout: async () => {}, signingOut: false });
export function useSession() { return useContext(SessionContext); }
export function useAccount() { return useContext(AccountContext); }
export function familyID() { return window.location.pathname.match(/^\/famiglie\/([^/]+)/)?.[1] ?? ''; }
export function familyPath(path: string, id = familyID()) { return `/api/v1/families/${encodeURIComponent(id)}${path}`; }
