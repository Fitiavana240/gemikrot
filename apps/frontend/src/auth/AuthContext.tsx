import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearToken, getToken, setToken } from '../api/client';
import { login as loginRequest } from '../api/auth';
import type { AdminRole, AuthUser } from '../api/types';

const USER_KEY = 'wifitati_user';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** VIEWER n'a jamais le droit d'écrire (Section 28). */
  canWrite: boolean;
  /**
   * Ouvre une session a partir d'un jeton deja obtenu.
   *
   * L'inscription en rend un : redemander a l'instant un mot de passe qu'on
   * vient de choisir serait absurde, et la page de confirmation a besoin
   * d'etre authentifiee pour que le code ne vaille que pour ce compte-la.
   */
  ouvrirSession: (accessToken: string, utilisateur: AuthUser) => void;
  /**
   * L'adresse vient d'être confirmée.
   *
   * L'état local suit tout de suite : attendre la prochaine connexion
   * laisserait le bandeau en place après un succès, et on recommencerait.
   */
  confirmerAdresse: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? readStoredUser() : null));

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      canWrite: user != null && (user.role as AdminRole) !== 'VIEWER',
      login: async (email, password) => {
        const res = await loginRequest(email, password);
        setToken(res.accessToken);
        setUser(res.user);
      },
      ouvrirSession: (accessToken, utilisateur) => {
        setToken(accessToken);
        setUser(utilisateur);
      },
      confirmerAdresse: () => setUser((u) => (u ? { ...u, emailVerifie: true } : u)),
      logout: () => {
        clearToken();
        localStorage.removeItem(USER_KEY);
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé sous <AuthProvider>');
  return ctx;
}
