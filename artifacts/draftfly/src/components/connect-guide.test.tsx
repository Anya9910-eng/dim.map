/**
 * The "How to connect" guide opens on click and offers the exact values to
 * paste — including the secret pulled out of the URL for Google's Key field.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectGuide } from "./connect-guide";

const URL = "https://convert.dim.capital/api/webhooks/google/7?secret=abc123";

describe("ConnectGuide", () => {
  it("is closed until clicked, then shows the steps", async () => {
    render(<ConnectGuide source="google" url={URL} />);
    expect(screen.queryByTestId("guide-google")).toBeNull();

    await userEvent.click(screen.getByTestId("guide-toggle-google"));
    const guide = screen.getByTestId("guide-google");
    expect(guide.textContent).toContain("Webhook integration");
    expect(guide.textContent).toContain("Send test data");
  });

  it("copies the secret on its own for the Key field", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ConnectGuide source="google" url={URL} defaultOpen />);
    const secretChip = screen.getByTitle("abc123").parentElement!;
    await userEvent.click(secretChip.querySelector("button")!);
    expect(writeText).toHaveBeenCalledWith("abc123");
  });

  it("points Meta leads through Zapier or Make", () => {
    render(<ConnectGuide source="meta" url={URL.replace("google", "meta")} defaultOpen />);
    expect(screen.getByTestId("guide-meta").textContent).toContain("Webhooks by Zapier");
  });
});
