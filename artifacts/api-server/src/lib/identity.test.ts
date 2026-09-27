import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const rows: Array<{ id: number; clientId: number; email: string }> = [];

vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("drizzle-orm", () => ({ eq: (_c: unknown, v: unknown) => ({ v }) }));
vi.mock("@workspace/db", () => ({
  clientUsersTable: { email: "email" },
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { v: unknown }) =>
          Promise.resolve(rows.filter((r) => r.email === cond.v)),
      }),
    }),
  },
}));

const { resolveIdentity, isOperatorEmail } = await import("./identity");

describe("resolveIdentity", () => {
  const original = process.env.OPERATOR_EMAILS;

  beforeEach(() => {
    rows.length = 0;
    process.env.OPERATOR_EMAILS = "anna@draftfly.app, Second.Operator@Draftfly.app";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPERATOR_EMAILS;
    else process.env.OPERATOR_EMAILS = original;
  });

  it("recognises an operator", async () => {
    expect(await resolveIdentity("anna@draftfly.app")).toEqual({ role: "operator", clientId: null });
  });

  it("ignores case and surrounding spaces on both sides", async () => {
    expect(isOperatorEmail("  SECOND.OPERATOR@draftfly.APP ")).toBe(true);
  });

  it("resolves an invited address to its client", async () => {
    rows.push({ id: 1, clientId: 7, email: "olha@acme.test" });
    expect(await resolveIdentity("Olha@Acme.test")).toEqual({ role: "client", clientId: 7 });
  });

  it("refuses an address that is neither", async () => {
    // The default for an unknown address is no access at all, not client access.
    expect(await resolveIdentity("stranger@example.com")).toBeNull();
  });

  it("refuses an empty address", async () => {
    expect(await resolveIdentity("")).toBeNull();
    expect(await resolveIdentity("   ")).toBeNull();
  });

  it("grants operator to nobody when the list is unset", async () => {
    // Fail closed: an unconfigured deployment must not treat everyone as an
    // operator, which is the hole this replaces.
    delete process.env.OPERATOR_EMAILS;
    expect(isOperatorEmail("anna@draftfly.app")).toBe(false);
    expect(await resolveIdentity("anna@draftfly.app")).toBeNull();
  });

  it("does not treat an invited client user as an operator", async () => {
    rows.push({ id: 1, clientId: 7, email: "olha@acme.test" });
    const identity = await resolveIdentity("olha@acme.test");
    expect(identity?.role).toBe("client");
    expect(identity?.clientId).toBe(7);
  });
});
