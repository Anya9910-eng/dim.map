import { describe, it, expect } from "vitest";
import { loginCodeHtml, welcomeHtml } from "./email";

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
