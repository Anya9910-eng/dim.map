/**
 * Placeholder-banner round-trip tests (task-53 stale-ack pruning)
 *
 * Covers two scenarios:
 *  1. dismiss banner → fix client channel → reload page → banner is gone (pruned)
 *  2. dismiss banner → add a new placeholder client → reload page → banner
 *     reappears for the new client only
 *
 * The pruning logic lives entirely in dashboard.tsx's useEffect that runs after
 * the clients list loads. We drive it through a minimal render of the Dashboard
 * with all heavy hooks mocked to their minimal stubs.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom does not implement ResizeObserver; recharts' ResponsiveContainer needs it.
if (typeof ResizeObserver === "undefined") {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ─── localStorage helper ───────────────────────────────────────────────────────

const PLACEHOLDER_ACK_KEY = "draftfly_placeholder_ack";

function setStoredAcks(ids: string[]) {
  localStorage.setItem(PLACEHOLDER_ACK_KEY, JSON.stringify(ids));
}

function getStoredAcks(): string[] {
  const raw = localStorage.getItem(PLACEHOLDER_ACK_KEY);
  return raw ? JSON.parse(raw) : [];
}

// ─── Shared mock state ─────────────────────────────────────────────────────────

/** Mutated per-test to control what useListClients returns. */
let mockClients: { id: number; name: string; slackChannel: string | null }[] = [];

// ─── Module mocks ──────────────────────────────────────────────────────────────

// The checklist has its own tests and its own hooks; keep it inert here.
vi.mock("@/components/setup-checklist", () => ({ SetupChecklist: () => null }));

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardStats: () => ({ data: undefined, isLoading: false }),
  useListPendingDrafts: () => ({ data: [], isLoading: false }),
  useListDrafts: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useListActivity: () => ({ data: [], isLoading: false }),
  useListClients: () => ({ data: mockClients }),
  useListCampaigns: () => ({ data: [] }),
  useGetReplyTrends: () => ({ data: [], isLoading: false }),
  getListDraftsQueryKey: () => ["drafts"],
  getListActivityQueryKey: () => ["activity"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  // useIntegrationStatus calls useQuery directly; without it the mock throws
  // on import and every test in this file fails before it runs.
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The banner is operator-only (showBanner = isOperator && ...). Without this
// the real useAuth runs, resolves to no user, and the banner can never render —
// so every assertion here failed for a reason unrelated to what it tests.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isOperator: true, clientId: null, user: null, loading: false }),
}));

// Stub wouter so the component can render without a router context.
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
}));

// ─── Component under test ──────────────────────────────────────────────────────

import Dashboard from "./dashboard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clients with a placeholder channel (name like "#general" or null). */
const PLACEHOLDER_A = { id: 1, name: "Client A", slackChannel: "#placeholder-a" };
// A malformed channel, not an absent one. This fixture used `slackChannel:
// null`, which stopped counting as a misconfiguration when Slack became
// optional: no channel is now a deliberate choice (approve in the dashboard),
// so the banner correctly ignores it and this client never triggered anything.
const PLACEHOLDER_B = { id: 2, name: "Client B", slackChannel: "#client-b" };
/** Client with a real Slack channel ID. */
const FIXED_A = { id: 1, name: "Client A", slackChannel: "C0123456789" };

function bannerVisible() {
  // Matches the banner's current wording. The old copy ("still use a
  // placeholder slack channel") was rewritten in the component and nobody
  // updated this, so the helper reported "no banner" unconditionally and every
  // assertion that expected one failed.
  return !!screen.queryByText(/unrecognised Slack channel/i);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Placeholder banner — stale-ack pruning round-trips", () => {
  beforeEach(() => {
    localStorage.clear();
    mockClients = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Scenario 1 ───────────────────────────────────────────────────────────────
  it("hides the banner on reload after the client's channel is fixed (ack pruned)", async () => {
    // Step 1 — start with one placeholder client; banner should appear.
    mockClients = [PLACEHOLDER_A];
    const { unmount } = render(<Dashboard />);
    await waitFor(() => expect(bannerVisible()).toBe(true));

    // Step 2 — operator dismisses the banner.
    const user = userEvent.setup();
    const dismissBtn = screen.getByRole("button", { name: /dismiss warning/i });
    await user.click(dismissBtn);
    await waitFor(() => expect(bannerVisible()).toBe(false));

    // Ack should now be stored.
    expect(getStoredAcks()).toContain(String(PLACEHOLDER_A.id));

    // Step 3 — operator fixes the client channel (simulate a page reload by
    //           unmounting and re-rendering with the updated client list).
    unmount();
    mockClients = [FIXED_A]; // slackChannel is now a real ID
    render(<Dashboard />);

    // After the pruning useEffect runs the previously-acked ID is no longer a
    // placeholder, so it should be removed from storage and the banner stays hidden.
    await waitFor(() => {
      expect(getStoredAcks()).not.toContain(String(PLACEHOLDER_A.id));
    });
    expect(bannerVisible()).toBe(false);
  });

  // ── Scenario 2 ───────────────────────────────────────────────────────────────
  it("reappears for a brand-new placeholder client after the original one is dismissed", async () => {
    // Step 1 — placeholder client A triggers the banner.
    mockClients = [PLACEHOLDER_A];
    const { unmount } = render(<Dashboard />);
    await waitFor(() => expect(bannerVisible()).toBe(true));

    // Step 2 — operator dismisses.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /dismiss warning/i }));
    await waitFor(() => expect(bannerVisible()).toBe(false));

    // Step 3 — a NEW placeholder client (B) is added; simulate reload.
    unmount();
    mockClients = [PLACEHOLDER_A, PLACEHOLDER_B];
    render(<Dashboard />);

    // Client A is still a placeholder, so its ack is retained and it is hidden.
    // Client B has never been acked, so the banner must reappear for it.
    await waitFor(() => expect(bannerVisible()).toBe(true));

    // Banner specifically calls out the unacked count (1 = only client B).
    // Client A ack is still stored (it is still a placeholder).
    expect(getStoredAcks()).toContain(String(PLACEHOLDER_A.id));
    // Client B is listed in the banner.
    expect(screen.getByText(PLACEHOLDER_B.name)).toBeTruthy();
  });

  // ── Baseline ─────────────────────────────────────────────────────────────────
  it("shows the banner on first load when placeholder clients exist and no acks are stored", async () => {
    mockClients = [PLACEHOLDER_A, PLACEHOLDER_B];
    render(<Dashboard />);
    await waitFor(() => expect(bannerVisible()).toBe(true));
    // Both client names should appear as action links in the banner.
    expect(screen.getByText(PLACEHOLDER_A.name)).toBeTruthy();
    expect(screen.getByText(PLACEHOLDER_B.name)).toBeTruthy();
  });

  it("does NOT show the banner when no placeholder clients exist", async () => {
    mockClients = [FIXED_A];
    render(<Dashboard />);
    // Wait a tick for effects to settle.
    await act(async () => {});
    expect(bannerVisible()).toBe(false);
  });

  it("does NOT show the banner when all placeholder clients have been acked", async () => {
    // Pre-seed acks for both placeholders.
    setStoredAcks([String(PLACEHOLDER_A.id), String(PLACEHOLDER_B.id)]);
    mockClients = [PLACEHOLDER_A, PLACEHOLDER_B];
    render(<Dashboard />);
    await act(async () => {});
    expect(bannerVisible()).toBe(false);
  });
});
