import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Operator authorization for internal DIM map surfaces.
 *
 * Reuses the SAME session the email sign-in populates (`req.session.user`, set
 * in routes/auth.ts) — this is NOT a separate auth scheme. Two gates:
 *   1. No session at all              -> 401
 *   2. Session is not an operator     -> 403
 *
 * This used to compare the session's Slack `teamId` against `SLACK_TEAM_ID`,
 * from when sign-in went through Slack OAuth. That check was always a proxy for
 * the real question — workspace membership was never the same thing as being an
 * operator, and customers sitting in the workspace as guests were the reason
 * `role` was introduced in the first place. Now that sign-in is by email there
 * is no team id to compare, and `role` (resolved from OPERATOR_EMAILS at login,
 * never from the request) answers the question directly.
 */
export async function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (user.role !== "operator") {
    logger.warn(
      { userId: user.id, role: user.role },
      "requireOperator: rejecting a non-operator session",
    );
    res.status(403).json({ error: "Forbidden: operator access required" });
    return;
  }

  next();
}
