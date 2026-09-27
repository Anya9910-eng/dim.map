/**
 * Reply History page — rendering tests
 *
 * Verifies that the page:
 *  1. Renders exactly one table row per draft in the API response
 *  2. Shows the current status badge for each draft
 *  3. After a send_failed → sent retry, displays "Sent" (not "Send Failed")
 *     for that draft and no duplicate row appears
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// ─── Shared mock state ─────────────────────────────────────────────────────────

const mockDrafts: Array<{
  id: number;
  clientId: number;
  campaignId: number;
  prospectName: string;
  prospectEmail: string;
  prospectCompany: string | null;
  replyText: string;
  editedReplyText: string | null;
  status: string;
  createdAt: string;
  actionedAt: string | null;
}> = [];

vi.mock("@workspace/api-client-react", () => ({
  useListDrafts: () => ({ data: mockDrafts, isLoading: false }),
  useListCampaigns: () => ({ data: [] }),
  useListClients: () => ({ data: [] }),
}));

// reply-history gained useAuth after these tests were written. useAuth calls
// useQuery, so leaving it real made every render fail with "No QueryClient
// set" before any assertion ran. Operator, matching the behaviour these tests
// were written against.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isOperator: true, clientId: null, user: null, loading: false }),
}));

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["", vi.fn()],
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={href} {...rest}>{children}</a>,
}));

// ─── Component under test ──────────────────────────────────────────────────────

import ReplyHistoryPage from "./reply-history";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDraft(id: number, status: string): (typeof mockDrafts)[number] {
  return {
    id,
    clientId: 1,
    campaignId: 1,
    prospectName: `Lead ${id}`,
    prospectEmail: `lead${id}@example.com`,
    prospectCompany: null,
    replyText: `Reply text for draft ${id}`,
    editedReplyText: null,
    status,
    createdAt: new Date(2026, 6, 21, 10, id).toISOString(),
    actionedAt: null,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("ReplyHistoryPage — one row per draft, correct status badge", () => {
  beforeEach(() => {
    mockDrafts.length = 0;
  });

  it("renders exactly one table row when there is one draft", () => {
    mockDrafts.push(makeDraft(1, "sent"));

    render(<ReplyHistoryPage />);

    const rows = screen.getAllByRole("row");
    // thead row (1) + tbody row (1) = 2
    expect(rows).toHaveLength(2);
  });

  it("renders one row per draft with no duplicates for two different drafts", () => {
    mockDrafts.push(makeDraft(10, "sent"), makeDraft(20, "discarded"));

    render(<ReplyHistoryPage />);

    const rows = screen.getAllByRole("row");
    // 1 header + 2 body rows
    expect(rows).toHaveLength(3);
  });

  it("shows 'Sent' badge (not 'Send Failed') for a draft that has been retried successfully", () => {
    // Simulate the state after send_failed → sent: the DB record has status "sent".
    // The reply-history page should show exactly one row with a "Sent" badge,
    // and no "Send Failed" badge for the same draft.
    mockDrafts.push(makeDraft(42, "sent"));

    render(<ReplyHistoryPage />);

    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByText("Send Failed")).not.toBeInTheDocument();
  });

  it("shows 'Send Failed' badge when the draft is still in send_failed state", () => {
    mockDrafts.push(makeDraft(42, "send_failed"));

    render(<ReplyHistoryPage />);

    expect(screen.getByText("Send Failed")).toBeInTheDocument();
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("renders the correct badge for each draft when statuses differ", () => {
    mockDrafts.push(makeDraft(1, "sent"), makeDraft(2, "discarded"), makeDraft(3, "pending"));

    render(<ReplyHistoryPage />);

    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Discarded")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows no 'Send Failed' badge when the only draft transitioned to sent", () => {
    // Represents the exact post-retry scenario:
    // before retry: draftId=42 had status "send_failed"
    // after retry:  draftId=42 has status "sent" in the DB
    // the API returns the single updated record, so the page sees one row with "sent"
    mockDrafts.push(makeDraft(42, "sent"));

    render(<ReplyHistoryPage />);

    const rows = screen.getAllByRole("row");
    // Only one data row for the single draft
    expect(rows).toHaveLength(2); // header + 1 body row

    // Status badge in the single row must be "Sent", not "Send Failed"
    const bodyRows = rows.slice(1);
    expect(bodyRows).toHaveLength(1);
    expect(within(bodyRows[0]).getByText("Sent")).toBeInTheDocument();
    expect(within(bodyRows[0]).queryByText("Send Failed")).not.toBeInTheDocument();
  });

  it("shows empty state when no drafts match (e.g. status filter for 'sent' returns nothing)", () => {
    // No drafts — simulates filtering to 'sent' when there are none yet

    render(<ReplyHistoryPage />);

    expect(screen.getByText(/no replies found/i)).toBeInTheDocument();
  });
});
