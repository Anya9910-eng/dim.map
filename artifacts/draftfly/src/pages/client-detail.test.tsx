/**
 * Edit Client form — channel ID guard tests
 *
 * Verifies that the settings form on the client detail page blocks placeholder
 * Slack channel values before ever calling the API, and that a valid channel ID
 * proceeds to call updateClient.mutate with the correct payload.
 *
 * The component renders the error message with the CSS class "text-destructive"
 * only after a failed submit attempt. We distinguish it from the hint text by
 * checking that class directly.
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
  slackChannel: "#old-channel",
  slackBotToken: "",
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the channel error <p> element with the text-destructive class,
 *  indicating the field is in its error state (not just showing a hint). */
function queryChannelError() {
  return (
    screen
      .queryAllByText(/must be a slack channel id starting with c or g/i)
      .find((el) => el.classList.contains("text-destructive")) ?? null
  );
}

async function setChannelValue(
  user: ReturnType<typeof userEvent.setup>,
  value: string
) {
  const input = screen.getByPlaceholderText("C0BK6NPBHKJ");
  await user.clear(input);
  if (value) {
    await user.type(input, value);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Edit Client form — Slack channel ID guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the inline error (text-destructive) and does NOT call the API when a placeholder name like #old-channel is submitted", async () => {
    const user = userEvent.setup();
    render(<ClientDetail />);

    // The form pre-populates with the mock client's #old-channel value.
    // Submit without changing the channel to confirm the guard fires.
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows the inline error and does NOT call the API when a plain channel name (no hash) is submitted", async () => {
    const user = userEvent.setup();
    render(<ClientDetail />);

    await setChannelValue(user, "general");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("calls updateClient.mutate with the correct payload when a valid C… channel ID is submitted", async () => {
    const user = userEvent.setup();
    render(<ClientDetail />);

    await setChannelValue(user, "C012AB3CD45");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ slackChannel: "C012AB3CD45" }),
      }),
      expect.any(Object)
    );

    expect(queryChannelError()).toBeNull();
  });

  it("clears the inline error once the user corrects a bad value and resubmits with a valid ID", async () => {
    const user = userEvent.setup();
    render(<ClientDetail />);

    // First submit with the pre-filled placeholder value to trigger the error
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(queryChannelError()).not.toBeNull();
    });

    // Now fix it with a real channel ID and resubmit
    await setChannelValue(user, "C0BK6NPBHKJ");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    expect(queryChannelError()).toBeNull();
  });
});
