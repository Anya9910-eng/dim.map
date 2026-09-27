/**
 * Self-serve billing UI: the paywall, the trial banner, and the plan picker.
 *
 * The hooks are mocked at their module boundary; what is under test is what
 * each state renders and where a click sends the browser.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  billing: null as unknown,
  isOperator: false,
  checkout: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { email: "tim@up2clean.co", role: state.isOperator ? "operator" : "client" }, isOperator: state.isOperator, loading: false, clientId: 12 }),
}));
vi.mock("@/hooks/use-billing", async (importActual) => {
  const actual = await importActual<typeof import("@/hooks/use-billing")>();
  return {
    ...actual,
    useBilling: () => ({ data: state.billing, isLoading: false }),
    useStartCheckout: () => ({ mutate: state.checkout, isPending: false, isError: false, error: null, variables: undefined }),
  };
});

import { BillingGuard } from "./billing-guard";
import { TrialBanner } from "./trial-banner";
import { PlanPicker } from "./plan-picker";

const plans = [
  { key: "starter", limits: { activeCampaigns: 2, repliesPerMonth: 100 }, available: true },
  { key: "growth", limits: { activeCampaigns: 10, repliesPerMonth: 500 }, available: true },
];
const base = { plan: "starter", limits: plans[0].limits, plans, canManage: false };

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  state.billing = null;
  state.isOperator = false;
  state.checkout.mockReset();
});

describe("BillingGuard", () => {
  it("renders the app for an operator without consulting billing", () => {
    state.isOperator = true;
    wrap(<BillingGuard><div>the app</div></BillingGuard>);
    expect(screen.getByText("the app")).toBeInTheDocument();
  });

  it("renders the app during a trial", () => {
    state.billing = { ...base, state: { kind: "trial", endsAt: "2026-09-15T00:00:00Z", daysLeft: 2 } };
    wrap(<BillingGuard><div>the app</div></BillingGuard>);
    expect(screen.getByText("the app")).toBeInTheDocument();
    expect(screen.queryByTestId("paywall")).toBeNull();
  });

  it("replaces the app with the paywall once the trial has ended", () => {
    state.billing = { ...base, state: { kind: "locked", reason: "trial_ended" } };
    wrap(<BillingGuard><div>the app</div></BillingGuard>);
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByTestId("paywall")).toBeInTheDocument();
    expect(screen.getByText("Your free trial has ended")).toBeInTheDocument();
    expect(screen.getByTestId("choose-starter")).toBeInTheDocument();
    expect(screen.getByTestId("choose-growth")).toBeInTheDocument();
  });

  it("words a cancelled subscription differently from an ended trial", () => {
    state.billing = { ...base, state: { kind: "locked", reason: "subscription_ended" } };
    wrap(<BillingGuard><div>the app</div></BillingGuard>);
    expect(screen.getByText("Your subscription has ended")).toBeInTheDocument();
  });
});

describe("TrialBanner", () => {
  it("counts down the trial and links to billing", () => {
    state.billing = { ...base, state: { kind: "trial", endsAt: "x", daysLeft: 2 } };
    wrap(<TrialBanner />);
    expect(screen.getByTestId("trial-banner")).toHaveTextContent("2 days left in your free trial");
    expect(screen.getByRole("link", { name: "Choose a plan" })).toBeInTheDocument();
  });

  it("says 'today' on the last day", () => {
    state.billing = { ...base, state: { kind: "trial", endsAt: "x", daysLeft: 1 } };
    wrap(<TrialBanner />);
    expect(screen.getByTestId("trial-banner")).toHaveTextContent("ends today");
  });

  it("warns about a failed payment without locking anything", () => {
    state.billing = { ...base, state: { kind: "past_due", plan: "growth" } };
    wrap(<TrialBanner />);
    expect(screen.getByTestId("past-due-banner")).toHaveTextContent("payment didn't go through");
  });

  it.each([
    ["active", { kind: "active", plan: "starter" }],
    ["managed", { kind: "managed" }],
  ])("renders nothing for a %s client", (_label, s) => {
    state.billing = { ...base, state: s };
    const { container } = wrap(<TrialBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the response is not billing at all", () => {
    state.billing = { ok: true };
    const { container } = wrap(<TrialBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PlanPicker", () => {
  it("starts checkout for the chosen plan", async () => {
    state.billing = { ...base, state: { kind: "trial", endsAt: "x", daysLeft: 3 } };
    wrap(<PlanPicker />);
    await userEvent.click(screen.getByTestId("choose-growth"));
    await waitFor(() => expect(state.checkout).toHaveBeenCalledWith("growth"));
  });

  it("marks the active plan as current and disables its button", () => {
    state.billing = { ...base, plan: "growth", state: { kind: "active", plan: "growth" } };
    wrap(<PlanPicker />);
    expect(screen.getByTestId("choose-growth")).toBeDisabled();
    expect(screen.getByTestId("choose-growth")).toHaveTextContent("Current plan");
    expect(screen.getByTestId("choose-starter")).toBeEnabled();
  });

  it("explains itself when payments are not enabled, instead of dead buttons alone", () => {
    state.billing = { ...base, state: { kind: "trial", endsAt: "x", daysLeft: 3 }, plans: plans.map((p) => ({ ...p, available: false })) };
    wrap(<PlanPicker />);
    expect(screen.getByTestId("choose-starter")).toBeDisabled();
    expect(screen.getByTestId("payments-unavailable")).toHaveTextContent("outreach@draftfly.app");
  });
});
