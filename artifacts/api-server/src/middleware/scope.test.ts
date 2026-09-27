import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  requireAuth,
  isOperator,
  scopedClientId,
  clientScope,
  canAccessClient,
} from "./scope";

vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function reqAs(user: Record<string, unknown> | undefined): Request {
  return { session: user ? { user } : {} } as unknown as Request;
}

const operator = { id: "U1", role: "operator", clientId: null };
const clientUser = { id: "U2", role: "client", clientId: 7 };

// A column stand-in: clientScope only passes it to drizzle's eq(), which is
// exercised for real in the route tests.
const column = { name: "client_id" } as never;

describe("requireAuth", () => {
  it("rejects a request with no session", () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn();

    requireAuth(reqAs(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("lets a client user through — routes scope the rows, the gate does not", () => {
    const next = vi.fn();
    requireAuth(reqAs(clientUser), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuses a session created before roles existed", () => {
    // Such a session cannot be scoped to anything. Letting it through as a
    // client would un-scope every query it makes.
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn();

    requireAuth(reqAs({ id: "U9", email: "old@session" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("refuses a client session with no client attached", () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn();

    requireAuth(reqAs({ id: "U9", role: "client", clientId: null }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("scopedClientId", () => {
  it("is null for an operator, so their queries stay unfiltered", () => {
    expect(scopedClientId(reqAs(operator))).toBeNull();
    expect(isOperator(reqAs(operator))).toBe(true);
  });

  it("is the client's own id for an invited user", () => {
    expect(scopedClientId(reqAs(clientUser))).toBe(7);
    expect(isOperator(reqAs(clientUser))).toBe(false);
  });

  it("matches nothing for a malformed session rather than reading as operator", () => {
    // Returning null here would mean "no filter", which is the opposite of safe.
    expect(scopedClientId(reqAs(undefined))).toBe(-1);
    expect(scopedClientId(reqAs({ id: "U9", role: "client" }))).toBe(-1);
  });
});

describe("clientScope", () => {
  it("adds no condition for an operator", () => {
    expect(clientScope(reqAs(operator), column)).toBeUndefined();
  });

  it("adds a condition for a client user", () => {
    expect(clientScope(reqAs(clientUser), column)).toBeDefined();
  });
});

describe("canAccessClient", () => {
  it("lets an operator reach any client's row", () => {
    expect(canAccessClient(reqAs(operator), 1)).toBe(true);
    expect(canAccessClient(reqAs(operator), 999)).toBe(true);
    expect(canAccessClient(reqAs(operator), null)).toBe(true);
  });

  it("lets a client user reach their own row", () => {
    expect(canAccessClient(reqAs(clientUser), 7)).toBe(true);
  });

  it("blocks a client user from another client's row", () => {
    expect(canAccessClient(reqAs(clientUser), 8)).toBe(false);
  });

  it("blocks a client user from a row with no owner", () => {
    // An unowned row cannot be proven to be theirs, so it is not theirs.
    expect(canAccessClient(reqAs(clientUser), null)).toBe(false);
    expect(canAccessClient(reqAs(clientUser), undefined)).toBe(false);
  });
});
