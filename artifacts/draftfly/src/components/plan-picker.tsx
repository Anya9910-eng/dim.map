import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";
import { useBilling, useStartCheckout, PLAN_COPY, type PlanKey } from "@/hooks/use-billing";

const CONTACT_EMAIL = "outreach@dim.capital";

/**
 * The two plans, with a button each. Used on the paywall and in Settings.
 *
 * "Current" is only marked on an active subscription — a trial is on the
 * starter *limits* but has not bought anything, and marking it current
 * would make the button that matters look like a no-op.
 */
export function PlanPicker({ compact = false }: { compact?: boolean }) {
  const { data: billing } = useBilling();
  const checkout = useStartCheckout();
  if (!billing) return null;

  const activePlan =
    billing.state.kind === "active" || billing.state.kind === "past_due" ? billing.state.plan : null;
  const anyAvailable = billing.plans.some((p) => p.available);

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
        {billing.plans.map((plan) => {
          const copy = PLAN_COPY[plan.key];
          const isCurrent = activePlan === plan.key;
          return (
            <div
              key={plan.key}
              data-testid={`plan-${plan.key}`}
              className={`rounded-xl border p-5 flex flex-col gap-3 ${
                plan.key === "growth" ? "border-primary/40 bg-primary/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-semibold">{copy.name}</div>
                  <div className="text-xs text-muted-foreground">{copy.blurb}</div>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold">{copy.price}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </div>
              </div>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-green-500" /> {plan.limits.activeCampaigns} active campaigns</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-green-500" /> {plan.limits.repliesPerMonth} leads / month</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-green-500" /> Approve in the Lead Inbox</li>
              </ul>
              <Button
                className="mt-auto"
                variant={plan.key === "growth" ? "default" : "outline"}
                disabled={!plan.available || isCurrent || checkout.isPending}
                onClick={() => checkout.mutate(plan.key as PlanKey)}
                data-testid={`choose-${plan.key}`}
              >
                {checkout.isPending && checkout.variables === plan.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isCurrent ? (
                  "Current plan"
                ) : (
                  `Choose ${copy.name}`
                )}
              </Button>
            </div>
          );
        })}
      </div>
      {!anyAvailable && (
        <p className="text-sm text-muted-foreground" data-testid="payments-unavailable">
          Payments aren't switched on for this deployment yet. Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a> and we'll sort it out by hand.
        </p>
      )}
      {checkout.isError && (
        <p className="text-sm text-destructive" role="alert">{String((checkout.error as Error).message)}</p>
      )}
    </div>
  );
}
