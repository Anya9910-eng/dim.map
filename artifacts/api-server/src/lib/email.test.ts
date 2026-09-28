import { describe, it, expect, vi, afterEach } from "vitest";
import { inviteHtml, loginCodeHtml, sendInviteEmail, welcomeHtml } from "./email";

describe("invite email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("names the client, the address to sign in with and links the dashboard", () => {
    const html = inviteHtml("Skyline Towers", "agent@skyline.ae");
    expect(html).toContain("invited to DIM Convert");
    expect(html).toContain("Skyline Towers");
    expect(html).toContain("agent@skyline.ae");
    expect(html).toContain("https://convert.dim.capital/app");
  });

  it("escapes the client name", () => {
    const html = inviteHtml("<b>x</b>", "a@b.co");
    expect(html).not.toContain("<b>x</b>");
  });

  it("sends through Resend to the invited address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInviteEmail("agent@skyline.ae", "Skyline Towers");

    expect(result.delivered).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["agent@skyline.ae"]);
    expect(body.subject).toBe("You've been invited to Skyline Towers on DIM Convert");
    expect(body.reply_to).toBe("outreach@dim.capital");
  });

  it("reports not delivered when no provider is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendInviteEmail("agent@skyline.ae", "Skyline Towers");
    expect(result.delivered).toBe(false);
  });
});

describe("email templates", () => {
  it("puts the code in the sign-in email and brands it", () => {
    const html = loginCodeHtml("428913");
    expect(html).toContain("428913");
    expect(html).toContain("DIM Convert");
    expect(html).toContain("logo-mark.png");
    expect(html).toContain("Your sign-in code");
  });

  it("greets the person and links the dashboard in the welcome email", () => {
    const html = welcomeHtml("Jane Doe");
    expect(html).toContain("Welcome to DIM Convert, Jane Doe");
    expect(html).toContain("https://convert.dim.capital/app");
    expect(html).toContain("Connect your lead sources");
  });

  it("escapes HTML in a person's name so a name can't inject markup", () => {
    const html = welcomeHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
