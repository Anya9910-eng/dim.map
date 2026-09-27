/**
 * Create Client form — channel ID guard tests
 *
 * Verifies that the "Create Client" dialog blocks placeholder Slack channel
 * values before ever calling the API, and that a valid channel ID proceeds
 * to call createClient.mutate.
 *
 * The component shows the same text ("Must be a Slack channel ID…") as both a
 * hint (text-muted-foreground, no error) and as an inline error
 * (text-destructive, after a bad submit). We distinguish the two states by
 * checking the CSS class of the message element.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock workspace hooks ──────────────────────────────────────────────────────

const mockMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListClients: () => ({ data: [], isLoading: false }),
  useCreateClient: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  getListClientsQueryKey: () => ["clients"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ─── Component under test ──────────────────────────────────────────────────────

import ClientsPage from "./clients";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openDialog() {
  const user = userEvent.setup();
  render(<ClientsPage />);
  await user.click(screen.getByRole("button", { name: /new client/i }));
  return user;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, channel: string) {
  await user.type(screen.getByLabelText(/^name$/i), "Acme Corp");
  const channelInput = screen.getByPlaceholderText("C012AB3CD45");
  await user.clear(channelInput);
  await user.type(channelInput, channel);
}

/** Returns the channel hint/error <p> element with the text-destructive class,
 *  indicating the field is in its error state (not just showing a hint). */
function queryChannelError() {
  return screen
    .queryAllByText(/must be a slack channel id starting with c or g/i)
    .find((el) => el.classList.contains("text-destructive")) ?? null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Create Client form — Slack channel ID guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the inline error (text-destructive) and does NOT call the API when a placeholder name like #axiom-replies is submitted", async () => {
    const user = await openDialog();
    await fillRequiredFields(user, "#axiom-replies");

    await user.click(screen.getByRole("button", { name: /create client/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows the inline error and does NOT call the API when a plain channel name (no hash) is submitted", async () => {
    const user = await openDialog();
    await fillRequiredFields(user, "general");

    await user.click(screen.getByRole("button", { name: /create client/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("calls createClient.mutate with the correct payload when a valid C… channel ID is submitted", async () => {
    const user = await openDialog();
    await fillRequiredFields(user, "C012AB3CD45");

    await user.click(screen.getByRole("button", { name: /create client/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slackChannel: "C012AB3CD45" }),
      }),
      expect.any(Object),
    );

    expect(queryChannelError()).toBeNull();
  });

  it("clears the inline error once the user corrects a bad value and resubmits with a valid ID", async () => {
    const user = await openDialog();
    await fillRequiredFields(user, "#bad-channel");
    await user.click(screen.getByRole("button", { name: /create client/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    const channelInput = screen.getByPlaceholderText("C012AB3CD45");
    await user.clear(channelInput);
    await user.type(channelInput, "C0BK6NPBHKJ");

    await user.click(screen.getByRole("button", { name: /create client/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    expect(queryChannelError()).toBeNull();
  });
});
