/**
 * What each plan allows.
 *
 * Two axes, chosen because they are the two things that actually vary between
 * customers and the two things this schema can count. "Lemlist accounts" is
 * not among them: a client *is* one Lemlist account, so every customer would
 * be on "1".
 *
 * Campaigns is the axis that discriminates at real volume — an observed live
 * client runs four. Replies barely discriminate at all: that same client
 * handles around sixty a month, well under any workable ceiling. So campaigns
 * shapes the tiers and replies is a ceiling that protects against a runaway
 * account without binding on normal use.
 *
 * Deliberately not metered on campaigns *cost*: a campaign with no replies
 * costs nothing to serve. The limit exists to place a customer in a tier, not
 * to price a resource.
 */

export type PlanName = "starter" | "growth";

export interface PlanLimits {
  /**
   * Campaigns that may be *drafting* at once.
   *
   * Mapping a campaign is unlimited — a client can import their whole Lemlist
   * account and see it all listed. What the plan sells is how many of those
   * are switched on, which is also the only axis that costs anything to
   * serve, since an inactive campaign never reaches the model.
   */
  activeCampaigns: number;
  /** Replies drafted within a calendar month. */
  repliesPerMonth: number;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  starter: { activeCampaigns: 2, repliesPerMonth: 100 },
  growth: { activeCampaigns: 10, repliesPerMonth: 500 },
};

/**
 * Limits for a client's plan.
 *
 * An unrecognised or missing plan resolves to starter — the *smaller*
 * allowance. A row written before this column existed, or by a future version
 * naming a plan this build has never heard of, must not be handed the larger
 * one by accident.
 */
export function limitsFor(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.starter;
}

/** First instant of the current calendar month, UTC — the reply window. */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
