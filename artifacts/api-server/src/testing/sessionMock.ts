import type { Request, Response, NextFunction } from "express";

/**
 * In-memory session for tests that mount the real app (`src/app.ts`).
 *
 * The real session middleware is backed by connect-pg-simple, so any test that
 * needs an authenticated operator would otherwise have to reach Postgres. These
 * tests exercise route logic, not session persistence, so they swap the store
 * out entirely:
 *
 *   vi.mock("express-session", async () =>
 *     (await import("../testing/sessionMock")).expressSessionMock());
 *
 * and call `loginAsOperator()` in `beforeEach`.
 */

/** Session object handed to every request; swap `.value` to change identity. */
export const testSession: { value: Record<string, unknown> } = { value: {} };

/** Factory for `vi.mock("express-session", ...)`. */
export function expressSessionMock(): { default: unknown } {
  const middleware = () =>
    (req: Request, _res: Response, next: NextFunction): void => {
      (req as unknown as { session: Record<string, unknown> }).session = testSession.value;
      next();
    };
  // connect-pg-simple reads `session.Store` to subclass it at import time.
  (middleware as unknown as { Store: unknown }).Store = class {};
  return { default: middleware };
}

/**
 * Authenticate as an operator.
 *
 * `requireOperator` reads `role` alone, so nothing here needs to stand in for a
 * Slack workspace any more.
 */
export function loginAsOperator(): void {
  process.env["OPERATOR_EMAILS"] = "operator@draftfly.test";
  testSession.value = {
    user: {
      id: "operator@draftfly.test",
      name: "Test Operator",
      email: "operator@draftfly.test",
      role: "operator",
      clientId: null,
    },
  };
}

/**
 * Authenticate as an invited user of one client.
 *
 * The counterpart to `loginAsOperator` for the isolation tests: every route
 * that both populations reach should return this client's rows and nothing
 * else, whatever the request asks for.
 */
export function loginAsClientUser(clientId: number, email = "client@example.test"): void {
  process.env["OPERATOR_EMAILS"] = "operator@draftfly.test";
  testSession.value = {
    user: {
      id: email,
      name: "Test Client User",
      email,
      role: "client",
      clientId,
    },
  };
}

/** Drop the session (requests then hit the 401 path). */
export function logoutOperator(): void {
  testSession.value = {};
}
