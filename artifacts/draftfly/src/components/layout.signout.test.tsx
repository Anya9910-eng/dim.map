import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./layout";

const user = { id: "tim@up2clean.co", name: "Tim", email: "tim@up2clean.co", role: "client", clientId: 3 };

function renderLayout(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <AppLayout><div>content</div></AppLayout>
    </QueryClientProvider>,
  );
}

describe("sign out", () => {
  let qc: QueryClient;
  let assigned: string | undefined;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    assigned = undefined;
    // jsdom refuses a real navigation; capture the target instead.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { get href() { return "/app/"; }, set href(v: string) { assigned = v; } },
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/me")) {
        return new Response(JSON.stringify(user), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts to the logout endpoint, clears cached data and leaves the app", async () => {
    renderLayout(qc);
    await screen.findByText("tim@up2clean.co");

    qc.setQueryData(["drafts"], [{ id: 1, prospectName: "Olha" }]);

    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      const calls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
      expect(calls.some((u: string) => u.endsWith("/api/auth/logout"))).toBe(true);
    });

    const logoutCall = (fetch as any).mock.calls.find((c: any[]) => String(c[0]).endsWith("/api/auth/logout"));
    expect(logoutCall[1]).toMatchObject({ method: "POST", credentials: "include" });

    // The next person on this browser must not see the last one's drafts.
    await waitFor(() => expect(qc.getQueryData(["drafts"])).toBeUndefined());
    expect(assigned).toBe("/");
  });

  it("still leaves the app when the logout request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/me")) {
        return new Response(JSON.stringify(user), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("network down");
    }));

    renderLayout(qc);
    await screen.findByText("tim@up2clean.co");
    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(assigned).toBe("/"));
  });
});
