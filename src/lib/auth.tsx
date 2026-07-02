import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isCloudConfigured } from "./supabase";

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
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isCloudConfigured);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
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
    async signInWithGoogle() {
      if (!supabase) return { error: "Cloud accounts are not configured." };
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/account` },
      });
      return { error: error?.message };
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
