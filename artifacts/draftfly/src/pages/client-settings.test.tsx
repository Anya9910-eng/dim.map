/**
 * The client's own Settings page — the screen that makes a dashboard
 * self-serviceable instead of something the operator has to configure for them.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUpdate = vi.fn();
const mockTest = vi.fn();
const mockRegenerate = vi.fn();

let mockData: Record<string, any> | undefined;

vi.mock("@/hooks/use-my-settings", () => ({
  useMySettings: () => ({ data: mockData, isLoading: false, error: null }),
  useUpdateMySettings: () => ({ mutate: mockUpdate, isPending: false }),
  useTestLemlist: () => ({ mutate: mockTest, isPending: false }),
  useRegenerateWebhook: () => ({ mutate: mockRegenerate, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// Billing has its own tests; here it only needs to stay out of the way.
vi.mock("@/components/billing-card", () => ({ BillingCard: () => null }));

import ClientSettingsPage from "./client-settings";

beforeEach(() => {
  vi.clearAllMocks();
  mockData = {
    client: { id: 3, name: "Up2Clean", company: null, plan: "starter" },
    lemlist: { hasApiKey: true, keyHint: "••••9999", usingGlobalFallback: false },
    webhook: { url: "https://convert.dim.capital/api/webhooks/lemlist/3?secret=abc", hasSecret: true, headerName: "X-Webhook-Secret" },
    slack: { channel: null },
    usage: { activeCampaigns: 2, activeCampaignLimit: 2, totalCampaigns: 3, repliesThisMonth: 15, replyLimit: 100 },
  };
});

describe("client settings", () => {
  it("shows only a hint of the saved key, never the key", () => {
    render(<ClientSettingsPage />);
    expect(screen.getByText(/••••9999/)).toBeInTheDocument();
    expect(screen.getByTestId("lemlist-key")).toHaveValue("");
  });

  it("saves a pasted key", async () => {
    render(<ClientSettingsPage />);
    await userEvent.type(screen.getByTestId("lemlist-key"), "key_live_1234");
    await userEvent.click(screen.getByTestId("save-lemlist-key"));

    expect(mockUpdate).toHaveBeenCalledWith(
      { lemlistApiKey: "key_live_1234" },
      expect.anything(),
    );
  });

  it("gives the client the webhook URL to paste into Lemlist", () => {
    render(<ClientSettingsPage />);
    expect(screen.getByTestId("webhook-url")).toHaveValue(
      "https://convert.dim.capital/api/webhooks/lemlist/3?secret=abc",
    );
  });

  it("reports plan usage, and explains that switched-off campaigns are free", () => {
    render(<ClientSettingsPage />);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("15 / 100")).toBeInTheDocument();
    expect(screen.getByText(/1 mapped campaign is switched off/)).toBeInTheDocument();
  });

  it("has no Slack settings", () => {
    render(<ClientSettingsPage />);
    expect(screen.queryByText(/slack/i)).not.toBeInTheDocument();
  });

  it("saves the WhatsApp phone number ID and token", async () => {
    render(<ClientSettingsPage />);

    await userEvent.type(screen.getByTestId("whatsapp-phone-id"), "1098765");
    await userEvent.type(screen.getByTestId("whatsapp-token"), "EAAG-token");
    await userEvent.click(screen.getByTestId("save-whatsapp"));

    expect(mockUpdate).toHaveBeenCalledWith(
      { whatsappPhoneNumberId: "1098765", whatsappAccessToken: "EAAG-token" },
      expect.anything(),
    );
  });
});
