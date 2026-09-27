import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-base";
import { useAuth } from "@/hooks/use-auth";

/** Mirrors api-server lib/billing AccessState, serialised. */
export type AccessState =
  | { kind: "managed" }
  | { kind: "trial"; endsAt: string; daysLeft: number }
  | { kind: "active"; plan: PlanKey }
  | { kind: "past_due"; plan: PlanKey }
  | { kind: "locked"; reason: "trial_ended" | "subscription_ended" };

export type PlanKey = "starter" | "growth";

export interface PlanLimits {
  activeCampaigns: number;
  repliesPerMonth: number;
}

export interface Billing {
  state: AccessState;
  plan: PlanKey;
  limits: PlanLimits;
  plans: Array<{ key: PlanKey; limits: PlanLimits; available: boolean }>;
  /** True once a Stripe customer exists — the portal can open. */
  canManage: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const billingQueryKey = ["me", "billing"] as const;

/**
 * The signed-in client's billing. Operators have none, so the query is
 * simply disabled for them rather than answering a 400 on every page.
 */
export function useBilling() {
  const { user, isOperator } = useAuth();
  return useQuery<Billing>({
    queryKey: billingQueryKey,
    queryFn: async () => json<Billing>(await fetch(api("/me/billing"), { credentials: "include" })),
    enabled: !!user && !isOperator,
    staleTime: 60 * 1000,
  });
}

/** Sends the browser to Stripe Checkout for a plan. */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async (plan: PlanKey) => {
      const body = await json<{ url: string }>(
        await fetch(api("/me/billing/checkout"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ plan }),
        }),
      );
      window.location.assign(body.url);
    },
  });
}

/** Sends the browser to Stripe's portal: change plan, card, or cancel. */
export function useOpenPortal() {
  return useMutation({
    mutationFn: async () => {
      const body = await json<{ url: string }>(
        await fetch(api("/me/billing/portal"), { method: "POST", credentials: "include" }),
      );
      window.location.assign(body.url);
    },
  });
}

export const PLAN_COPY: Record<PlanKey, { name: string; price: string; blurb: string }> = {
  starter: { name: "Starter", price: "$49", blurb: "For running DraftFly on a campaign or two." },
  growth: { name: "Growth", price: "$149", blurb: "For teams running real outreach across several campaigns." },
};
