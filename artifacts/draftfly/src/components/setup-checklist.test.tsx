/**
 * The checklist judges each step from server state and disappears when all
 * four are done.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  settings: null as unknown,
  personas: [] as unknown[],
}));
vi.mock("@/hooks/use-my-settings", () => ({ useMySettings: () => ({ data: state.settings }) }));
vi.mock("@workspace/api-client-react", () => ({ useListPersonas: () => ({ data: state.personas }) }));

import { SetupChecklist } from "./setup-checklist";

const settings = (over: { hasApiKey?: boolean; activeCampaigns?: number; repliesThisMonth?: number } = {}) => ({
  client: { id: 1, name: "Acme", company: "Acme", plan: "starter" },
  lemlist: { hasApiKey: over.hasApiKey ?? false, keyHint: null, usingGlobalFallback: false },
  webhook: { url: "https://x/api/webhooks/lemlist/1", hasSecret: true, headerName: "X-Webhook-Secret" },
  slack: { channel: null },
  usage: { activeCampaigns: over.activeCampaigns ?? 0, activeCampaignLimit: 2, totalCampaigns: 0, repliesThisMonth: over.repliesThisMonth ?? 0, replyLimit: 100 },
});

beforeEach(() => {
  state.settings = null;
  state.personas = [];
});

describe("SetupChecklist", () => {
  it("shows all four steps undone for a fresh account, naming the first as next", () => {
    state.settings = settings();
    render(<SetupChecklist />);
    expect(screen.getByTestId("setup-checklist")).toHaveTextContent("0 of 4 done");
    expect(screen.getByTestId("setup-checklist")).toHaveTextContent("next: connect your lemlist account");
    for (const k of ["lemlist", "persona", "campaign", "reply"]) {
      expect(screen.getByTestId(`setup-step-${k}`)).toHaveAttribute("data-done", "false");
    }
  });

  it("marks steps done from what exists, not from anything the user ticked", () => {
    state.settings = settings({ hasApiKey: true, activeCampaigns: 1 });
    state.personas = [{ id: 1 }];
    render(<SetupChecklist />);
    expect(screen.getByTestId("setup-checklist")).toHaveTextContent("3 of 4 done");
    expect(screen.getByTestId("setup-step-lemlist")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("setup-step-persona")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("setup-step-campaign")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("setup-step-reply")).toHaveAttribute("data-done", "false");
  });

  it("links each step to where it gets done", () => {
    state.settings = settings();
    render(<SetupChecklist />);
    expect(screen.getByTestId("setup-step-lemlist")).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("setup-step-persona")).toHaveAttribute("href", "/personas");
    expect(screen.getByTestId("setup-step-campaign")).toHaveAttribute("href", "/campaigns");
  });

  it("disappears once everything is done", () => {
    state.settings = settings({ hasApiKey: true, activeCampaigns: 1, repliesThisMonth: 4 });
    state.personas = [{ id: 1 }];
    const { container } = render(<SetupChecklist />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before settings have loaded", () => {
    const { container } = render(<SetupChecklist />);
    expect(container).toBeEmptyDOMElement();
  });
});
