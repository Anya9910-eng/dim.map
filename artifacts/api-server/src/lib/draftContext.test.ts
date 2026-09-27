import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = {
  clientId: number;
  prospectEmail: string;
  status: string;
  replyText: string;
  editedReplyText: string | null;
  conversationSnippet: string | null;
  createdAt: Date;
};

let rows: Row[] = [];
let shouldThrow = false;

vi.mock("./logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Conditions are recorded as plain objects and applied here, so the tests
// exercise the real filtering rather than a hand-fed result set.
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ k: "eq", col, val }),
  ne: (col: string, val: unknown) => ({ k: "ne", col, val }),
  and: (...args: unknown[]) => ({ k: "and", args: args.filter(Boolean) }),
  isNotNull: (col: string) => ({ k: "notnull", col }),
  desc: (c: unknown) => c,
}));

vi.mock("@workspace/db", () => {
  const draftsTable = new Proxy({}, { get: (_t, k) => String(k) });
  type Cond = { k: string; col?: string; val?: unknown; args?: Cond[] };

  const matches = (row: Row, cond: Cond | undefined): boolean => {
    if (!cond) return true;
    if (cond.k === "and") return (cond.args ?? []).every((c) => matches(row, c));
    if (cond.k === "eq") return (row as unknown as Record<string, unknown>)[cond.col!] === cond.val;
    if (cond.k === "notnull") return (row as unknown as Record<string, unknown>)[cond.col!] != null;
    return true;
  };

  const chain = (cond?: unknown, limit?: number) => {
    const run = () => {
      if (shouldThrow) return Promise.reject(new Error("db down"));
      const found = rows
        .filter((r) => matches(r, cond as Cond))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve(limit ? found.slice(0, limit) : found);
    };
    const res = { then: (...a: unknown[]) => (run() as Promise<unknown>).then(...(a as [])) };
    return Object.assign(res, {
      where: (c: unknown) => chain(c, limit),
      orderBy: () => chain(cond, limit),
      limit: (n: number) => chain(cond, n),
    });
  };

  return { draftsTable, db: { select: () => ({ from: () => chain() }) } };
});

const { buildDraftHistory } = await import("./draftContext");

const base = {
  clientId: 1,
  status: "sent",
  replyText: "generated",
  editedReplyText: null,
  conversationSnippet: "their message",
  createdAt: new Date(),
};

function row(over: Partial<Row>): Row {
  return { ...base, prospectEmail: "lead@a.test", ...over } as Row;
}

describe("buildDraftHistory", () => {
  beforeEach(() => {
    rows = [];
    shouldThrow = false;
  });

  it("returns nothing when the client has no history", async () => {
    expect(await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" })).toEqual({});
  });

  it("builds the thread for this lead, oldest first", async () => {
    rows = [
      row({ conversationSnippet: "first", replyText: "answer one", createdAt: new Date("2026-01-01") }),
      row({ conversationSnippet: "second", replyText: "answer two", createdAt: new Date("2026-01-02") }),
    ];
    const { thread } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(thread!.indexOf("first")).toBeLessThan(thread!.indexOf("second"));
  });

  it("shows what was actually sent, not what was drafted", async () => {
    rows = [row({ status: "edited", replyText: "robotic", editedReplyText: "human" })];
    const { thread } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(thread).toContain("human");
    expect(thread).not.toContain("robotic");
  });

  it("marks a discarded draft as never sent", async () => {
    // Otherwise the model treats it as something the lead already read.
    rows = [row({ status: "discarded", replyText: "never went out" })];
    const { thread } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(thread).toContain("discarded, not sent");
  });

  it("uses other leads' approved replies as voice examples", async () => {
    rows = [row({ prospectEmail: "other@b.test", replyText: "the house voice" })];
    const { approvedExamples } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(approvedExamples).toContain("the house voice");
  });

  it("does not repeat this lead's own thread as an example", async () => {
    // It is already in `thread`; repeating it wastes tokens and over-weights
    // one conversation.
    rows = [row({ prospectEmail: "lead@a.test", replyText: "same thread" })];
    const { approvedExamples } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(approvedExamples).toBeUndefined();
  });

  it("surfaces corrections as drafted-versus-corrected pairs", async () => {
    rows = [row({ prospectEmail: "x@b.test", status: "edited", replyText: "too pushy", editedReplyText: "softer" })];
    const { corrections } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(corrections).toContain("too pushy");
    expect(corrections).toContain("softer");
  });

  it("ignores an edit that changed nothing", async () => {
    // Slack's edit modal returns the full text, so a draft can be marked edited
    // while being identical — a correction that corrects nothing is noise.
    rows = [row({ prospectEmail: "x@b.test", status: "edited", replyText: "same", editedReplyText: "  same  " })];
    const { corrections } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(corrections).toBeUndefined();
  });

  it("never mixes in another client's data", async () => {
    rows = [row({ clientId: 99, prospectEmail: "other@b.test", replyText: "someone else's voice" })];
    const history = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(JSON.stringify(history)).not.toContain("someone else's voice");
  });

  it("truncates a long message rather than sending it whole", async () => {
    rows = [row({ conversationSnippet: "x".repeat(5000) })];
    const { thread } = await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" });
    expect(thread!.length).toBeLessThan(2000);
    expect(thread).toContain("…");
  });

  it("still drafts when history cannot be loaded", async () => {
    // History improves a draft; it is not required to produce one, and a
    // database hiccup must not cost the client a reply.
    shouldThrow = true;
    expect(await buildDraftHistory({ clientId: 1, prospectEmail: "lead@a.test" })).toEqual({});
  });
});
