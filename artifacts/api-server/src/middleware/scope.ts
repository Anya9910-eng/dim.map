import type { Request, Response, NextFunction } from "express";
import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { logger } from "../lib/logger";

/**
 * Tenant scoping for routes that both operators and client users can reach.
 *
 * The role and client id are read from the session, which was populated at
 * login from the email Slack vouched for. Nothing here trusts a client id
 * supplied by the caller — that is the whole point: a client user asking for
 * `/drafts?clientId=7` must not receive client 7's drafts.
 */

/** Any signed-in person: operator or an invited client user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Sessions created before roles existed carry neither `role` nor `clientId`.
  // Such a session cannot be scoped — there is nothing to scope it to — so it
  // is refused and the person signs in again, which mints a session with both.
  // Treating a missing role as "client" would silently un-scope every query.
  if (user.role !== "operator" && user.role !== "client") {
    res.status(401).json({ error: "Session predates access roles — please sign in again" });
    return;
  }
  if (user.role === "client" && typeof user.clientId !== "number") {
    res.status(401).json({ error: "Session is missing its client — please sign in again" });
    return;
  }

  next();
}

export function isOperator(req: Request): boolean {
  return req.session?.user?.role === "operator";
}

/**
 * The client a request is confined to, or null when the caller is an operator.
 *
 * `requireAuth` has already rejected anything malformed, but this is the
 * function every query trusts, so it does not assume that: an unrecognised
 * session yields a client id that matches nothing rather than null, which would
 * read as "operator, no filter".
 */
export function scopedClientId(req: Request): number | null {
  const user = req.session?.user;
  if (!user) return NO_CLIENT;
  if (user.role === "operator") return null;
  return typeof user.clientId === "number" ? user.clientId : NO_CLIENT;
}

/** A client id no row can have, used to make a malformed session match nothing. */
const NO_CLIENT = -1;

/**
 * A `where` fragment that limits a query to the caller's own client.
 *
 * Returns `undefined` for an operator so the caller can spread it into an
 * `and(...)` unchanged and get an unfiltered query.
 */
export function clientScope(req: Request, column: PgColumn): SQL | undefined {
  const clientId = scopedClientId(req);
  if (clientId === null) return undefined;
  return eq(column, clientId);
}

/**
 * Guards a row that has already been loaded.
 *
 * Some handlers fetch by primary key before they can know which client the row
 * belongs to. Rather than let those become the gap in the scoping, they pass
 * the row's client id through here.
 *
 * Answers 404 rather than 403 on a mismatch: telling a client user that a row
 * exists but is someone else's leaks that it exists at all.
 */
export function canAccessClient(req: Request, rowClientId: number | null | undefined): boolean {
  const scoped = scopedClientId(req);
  if (scoped === null) return true;
  if (rowClientId == null) return false;
  if (rowClientId !== scoped) {
    logger.warn(
      { userId: req.session?.user?.id, scoped, rowClientId },
      "Blocked cross-client access attempt",
    );
    return false;
  }
  return true;
}

/** Sends the 404 used for rows the caller may not see. */
export function denyNotFound(res: Response, entity = "Resource"): void {
  res.status(404).json({ error: `${entity} not found` });
}
