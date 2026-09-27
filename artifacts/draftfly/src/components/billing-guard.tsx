import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api-base";
import { useBilling } from "@/hooks/use-billing";
import { useAuth } from "@/hooks/use-auth";
import { PlanPicker } from "@/components/plan-picker";

/**
 * Between the session and the app: a locked self-serve tenant sees only the
 * plans. The server refuses everything else with 402 regardless — this just
 * spares them a dashboard full of errors.
 *
 * Operators and managed clients never load billing at all, so they render
 * children immediately; a client user waits for one small request.
 */
export function BillingGuard({ children }: { children: React.ReactNode }) {
  const { isOperator, user } = useAuth();
  const { data: billing, isLoading } = useBilling();
  const queryClient = useQueryClient();

  if (isOperator) return <>{children}</>;
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!billing?.state || billing.state.kind !== "locked") return <>{children}</>;

  const trialEnded = billing.state.reason === "trial_ended";

  async function signOut() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Signing out locally is still right.
    }
    queryClient.clear();
    window.location.href = import.meta.env.BASE_URL;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12" data-testid="paywall">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex justify-center items-center gap-2">
          <img src="/logo-mark.svg" alt="" className="h-10 w-auto" />
          <span className="text-2xl font-bold">DIM map</span>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">
            {trialEnded ? "Your free trial has ended" : "Your subscription has ended"}
          </h1>
          <p className="text-muted-foreground">
            {trialEnded
              ? "Your campaigns, personas and drafts are all still here. Pick a plan to keep going."
              : "Everything is still here. Pick a plan to switch it back on."}
          </p>
        </div>
        <PlanPicker />
        <p className="text-center text-xs text-muted-foreground">
          Signed in as {user?.email}.{" "}
          <button type="button" onClick={signOut} className="underline hover:text-foreground">Sign out</button>
        </p>
      </div>
    </div>
  );
}
