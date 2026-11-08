"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authRequest, type AuthResponse } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";

type AuthMode = "login" | "signup";

function friendlyError(message: string) {
  if (message.includes("already exists")) return "An account with this email already exists. Try signing in instead.";
  if (message.includes("Invalid email or password")) return "The email or password is incorrect.";
  if (message.includes("origin")) return "This request was blocked by the security settings. Use the Nexora AI site at localhost:3000.";
  if (message.includes("temporarily unavailable")) return "The service is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { acceptUser } = useAuth();
  const isSignup = mode === "signup";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 320) {
      setError("Enter a valid email address.");
      return;
    }
    if (isSignup) {
      if (!displayName.trim()) {
        setError("Enter your full name.");
        return;
      }
      if (displayName.trim().length > 120) {
        setError("Your name must be 120 characters or fewer.");
        return;
      }
      if (password.length < 12 || password.length > 128) {
        setError("Use a password between 12 and 128 characters.");
        return;
      }
      if (password !== confirmation) {
        setError("The passwords do not match.");
        return;
      }
    } else if (!password || password.length > 128) {
      setError("Enter a password of 128 characters or fewer.");
      return;
    }

    setLoading(true);
    try {
      const payload = isSignup
        ? { email: cleanEmail, password, display_name: displayName.trim() || null }
        : { email: cleanEmail, password };
      const response = await authRequest<AuthResponse>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      acceptUser(response.user);
      router.replace("/");
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : ""));
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = "mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 dark:bg-[#0b1120] sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-44 h-[30rem] w-[30rem] rounded-full bg-blue-200/50 blur-3xl dark:bg-blue-600/10" />
        <div className="absolute -bottom-52 -right-32 h-[34rem] w-[34rem] rounded-full bg-indigo-200/50 blur-3xl dark:bg-indigo-600/10" />
      </div>
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_30px_100px_-45px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 via-blue-700 to-indigo-800 p-10 text-white lg:flex">
          <Link href="/login" className="flex items-center gap-3" aria-label="Nexora AI home">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-lg font-black">N</span>
            <span className="text-lg font-bold tracking-tight">Nexora<span className="font-medium text-blue-200"> AI</span></span>
          </Link>
          <div className="max-w-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-blue-50"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Intelligent IT support</span>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight">Support that keeps your work moving.</h1>
            <p className="mt-4 text-sm leading-7 text-blue-100">Bring your support tickets and AI-powered troubleshooting together in one calm, focused workspace.</p>
            <div className="mt-8 space-y-3 text-sm text-blue-50">
              {[["✓", "Keep every request organized"], ["✦", "Get help from your AI copilot"], ["◷", "Pick up where you left off"]].map(([icon, label]) => <div key={label} className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10">{icon}</span>{label}</div>)}
            </div>
          </div>
          <p className="text-xs text-blue-200">© {new Date().getFullYear()} Nexora AI</p>
        </section>

        <section className="p-6 sm:p-10 lg:p-12">
          <Link href="/login" className="inline-flex items-center gap-2 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-base font-black text-white">N</span>
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Nexora<span className="text-blue-600 dark:text-blue-400"> AI</span></span>
          </Link>
          <div className="mx-auto mt-8 max-w-md lg:mt-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">{isSignup ? "Get started" : "Welcome back"}</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{isSignup ? "Create your account" : "Sign in to Nexora"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{isSignup ? "Set up your secure workspace account." : "Your support workspace is ready when you are."}</p>

            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              {isSignup && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Full name<input required autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} className={fieldClass} placeholder="Alex Morgan" /></label>}
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} className={fieldClass} placeholder="you@company.com" /></label>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Password<div className="relative mt-2"><input type={showPassword ? "text" : "password"} required autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} className={`${fieldClass} mt-0 pr-20`} placeholder={isSignup ? "At least 12 characters" : "Enter your password"} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-3 my-auto h-9 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div></label>
              {isSignup && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Confirm password<input type={showPassword ? "text" : "password"} required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={128} className={fieldClass} placeholder="Re-enter your password" /></label>}

              {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-wait disabled:opacity-65">{loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}{loading ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Create account" : "Sign in")}</button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-500 dark:text-slate-400">{isSignup ? "Already have an account?" : "New to Nexora AI?"} <Link href={isSignup ? "/login" : "/signup"} className="font-bold text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200">{isSignup ? "Sign in" : "Create an account"}</Link></p>
            <p className="mt-8 text-center text-xs leading-5 text-slate-400">Protected by secure, HTTP-only session cookies. Your password is never stored in this browser.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
