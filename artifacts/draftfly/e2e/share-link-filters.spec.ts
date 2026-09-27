/**
 * E2E: Share link opens with the right filters pre-applied
 *
 * Run: BASE_URL=http://localhost:80 npx playwright test e2e/share-link-filters.spec.ts
 *
 * Prerequisites:
 *   - API server running with ENABLE_DEV_LOGIN=true (development only)
 *   - DraftFly web app running at /app
 *
 * Authentication: GET /api/auth/dev-login?next=<relative-path> sets a test
 * operator session and redirects. Requires ENABLE_DEV_LOGIN=true in env.
 * Both dev-login routes are blocked in production (NODE_ENV=production → 404).
 */

import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";

const BASE = process.env["BASE_URL"] ?? "http://localhost:80";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function devLogin(
  browser: Browser,
  next: string,
  opts: { clipboard?: boolean } = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  if (opts.clipboard) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const page = await context.newPage();
  await page.goto(`${BASE}/api/auth/dev-login?next=${encodeURIComponent(next)}`, {
    waitUntil: "networkidle",
  });
  return { context, page };
}

async function waitForReplyHistory(page: Page): Promise<void> {
  await page.waitForSelector('h1:has-text("Reply History")', { timeout: 12_000 });
  await page.waitForTimeout(2_000);
}

async function getTriggerTexts(page: Page): Promise<string[]> {
  const triggers = page.locator('button[role="combobox"]');
  const count = await triggers.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    texts.push(((await triggers.nth(i).textContent()) ?? "").trim());
  }
  return texts;
}

async function getStatusTriggerText(page: Page): Promise<string | null> {
  const texts = await getTriggerTexts(page);
  return (
    texts.find(t =>
      /all statuses|^sent$|^discarded$|^pending$|^edited$|send failed/i.test(t)
    ) ?? null
  );
}

async function fetchClientName(page: Page, clientId: number): Promise<string | null> {
  const response = await page.request.get(`${BASE}/api/clients`);
  if (!response.ok()) return null;
  const clients = (await response.json()) as Array<{ id: number; name: string }>;
  return clients.find(c => c.id === clientId)?.name ?? null;
}

async function getVisibleRowNames(page: Page): Promise<string[]> {
  const cells = page.locator("tbody td .font-medium");
  const count = await cells.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = ((await cells.nth(i).textContent()) ?? "").trim();
    if (text) names.push(text);
  }
  return names;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Reply History share link", () => {
  test("navigating to ?status=sent&clientId=1 pre-selects Status=Sent and the exact name of client 1", async ({
    browser,
  }) => {
    const { context, page } = await devLogin(browser, "/app/reply-history?status=sent&clientId=1");
    await waitForReplyHistory(page);

    const url = page.url();
    expect(url).toContain("status=sent");
    expect(url).toContain("clientId=1");

    const expectedClientName = await fetchClientName(page, 1);
    expect(expectedClientName, "Client with id=1 must exist in the database").not.toBeNull();

    const texts = await getTriggerTexts(page);

    expect(
      texts.some(t => /^sent$/i.test(t)),
      `Status trigger should show "Sent"; got: ${JSON.stringify(texts)}`
    ).toBe(true);

    expect(
      texts.some(t => t === expectedClientName),
      `Client trigger should show "${expectedClientName}"; got: ${JSON.stringify(texts)}`
    ).toBe(true);

    await context.close();
  });

  test("navigating without params shows all three dropdowns at their default 'all' value", async ({
    browser,
  }) => {
    const { context, page } = await devLogin(browser, "/app/reply-history");
    await waitForReplyHistory(page);

    const texts = await getTriggerTexts(page);
    expect(texts.some(t => /all statuses/i.test(t))).toBe(true);
    expect(texts.some(t => /all clients/i.test(t))).toBe(true);
    expect(texts.some(t => /all campaigns/i.test(t))).toBe(true);

    await context.close();
  });

  test("Copy link encodes active filters; opening that exact URL in a new context shows the same rows", async ({
    browser,
  }) => {
    // ── Step 1: apply Discarded filter and collect visible rows ──────────────
    const { context: ctx1, page: page1 } = await devLogin(browser, "/app/reply-history", {
      clipboard: true,
    });
    await waitForReplyHistory(page1);

    // Open Status dropdown and pick "Discarded"
    const triggers = page1.locator('button[role="combobox"]');
    const count = await triggers.count();
    let statusIdx = -1;
    for (let i = 0; i < count; i++) {
      if (/all statuses/i.test(((await triggers.nth(i).textContent()) ?? "").trim())) {
        statusIdx = i;
        break;
      }
    }
    expect(statusIdx, "Status dropdown must be present").toBeGreaterThanOrEqual(0);
    await triggers.nth(statusIdx).click();
    await page1.waitForTimeout(400);
    await page1.locator('[role="option"]:has-text("Discarded")').first().click();
    await page1.waitForTimeout(1_500);

    expect(await getStatusTriggerText(page1)).toMatch(/^discarded$/i);

    const rowsBeforeCopy = await getVisibleRowNames(page1);

    // ── Step 2: click Copy link and capture the clipboard URL ────────────────
    const copyBtn = page1.locator('button:has-text("Copy link")');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await page1.waitForTimeout(600);

    // Confirm button shows "Copied!" feedback
    const copiedVisible = await page1.locator('button:has-text("Copied!")').count();
    const greenCheck = await page1.locator('.text-green-600').count();
    expect(
      copiedVisible + greenCheck,
      "Copy link button must show Copied! feedback"
    ).toBeGreaterThan(0);

    // Read the clipboard — this is the URL a recipient would receive
    const clipboardUrl = await page1.evaluate(() => navigator.clipboard.readText());
    expect(clipboardUrl).toContain("status=discarded");

    await ctx1.close();

    // ── Step 3: open the clipboard URL in a fresh browser context ───────────
    // Strip the origin so devLogin can use the path+query
    const urlObj = new URL(clipboardUrl);
    const pathWithQuery = urlObj.pathname + urlObj.search;

    const { context: ctx2, page: page2 } = await devLogin(browser, pathWithQuery);
    await waitForReplyHistory(page2);

    // Filter must be pre-applied
    expect(await getStatusTriggerText(page2)).toMatch(/^discarded$/i);

    // Row count must match (same filter → same data)
    const rowsAfterReopen = await getVisibleRowNames(page2);
    expect(rowsAfterReopen.length, "Row count must equal the original").toBe(rowsBeforeCopy.length);

    // First row name must match (same ordering)
    if (rowsBeforeCopy.length > 0) {
      expect(rowsAfterReopen[0]).toBe(rowsBeforeCopy[0]);
    }

    await ctx2.close();
  });

  test("opening ?status=discarded directly pre-selects the Discarded status filter", async ({
    browser,
  }) => {
    const { context, page } = await devLogin(browser, "/app/reply-history?status=discarded");
    await waitForReplyHistory(page);

    const texts = await getTriggerTexts(page);
    expect(
      texts.some(t => /^discarded$/i.test(t)),
      `Status should be pre-selected as "Discarded"; got: ${JSON.stringify(texts)}`
    ).toBe(true);

    await context.close();
  });
});
