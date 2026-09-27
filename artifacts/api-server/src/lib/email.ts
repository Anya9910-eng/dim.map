import { logger } from "./logger";

/**
 * Outbound email, used only by the sign-in flow.
 *
 * Deliberately a single function over `fetch` rather than a mail library: the
 * one message this product sends is a six-digit code, and a dependency that
 * needs SMTP credentials, connection pooling and TLS negotiation buys nothing
 * for that.
 *
 * When no provider is configured the send is *not* treated as an error — see
 * `sendLoginCodeEmail`. That is what keeps the deployment usable before the
 * Resend key exists, and what stops a mail outage from locking the operator out
 * of their own dashboard.
 */

export interface SendResult {
  /** True when a provider accepted the message for delivery. */
  delivered: boolean;
  /** Why it was not delivered — provider error, or "not configured". */
  reason?: string;
}

export function isEmailConfigured(): boolean {
  return !!process.env["RESEND_API_KEY"];
}

function fromAddress(): string {
  // Must be an address on a domain verified with the provider, or Resend
  // rejects the send. Falls back to Resend's shared sandbox sender, which
  // delivers only to the account owner's own address — enough to test with
  // before the sending domain's DNS records exist.
  return process.env["EMAIL_FROM"] ?? "DIM map <onboarding@resend.dev>";
}

