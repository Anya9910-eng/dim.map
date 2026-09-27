/**
 * The Campaigns page's activation controls.
 *
 * The rule being enforced is that a plan buys N campaigns *drafting at once*,
 * not N campaigns mapped — so switching off must always work, and switching on
 * must be refused once the slots are gone.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUpdateMutate = vi.fn();

let mockCampaigns = [
  { id: 1, clientId: 3, name: "Q3 Outbound", lemlistCampaignId: "cam_1", personaId: null, isActive: true, replyCount: 12 },
  { id: 2, clientId: 3, name: "Reactivation", lemlistCampaignId: "cam_2", personaId: null, isActive: true, replyCount: 3 },
  { id: 3, clientId: 3, name: "Winter Push", lemlistCampaignId: "cam_3", personaId: null, isActive: false, replyCount: 0 },
];

let mockSettings: Record<string, unknown> | undefined = {
  client: { id: 3, name: "Up2Clean", company: null, plan: "starter" },
  lemlist: { hasApiKey: true, keyHint: "••••9999", usingGlobalFallback: false },
  webhook: { url: "https://draftfly.app/api/webhooks/lemlist/3?secret=x", hasSecret: true, headerName: "X-Webhook-Secret" },
  slack: { channel: null },
  usage: { activeCampaigns: 2, activeCampaignLimit: 2, totalCampaigns: 3, repliesThisMonth: 15, replyLimit: 100 },
};

let mockLemlistOptions: { id: string; name: string; mapped: boolean }[] = [];

vi.mock("@workspace/api-client-react", () => ({
  useListCampaigns: () => ({ data: mockCampaigns, isLoading: false }),
  useListClients: () => ({ data: [{ id: 3, name: "Up2Clean" }] }),
  useListPersonas: () => ({ data: [] }),
  useCreateCampaign: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCampaign: () => ({ mutate: mockUpdateMutate, isPending: false }),
  getListCampaignsQueryKey: () => ["campaigns"],
  getListPersonasQueryKey: () => ["personas"],
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isOperator: false, clientId: 3, user: null, loading: false }),
}));

vi.mock("@/hooks/use-my-settings", () => ({
  useMySettings: () => ({ data: mockSettings }),
  useLemlistCampaignOptions: () => ({ data: mockLemlistOptions, isFetching: false, refetch: vi.fn() }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

import CampaignsPage from "./campaigns";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCampaigns = [
    { id: 1, clientId: 3, name: "Q3 Outbound", lemlistCampaignId: "cam_1", personaId: null, isActive: true, replyCount: 12 },
    { id: 2, clientId: 3, name: "Reactivation", lemlistCampaignId: "cam_2", personaId: null, isActive: true, replyCount: 3 },
    { id: 3, clientId: 3, name: "Winter Push", lemlistCampaignId: "cam_3", personaId: null, isActive: false, replyCount: 0 },
  ];
  mockLemlistOptions = [];
});

describe("activation toggles", () => {
  it("shows how many of the plan's slots are in use", async () => {
    renderPage();
    expect(await screen.findByText(/2 of 2 campaigns drafting/)).toBeInTheDocument();
  });

  it("blocks switching on a campaign once the slots are gone", async () => {
    renderPage();
    const off = await screen.findByTestId("toggle-campaign-3");
    expect(off).toBeDisabled();
    await userEvent.click(off);
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it("always allows switching one off, even at the cap", async () => {
    renderPage();
    const on = await screen.findByTestId("toggle-campaign-1");
    expect(on).not.toBeDisabled();

    await userEvent.click(on);
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 1, data: { isActive: false } },
      expect.anything(),
    );
  });

  it("lets a campaign be switched on once a slot is free", async () => {
    mockCampaigns[1].isActive = false;
    mockSettings = { ...mockSettings, usage: { ...(mockSettings as any).usage, activeCampaigns: 1 } };

    renderPage();
    const off = await screen.findByTestId("toggle-campaign-3");
    expect(off).not.toBeDisabled();

    await userEvent.click(off);
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 3, data: { isActive: true } },
      expect.anything(),
    );
  });
});

describe("Lemlist campaign discovery", () => {
  it("offers the client's real campaigns instead of a bare ID field", async () => {
    mockLemlistOptions = [
      { id: "cam_9", name: "Spring Outbound", mapped: false },
      { id: "cam_1", name: "Q3 Outbound", mapped: true },
    ];
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /New Campaign/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pick one of your Lemlist campaigns/)).toBeInTheDocument();
    });
    // The already-mapped one must not be offered a second time.
    expect(screen.queryByText("Q3 Outbound", { selector: "span" })).not.toBeInTheDocument();
  });

  it("falls back to the manual field and points at Settings when no key is saved", async () => {
    mockLemlistOptions = [];
    mockSettings = {
      ...(mockSettings as any),
      lemlist: { hasApiKey: false, keyHint: null, usingGlobalFallback: false },
    };
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /New Campaign/i }));

    await waitFor(() => {
      expect(screen.getByText(/Save your Lemlist API key in/)).toBeInTheDocument();
    });
  });
});
