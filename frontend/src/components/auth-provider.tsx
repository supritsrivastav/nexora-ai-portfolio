"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { authRequest, type AuthResponse, type AuthUser } from "@/lib/auth";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string;
  refreshUser: () => Promise<AuthUser | null>;
  acceptUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function PageLoader({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-700 dark:bg-[#0b1120] dark:text-slate-200">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </main>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [error, setError] = useState("");

  const refreshUser = useCallback(async () => {
    try {
      const result = await authRequest<AuthResponse>("/auth/me");
      setUser(result.user);
      setStatus("authenticated");
      return result.user;
    } catch (cause) {
      setUser(null);
      if (cause instanceof Error && cause.message === "Authentication required.") {
        setStatus("unauthenticated");
      } else if (cause instanceof Error && cause.message.includes("401")) {
        setStatus("unauthenticated");
      } else {
        setStatus("error");
        setError("We could not verify your session. Check the connection and try again.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    const check = window.setTimeout(() => void refreshUser(), 0);
    return () => window.clearTimeout(check);
  }, [refreshUser]);

  useEffect(() => {
    if (status === "unauthenticated" && pathname === "/") router.replace("/login");
    if (status === "authenticated" && (pathname === "/login" || pathname === "/signup")) {
      router.replace("/");
    }
  }, [pathname, router, status]);

  const acceptUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    setError("");
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await authRequest<void>("/auth/logout", { method: "POST" });
    setUser(null);
    setError("");
    setStatus("unauthenticated");
    router.replace("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, status, error, refreshUser, acceptUser, logout }),
    [user, status, error, refreshUser, acceptUser, logout],
  );

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  if (status === "checking") return <PageLoader message="Checking your secure session…" />;
  if (status === "error" && !isAuthPage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 dark:bg-[#0b1120]">
        <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-xl text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">!</div>
          <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Session check unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{error}</p>
          <button type="button" onClick={() => void refreshUser()} className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Try again</button>
        </section>
      </main>
    );
  }
  if (status === "unauthenticated" && pathname === "/") return <PageLoader message="Redirecting to sign in…" />;
  if (status === "authenticated" && isAuthPage) return <PageLoader message="Opening your dashboard…" />;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
