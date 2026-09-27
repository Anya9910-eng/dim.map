/**
 * Create Client form: the client is created from name, company and mode
 * alone — there is no Slack channel to fill in any more.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListClients: () => ({
    data: [{ id: 1, name: "Palm Heights", company: "Palm Heights Developments", mode: "draft", plan: "growth", billingStatus: "managed", trialDaysLeft: null }],
    isLoading: false,
  }),
  useCreateClient: () => ({ mutate: mockMutate, isPending: false }),
  getListClientsQueryKey: () => ["clients"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import ClientsPage from "./clients";

describe("Clients page", () => {
  beforeEach(() => mockMutate.mockClear());

  it("creates a client from name, company and mode, with no Slack channel", async () => {
    const user = userEvent.setup();
    render(<ClientsPage />);
    await user.click(screen.getByRole("button", { name: /new client/i }));

    expect(screen.queryByText(/slack/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name$/i), "Marina Group");
    await user.type(screen.getByLabelText(/^company$/i), "Marina Group LLC");
    await user.click(screen.getByRole("button", { name: /create client/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { data: { name: "Marina Group", company: "Marina Group LLC", mode: "draft" } },
      expect.anything(),
    );
  });

  it("lists clients with their plan and no Slack channel", () => {
    render(<ClientsPage />);
    expect(screen.getByText("Palm Heights")).toBeInTheDocument();
    expect(screen.getByText(/growth plan/i)).toBeInTheDocument();
    expect(screen.queryByText(/no channel|slack/i)).not.toBeInTheDocument();
  });
});
