import { useState } from "react";
import { Link } from "wouter";
import logoIconUrl from "@assets/dimmap-icon.png";
import { api } from "@/lib/api-base";

type Step = "email" | "code";

/**
 * Sign-in and sign-up are one page in two modes, because after the first
 * step they are the same thing: a code arrives, the code is verified, a
 * session exists. Sign-up only adds the fields that create the tenant.
 */
export default function Login({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const isSignup = mode === "signup";
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api(isSignup ? "/auth/signup" : "/auth/request-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isSignup ? { email, name, company } : { email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? (isSignup ? "Could not create your account. Please try again." : "Could not send a code. Please try again."));
        return;
      }
      setStep("code");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api("/auth/verify-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That code is not correct.");
        return;
      }
      // Full reload rather than client-side navigation: it refetches /auth/me
      // from scratch, so no stale unauthenticated query result survives.
      window.location.href = "/app";
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#121714] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex items-center gap-2">
          <img src={logoIconUrl} alt="" className="h-16 w-auto" />
          <span className="text-3xl font-bold text-white tracking-tight">DIM <span className="text-sage">Convert</span></span>
        </div>

        <div className="w-full bg-[#1A211D] border border-white/10 rounded-2xl p-8 flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">{isSignup ? "Create your DIM Convert account" : "Sign in to DIM Convert"}</h1>
            {/* The server answers the same way for an address with no access
                as for one with it, so this must not promise that a code was
                actually sent — only that it would have been. */}
            <p className="mt-1 text-sm text-white/50">
              {step === "email"
                ? isSignup
                  ? "Free for 3 days, no card needed. We'll email you a 6-digit code to get in."
                  : "We'll email you a 6-digit code"
                : isSignup
                  ? `A 6-digit code is on its way to ${email}`
                  : `If ${email} has access, a 6-digit code is on its way`}
            </p>
          </div>

          {error && (
            <div
              className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 text-center"
              data-testid="login-error"
            >
              {error}
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={requestCode} className="flex flex-col gap-4">
              {isSignup && (
                <>
                  <input
                    type="text"
                    required
                    autoFocus
                    autoComplete="name"
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    data-testid="input-name"
                    className="w-full rounded-xl bg-[#121714] border border-white/10 px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-sage"
                  />
                  <input
                    type="text"
                    required
                    autoComplete="organization"
                    maxLength={120}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Company or team"
                    data-testid="input-company"
                    className="w-full rounded-xl bg-[#121714] border border-white/10 px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-sage"
                  />
                </>
              )}
              <input
                type="email"
                required
                autoFocus={!isSignup}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                data-testid="input-email"
                className="w-full rounded-xl bg-[#121714] border border-white/10 px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-sage"
              />
              <button
                type="submit"
                disabled={busy}
                data-testid="button-send-code"
                className="w-full rounded-xl bg-sage hover:bg-sage/90 disabled:opacity-50 transition-colors px-5 py-3 text-forest font-medium text-sm"
              >
                {busy ? (isSignup ? "Creating account..." : "Sending...") : isSignup ? "Start free trial" : "Send code"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="flex flex-col gap-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                data-testid="input-code"
                className="w-full rounded-xl bg-[#121714] border border-white/10 px-4 py-3 text-white text-center text-2xl tracking-[0.4em] font-mono placeholder:text-white/20 focus:outline-none focus:border-sage"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                data-testid="button-verify-code"
                className="w-full rounded-xl bg-sage hover:bg-sage/90 disabled:opacity-50 transition-colors px-5 py-3 text-forest font-medium text-sm"
              >
                {busy ? "Verifying..." : "Sign in"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
                data-testid="button-change-email"
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                Use a different email
              </button>
              <p className="text-center text-xs text-white/25">
                Nothing arrived? Wait a few minutes before asking for another —
                repeated requests are rate limited.
              </p>
            </form>
          )}

          {isSignup ? (
            <p className="text-center text-xs text-white/40">
              Already have an account?{" "}
              <Link href="/login" className="text-sage hover:text-sage/80">Sign in</Link>
            </p>
          ) : (
            <p className="text-center text-xs text-white/40">
              New to DIM Convert?{" "}
              <Link href="/signup" className="text-sage hover:text-sage/80">Create an account</Link>
              {" "}— free for 3 days.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
