/**
 * Recent Activity is an operator surface.
 *
 * On a client's own dashboard the feed restated what Draft Replies and Reply
 * History already show, with their own company name stamped on every row. It
 * is not merely hidden for them — the request is never made.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

if (typeof ResizeObserver === "undefined") {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}

type ActivityOpts = { query?: { enabled?: boolean } };

// Typed with its parameters so the assertions below can read the options
// argument the component passed.
const activityHook = vi.fn(
  (_params?: unknown, _options?: ActivityOpts) => ({
    data: [{
      id: 1,
      description: "Claude generated reply for Olha Vakuliuk",
      createdAt: new Date().toISOString(),
      clientName: "Tim",
    }],
    isLoading: false,
  }),
);

let mockIsOperator = true;

// The checklist has its own tests and its own hooks; keep it inert here.
vi.mock("@/components/setup-checklist", () => ({ SetupChecklist: () => null }));

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardStats: () => ({ data: undefined, isLoading: false }),
  useListPendingDrafts: () => ({ data: [], isLoading: false }),
  useListDrafts: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useListActivity: (params?: unknown, options?: ActivityOpts) => activityHook(params, options),
  useListClients: () => ({ data: [] }),
  useListCampaigns: () => ({ data: [] }),
  useGetReplyTrends: () => ({ data: [], isLoading: false }),
  getListDraftsQueryKey: () => ["drafts"],
  getListActivityQueryKey: () => ["activity"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isOperator: mockIsOperator, clientId: mockIsOperator ? null : 12 }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
}));

import Dashboard from "./dashboard";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});

describe("Recent Activity visibility", () => {
  it("is shown to an operator", () => {
    mockIsOperator = true;
    render(<Dashboard />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
  });

  it("is absent for a client user", () => {
    mockIsOperator = false;
    render(<Dashboard />);
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/No activity yet/)).not.toBeInTheDocument();
  });

  it("does not even request the feed for a client user", () => {
    mockIsOperator = false;
    render(<Dashboard />);

    const opts = activityHook.mock.calls[0]?.[1];
    expect(opts?.query?.enabled).toBe(false);
  });

  it("requests it for an operator", () => {
    mockIsOperator = true;
    render(<Dashboard />);

    const opts = activityHook.mock.calls[0]?.[1];
    expect(opts?.query?.enabled).toBe(true);
  });
});
