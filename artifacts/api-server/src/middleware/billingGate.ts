import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { accessStateFor, hasAccess } from "../lib/billing";
import { logger } from "../lib/logger";

/**
 * Locks a self-serve tenant whose trial has ended or whose subscription is
 * gone. Runs after apiGate, so the caller is already authenticated.
 *
 * What stays open while locked: reading who you are, and everything needed
 * to pay. Nothing else — a locked account is read-only right down to the
 * API, not merely hidden in the UI.
 *
 * Operators and managed clients pass straight through. A missing client row
 * passes too: the scoping helpers already answer that with empty results, and
 * a gate that failed closed on a lookup error would lock people out during a
 * database blip.
 */
const OPEN_WHILE_LOCKED: readonly RegExp[] = [
  /^\/auth(?:\/|$)/,
  /^\/me\/billing(?:\/|$)/,
  /^\/healthz$/,
];

export async function billingGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.session?.user;
  if (!user || user.role !== "client" || typeof user.clientId !== "number") {
    next();
    return;
  }

  const normalized = req.path.replace(/\/+$/, "") || "/";
  if (OPEN_WHILE_LOCKED.some((p) => p.test(normalized))) {
    next();
    return;
  }

  try {
    const [client] = await db
      .select({
        billingMode: clientsTable.billingMode,
        trialEndsAt: clientsTable.trialEndsAt,
        subscriptionStatus: clientsTable.subscriptionStatus,
        plan: clientsTable.plan,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, user.clientId))
      .limit(1);
    if (!client) {
      next();
      return;
    }
    const state = accessStateFor(client);
    if (hasAccess(state)) {
      next();
      return;
    }
    res.status(402).json({
      error:
        state.kind === "locked" && state.reason === "trial_ended"
          ? "Your free trial has ended. Choose a plan to keep going."
          : "Your subscription has ended. Choose a plan to keep going.",
      code: "billing_locked",
    });
  } catch (err) {
    logger.error({ err, clientId: user.clientId }, "billingGate could not load the client — letting the request through");
    next();
  }
}