async function send(to: string, subject: string, text: string, html?: string): Promise<SendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return { delivered: false, reason: "not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // `text` always rides along with `html`: it is the fallback for plain-text
      // clients and, in practice, a small nudge to spam filters that a message
      // carrying both is a real one.
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, text, ...(html ? { html } : {}) }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { delivered: false, reason: `provider ${res.status}: ${body.slice(0, 200)}` };
    }
    return { delivered: true };
  } catch (err) {
    return { delivered: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Branded HTML templates ──────────────────────────────────────────────────
//
// Email HTML is its own dialect: no external CSS, no flexbox, tables for
// layout, styles inlined, and everything degrading to the plain-text version
// its `send` call always carries. The palette is DIM map's forest green (#1F4A3A)
// with a salad-green accent (#A9C97D), on a
// light card so it reads the same in every client's light and dark chrome. The
// logo is the hosted mark — inlining an image would bloat every message.

const BRAND = "#1F4A3A";
const LIME = "#A9C97D";
const APP_URL = "https://draftfly.app";
const SUPPORT_EMAIL = "outreach@draftfly.app";

/** Escapes text interpolated into HTML — names come from the sign-up form. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Wraps message content in the shared shell: logo header, card, footer. */
function layout(inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:28px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><img src="${APP_URL}/logo-mark.png" width="28" height="28" alt="DIM map" style="display:block;border:0;"></td>
            <td style="vertical-align:middle;padding-left:10px;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.01em;">DIM <span style="color:#1F4A3A;">map</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 32px 32px;color:#111827;font-size:15px;line-height:1.6;">
          ${inner}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding:16px 32px;text-align:center;color:#9ca3af;font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          DIM map — AI lead qualification and replies for property developers.<br>
          <a href="${APP_URL}" style="color:#9ca3af;">draftfly.app</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function loginCodeHtml(code: string): string {
  return layout(
    `<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">Your sign-in code</h1>
     <p style="margin:0 0 20px;color:#4b5563;">Enter this code to sign in to DIM map.</p>
     <div style="margin:0 0 20px;padding:18px;text-align:center;background:#EEF4E6;border:1px solid #d6e5c2;border-radius:12px;">
       <span style="font-family:'SFMono-Regular',ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${BRAND};">${esc(code)}</span>
     </div>
     <p style="margin:0 0 6px;color:#4b5563;">It expires in 10 minutes and can be used once.</p>
     <p style="margin:0;color:#9ca3af;font-size:13px;">If you didn't try to sign in, you can ignore this email — without the code, nothing happens.</p>`,
  );
}

export function welcomeHtml(name: string): string {
  const step = (n: number, title: string, body: string) =>
    `<tr>
       <td style="vertical-align:top;width:30px;padding:6px 0;">
         <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;background:${BRAND};color:#ffffff;border-radius:12px;font-size:13px;font-weight:700;border:2px solid ${LIME};">${n}</span>
       </td>
       <td style="vertical-align:top;padding:6px 0 6px 12px;color:#111827;">
         <strong>${title}</strong><br><span style="color:#4b5563;">${body}</span>
       </td>
     </tr>`;
  return layout(
    `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Welcome to DIM map, ${esc(name)}</h1>
     <p style="margin:0 0 8px;color:#4b5563;">Your 3-day free trial is live — no card needed. Here's how to get your first lead qualified and answered in a few minutes:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 8px;">
       ${step(1, "Connect Lemlist, Meta or WhatsApp", "Link your cold-email account, your Meta lead forms or your WhatsApp Business number so every new lead flows into DIM map.")}
       ${step(2, "Add a sales persona", "Tell the AI about your project — units, price range, payment plans, tone — so every reply sounds like your best agent.")}
       ${step(3, "Turn a campaign on", "The next lead is qualified hot, warm or cold, with a reply drafted for your one-click approval.")}
     </table>
     <div style="margin:24px 0 8px;">
       <a href="${APP_URL}/app" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Open your dashboard</a>
     </div>
     <p style="margin:20px 0 0;color:#9ca3af;font-size:13px;">Questions, or want a hand setting up? Just reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};">${SUPPORT_EMAIL}</a>.</p>`,
  );
}

/**
 * Emails a sign-in code, and guarantees the code reaches *somewhere* it can be
 * read.
 *
 * If the provider is unset or the send fails, the code is written to the server
 * log at warn level. That is intentional, and it is the break-glass: reading it
 * requires shell access to the host, which is already total compromise, so it
 * grants an attacker nothing they did not have — while meaning a billing lapse
 * at the mail provider cannot lock the operator out of their own product.
 *
 * On the happy path the code is never logged.
 */
export async function sendLoginCodeEmail(email: string, code: string): Promise<SendResult> {
  const result = await send(
    email,
    `${code} is your DIM map sign-in code`,
    [
      `Your DIM map sign-in code is ${code}`,
      "",
      "It expires in 10 minutes and can be used once.",
      "If you did not try to sign in, you can ignore this email — without the code nothing happens.",
    ].join("\n"),
    loginCodeHtml(code),
  );

  if (!result.delivered) {
    // The code is a bearer credential: anyone who can read these logs could
    // sign in as this person. Printing it was a deliberate break-glass while
    // email delivery was still being set up — outside development that trade is
    // no longer worth making, so production records the failure and not the
    // secret. A failed send there is a real outage and should look like one.
    if (process.env["NODE_ENV"] === "production") {
      logger.error(
        { email, reason: result.reason },
        "Sign-in code could not be emailed — this person cannot sign in. Check RESEND_API_KEY and the sending domain.",
      );
    } else {
      logger.warn(
        { email, code, reason: result.reason },
        "Sign-in code could not be emailed — code logged here so sign-in still works in development.",
      );
    }
  }

  return result;
}

/**
 * Welcomes a brand-new self-serve account and points it at the first three
 * setup steps. Best-effort: it rides the same provider as everything else and,
 * like the early-access notice, has no log fallback — a welcome that does not
 * arrive is a missed nicety, never a locked-out user, so the caller only logs
 * the outcome and never blocks signup on it.
 */
export async function sendWelcomeEmail(email: string, name: string): Promise<SendResult> {
  return send(
    email,
    "Welcome to DIM map — let's qualify your first lead",
    [
      `Welcome to DIM map, ${name}.`,
      "",
      "Your 3-day free trial is live — no card needed. Three steps to your first qualified lead:",
      "",
      "1. Connect Lemlist, Meta lead ads or WhatsApp so new leads flow in.",
      "2. Add a sales persona — your project, pricing rules and tone.",
      "3. Turn a campaign on. The next lead is qualified and gets a reply drafted for your one-click approval.",
      "",
      `Open your dashboard: ${APP_URL}/app`,
      "",
      `Questions, or want a hand? Reach us at ${SUPPORT_EMAIL}.`,
    ].join("\n"),
    welcomeHtml(name),
  );
}

/**
 * Tells the operators someone asked for access from the landing page.
 *
 * Unlike the sign-in code there is no log fallback here: the caller has
 * already stored the request in the database, and it decides what to log.
 * This only reports whether the mail went out.
 */
export async function sendEarlyAccessNotification(
  to: string[],
  name: string,
  email: string,
): Promise<SendResult> {
  const subject = `DIM map early access request: ${name}`;
  const text = [
    `${name} <${email}> requested early access from the DIM map website.`,
    "",
    `Reply to them directly: ${email}`,
    "",
    "Every request is also in the early_access_requests table.",
  ].join("\n");

  const results = await Promise.all(to.map((address) => send(address, subject, text)));
  const failed = results.filter((r) => !r.delivered);
  if (failed.length === results.length) {
    return { delivered: false, reason: failed[0]?.reason ?? "unknown" };
  }
  return { delivered: true };
}
