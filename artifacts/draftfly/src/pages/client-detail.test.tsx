/**
 * Client detail (admin): the settings form saves without any Slack fields, and
 * the Lead sources card lists every source's webhook address.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock workspace hooks ──────────────────────────────────────────────────────

const mockMutate = vi.fn();

const MOCK_CLIENT = {
  id: 1,
  name: "Acme Corp",
  company: "Acme",
  mode: "draft" as const,
  lemlistApiKey: "",
  n8nWebhookUrl: "",
  createdAt: new Date().toISOString(),
};

vi.mock("@workspace/api-client-react", () => ({
  useGetClient: () => ({ data: MOCK_CLIENT, isLoading: false }),
  useUpdateClient: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useListCampaigns: () => ({ data: [] }),
  getGetClientQueryKey: (id: number) => ["client", id],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  // client-detail navigates after delete; without these the mock throws on
  // import and every test in this file fails before reaching an assertion.
  useLocation: () => ["/clients/1", () => {}],
  useSearch: () => "",
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ─── Component under test ──────────────────────────────────────────────────────

import ClientDetail from "./client-detail";

// The Lead sources card loads its addresses from the admin endpoint.
const SOURCES = {
  clientId: 1,
  url: "https://convert.dim.capital/api/webhooks/lemlist/1?secret=s",
  hasSecret: true,
  headerName: "X-Webhook-Secret",
  hasClientApiKey: false,
  usingGlobalApiKeyFallback: false,
  whatsappSendingReady: false,
  sources: {
    lemlist: "https://convert.dim.capital/api/webhooks/lemlist/1?secret=s",
    meta: "https://convert.dim.capital/api/webhooks/meta/1?secret=s",
    google: "https://convert.dim.capital/api/webhooks/google/1?secret=s",
    youtube: "https://convert.dim.capital/api/webhooks/youtube/1?secret=s",
    whatsapp: "https://convert.dim.capital/api/webhooks/whatsapp/1?secret=s",
  },
};

describe("Client detail (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify(url.includes("lemlist-webhook") ? SOURCES : []), { status: 200 })),
    ));
  });

  it("has no Slack settings", () => {
    render(<ClientDetail />);
    expect(screen.queryByText(/slack/i)).not.toBeInTheDocument();
  });

  it("saves the settings form without Slack fields", async () => {
    const user = userEvent.setup();
    render(<ClientDetail />);
    const name = screen.getByLabelText(/^name$/i);
    await user.clear(name);
    await user.type(name, "Acme Holdings");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 1, data: { name: "Acme Holdings", company: "Acme", mode: "draft", lemlistApiKey: "", n8nWebhookUrl: "" } },
      expect.anything(),
    );
  });

  it("lists a webhook address for every lead source", async () => {
    render(<ClientDetail />);
    for (const source of ["lemlist", "meta", "google", "youtube", "whatsapp"]) {
      expect(await screen.findByText(`https://convert.dim.capital/api/webhooks/${source}/1?secret=s`)).toBeInTheDocument();
    }
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
  });
});
