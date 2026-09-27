import { Link } from "wouter";
import { useBilling } from "@/hooks/use-billing";

/**
 * One line above the page for a self-serve client: how long the trial has
 * left, or that a payment is failing. Nothing for paying or managed clients.
 */
export function TrialBanner() {
  const { data: billing } = useBilling();
  // `state` is checked, not just `billing`: a proxy or stub answering 200
  // with some other JSON must render nothing, not crash the whole layout.
  if (!billing?.state) return null;
  const s = billing.state;

  if (s.kind === "trial") {
    const days = s.daysLeft;
    return (
      <div
        className="bg-primary/10 border-b border-primary/20 px-6 py-2 text-sm text-center"
        data-testid="trial-banner"
      >
        {days <= 1 ? "Your free trial ends today." : `${days} days left in your free trial.`}{" "}
        <Link href="/settings#billing" className="font-medium underline underline-offset-4">Choose a plan</Link>
        {" "}to keep going after that.
      </div>
    );
  }
  if (s.kind === "past_due") {
    return (
      <div
        className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 text-sm text-center"
        data-testid="past-due-banner"
      >
        Your last payment didn't go through. Everything keeps working while Stripe retries —{" "}
        <Link href="/settings#billing" className="font-medium underline underline-offset-4">update your card</Link>
        {" "}to be safe.
      </div>
    );
  }
  return null;
}
