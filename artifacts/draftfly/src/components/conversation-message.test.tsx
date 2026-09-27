import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConversationMessage, splitQuotedText } from "./conversation-message";

describe("splitQuotedText", () => {
  it("leaves a message with no quoted thread alone", () => {
    const { head, quoted } = splitQuotedText("Please provide more details\n\nBest,\nOlha");
    expect(head).toBe("Please provide more details\n\nBest,\nOlha");
    expect(quoted).toBe("");
  });

  it("absorbs a localised attribution line into the quote", () => {
    // Real text from a production draft — Ukrainian, so no English "wrote:".
    const text = [
      "Please provide more details",
      "",
      "Best,",
      "Olha",
      "",
      "сб, 15 серп. 2026 р. о 20:45 Olha Vakuliuk <olha@saps.digital> пише:",
      "",
      "> Please provide more details",
      "> Best,",
    ].join("\n");
    const { head, quoted } = splitQuotedText(text);
    expect(head).toBe("Please provide more details\n\nBest,\nOlha");
    expect(quoted.startsWith("сб, 15 серп.")).toBe(true);
    expect(quoted).toContain("> Please provide more details");
  });

  it("handles the English attribution the same way", () => {
    const { head, quoted } = splitQuotedText(
      "Sure thing.\n\nOn Mon, Aug 17 2026 at 09:12 Jash Lim <jashl@up2clean.co> wrote:\n> Hi Olha",
    );
    expect(head).toBe("Sure thing.");
    expect(quoted).toContain("On Mon, Aug 17 2026");
  });

  it("keeps a quote-only message whole rather than showing an empty body", () => {
    const text = "> Hi Olha\n> Are you around?";
    const { head, quoted } = splitQuotedText(text);
    expect(head).toBe(text);
    expect(quoted).toBe("");
  });

  it("does not treat a mid-sentence angle bracket as a quote", () => {
    const { quoted } = splitQuotedText("Revenue grew\nby 4% > our target\nthis quarter");
    expect(quoted).toBe("");
  });
});

describe("<ConversationMessage />", () => {
  const threaded = [
    "Please provide more details",
    "",
    "Best,",
    "Olha",
    "",
    "сб, 15 серп. 2026 р. о 20:45 Olha Vakuliuk <olha@saps.digital> пише:",
    "",
    "> Hi Olha, hope you're doing well,",
    "> Most property managers tell us the same thing.",
  ].join("\n");

  it("shows the new message and hides the thread until asked", () => {
    render(<ConversationMessage text={threaded} />);
    expect(screen.getByText(/Please provide more details/)).toBeInTheDocument();
    expect(screen.queryByText(/Most property managers/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show earlier messages/ }));
    expect(screen.getByText(/Most property managers/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide earlier messages/ }));
    expect(screen.queryByText(/Most property managers/)).not.toBeInTheDocument();
  });

  it("offers no toggle on a short unquoted message", () => {
    render(<ConversationMessage text="Please provide more details" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("truncates a long unquoted message by line count", () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    render(<ConversationMessage text={long} />);
    expect(screen.getByRole("button", { name: /Show 12 more lines/ })).toBeInTheDocument();
    expect(screen.queryByText(/line 20/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/line 20/)).toBeInTheDocument();
  });
});
