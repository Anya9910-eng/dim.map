import { useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBilling, useOpenPortal, billingQueryKey, PLAN_COPY } from "@/hooks/use-billing";
import { PlanPicker } from "@/components/plan-picker";

/**
 * The Billing section of a client's Settings.
 *
 * Stripe sends people back here with ?billing=success|cancelled. Success is
 * acknowledged and the billing query refetched, since the webhook that
 * flips the state may land a second or two after the redirect.
 */
export function BillingCard() {
  const { data: billing, isLoading } = useBilling();
  const portal = useOpenPortal();
  const { toast } = useToast();
  const search = useSearch();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const outcome = new URLSearchParams(search).get("billing");
    if (!outcome) return;
    if (outcome === "success") {
      toast({ title: "You're subscribed", description: "Thanks — your plan is active." });
      void queryClient.invalidateQueries({ queryKey: billingQueryKey });
      // The webhook can trail the redirect; ask once more shortly after.
      const t = setTimeout(() => void queryClient.invalidateQueries({ queryKey: billingQueryKey }), 3000);
      navigate("/settings", { replace: true });
      return () => clearTimeout(t);
    }
    if (outcome === "cancelled") {
      toast({ title: "Checkout cancelled", description: "No charge was made." });
      navigate("/settings", { replace: true });
    }
    return undefined;
  }, [search, toast, navigate, queryClient]);

  if (isLoading || !billing) return null;
  if (billing.state.kind === "managed") return null;

  const s = billing.state;
  const status =
    s.kind === "trial"
      ? { label: `Free trial — ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`, tone: "secondary" as const }
      : s.kind === "active"
        ? { label: `${PLAN_COPY[s.plan].name} — active`, tone: "default" as const }
        : s.kind === "past_due"
          ? { label: `${PLAN_COPY[s.plan].name} — payment failed`, tone: "destructive" as const }
          : { label: "No active plan", tone: "destructive" as const };

  const subscribed = s.kind === "active" || s.kind === "past_due";

  return (
    <Card id="billing">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" /> Billing
          <Badge variant={status.tone} data-testid="billing-status">{status.label}</Badge>
        </CardTitle>
        <CardDescription>
          {subscribed
            ? "Change plan, update your card, or cancel — all through Stripe."
            : "Pick a plan to keep DIM Convert after your trial. Cancel any time."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {subscribed ? (
          <Button variant="outline" onClick={() => portal.mutate()} disabled={portal.isPending} data-testid="manage-billing">
            {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
          </Button>
        ) : (
          <PlanPicker />
        )}
        {portal.isError && <p className="text-sm text-destructive">{String((portal.error as Error).message)}</p>}
      </CardContent>
    </Card>
  );
}
