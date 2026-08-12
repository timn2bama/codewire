import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isCloudConfigured } from "./supabase";
import { setLocalDataScope } from "./jobs";
import { startGoogleOAuth } from "./authOAuth";

interface AuthResult {
  error?: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True when Supabase env is present and cloud features are available. */
  cloudEnabled: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: (returnPath?: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isCloudConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authEventSeen = false;
    const applySession = (next: Session | null) => {
      if (!active) return;
      setLocalDataScope(next?.user.id ?? null);
      setSession(next);
      setLoading(false);
    };
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!authEventSeen) applySession(error ? null : data.session);
      })
      .catch(() => {
        if (!authEventSeen) applySession(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      authEventSeen = true;
      applySession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    loading,
    cloudEnabled: isCloudConfigured,
    async signInWithPassword(email, password) {
      if (!supabase) return { error: "Cloud accounts are not configured." };
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error?.message };
    },
    async signUp(email, password) {
      if (!supabase) return { error: "Cloud accounts are not configured." };
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error?.message };
    },
    async signInWithGoogle(returnPath) {
      if (!supabase) return { error: "Cloud accounts are not configured." };
      return startGoogleOAuth(supabase.auth, window.location.origin, returnPath);
    },
    async signOut() {
      await supabase?.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
