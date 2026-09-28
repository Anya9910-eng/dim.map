import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";

export type LeadSource = "lemlist" | "meta" | "google" | "youtube" | "whatsapp";

/** The per-client secret is the `secret` query parameter of every webhook URL. */
function secretOf(url: string): string {
  try {
    return new URL(url).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** A value to paste somewhere, with its own copy button. */
function Paste({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 align-middle">
      <code className="truncate font-mono text-[10px]" title={value}>{label ?? value}</code>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked; the value is visible in the field above.
          }
        }}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline">
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

const Menu = ({ children }: { children: ReactNode }) => <strong className="font-medium text-foreground">{children}</strong>;

function steps(source: LeadSource, url: string): { intro?: ReactNode; steps: ReactNode[]; check: ReactNode } {
  const secret = secretOf(url);
  const urlChip = <Paste value={url} label="webhook URL" />;
  const secretChip = <Paste value={secret} label="secret" />;

  switch (source) {
    case "lemlist":
      return {
        steps: [
          <>Open <Link href="https://app.lemlist.com">Lemlist</Link> and go to <Menu>Settings → Integrations</Menu>.</>,
          <>Find <Menu>Webhooks</Menu> and click <Menu>Add webhook</Menu> (or <Menu>Connect</Menu>).</>,
          <>Paste the {urlChip} into the URL field.</>,
          <>Under events, tick <Menu>Email replied</Menu> — and <Menu>LinkedIn replied</Menu> if you run LinkedIn steps. Save.</>,
          <>Back here, paste your <Menu>Lemlist API key</Menu> (Settings → Integrations → API) so approved replies can be sent.</>,
          <>On the <Menu>Campaigns</Menu> page, add your Lemlist campaign and turn it on.</>,
        ],
        check: <>Reply to one of your own campaign emails — a draft appears in the Lead Inbox within a minute.</>,
      };
    case "meta":
      return {
        intro: <>About 5 minutes, using Zapier (Make works the same way).</>,
        steps: [
          <>In <Link href="https://zapier.com/app/zaps">Zapier</Link>, create a Zap. Trigger: <Menu>Facebook Lead Ads → New Lead</Menu>. Connect your Facebook account and pick your Page and lead form.</>,
          <>Action: <Menu>Webhooks by Zapier → POST</Menu>.</>,
          <>URL: paste the {urlChip}. Payload type: <Menu>JSON</Menu>.</>,
          <>Under <Menu>Data</Menu>, add these rows (left: type the name, right: pick the lead's field): <code className="font-mono">full_name</code>, <code className="font-mono">email</code>, <code className="font-mono">phone_number</code>, <code className="font-mono">form_id</code>, and <code className="font-mono">message</code> for any other answers (budget, unit, timeline…).</>,
          <>Test the step, then <Menu>Publish</Menu>. In Make it's the same: <Menu>Facebook Lead Ads → Watch new leads</Menu>, then <Menu>HTTP → Make a request</Menu> (POST, JSON) to the same URL.</>,
          <>On the <Menu>Campaigns</Menu> page, add a <Menu>Meta</Menu> campaign and turn it on.</>,
        ],
        check: <>Use Meta's <Link href="https://developers.facebook.com/tools/lead-ads-testing">Lead Ads testing tool</Link> to submit a test lead — it appears in the Lead Inbox.</>,
      };
    case "google":
    case "youtube":
      return {
        intro: source === "youtube"
          ? <>YouTube video campaigns use Google Ads lead forms. Use this URL for forms on YouTube campaigns, so those leads are labelled YouTube.</>
          : undefined,
        steps: [
          <>In <Link href="https://ads.google.com">Google Ads</Link>, open <Menu>Campaigns → Assets</Menu> and choose <Menu>Lead forms</Menu>{source === "youtube" ? " used by your YouTube campaign" : ""}.</>,
          <>Open the form (pencil icon) and scroll to <Menu>Lead delivery options</Menu> → <Menu>Webhook integration</Menu>.</>,
          <><Menu>Webhook URL</Menu>: paste the {urlChip}.</>,
          <><Menu>Key</Menu>: paste the {secretChip}.</>,
          <>Click <Menu>Send test data</Menu> — it should say it succeeded — then <Menu>Save</Menu>.</>,
          <>On the <Menu>Campaigns</Menu> page, add a <Menu>{source === "youtube" ? "YouTube" : "Google Ads"}</Menu> campaign and turn it on.</>,
        ],
        check: <>Google's test data only checks the connection and is not added to the inbox. The first real form submission lands in the Lead Inbox.</>,
      };
    case "whatsapp":
      return {
        intro: <>Needs a WhatsApp Business number on Meta's Cloud API (a Meta developer app with WhatsApp added).</>,
        steps: [
          <>In <Link href="https://developers.facebook.com/apps">Meta for Developers</Link>, open your app → <Menu>WhatsApp → Configuration</Menu>.</>,
          <>Under <Menu>Webhook</Menu>, click <Menu>Edit</Menu>.</>,
          <><Menu>Callback URL</Menu>: paste the {urlChip}.</>,
          <><Menu>Verify token</Menu>: paste the {secretChip}. Click <Menu>Verify and save</Menu>.</>,
          <>Under <Menu>Webhook fields</Menu>, click <Menu>Manage</Menu> and subscribe to <Menu>messages</Menu>.</>,
          <>To send approved replies from your number, fill in the phone number ID and access token below (from <Menu>WhatsApp → API Setup</Menu>).</>,
          <>On the <Menu>Campaigns</Menu> page, add a <Menu>WhatsApp</Menu> campaign and turn it on.</>,
        ],
        check: <>Send your business number a WhatsApp message from another phone — it appears in the Lead Inbox.</>,
      };
  }
}

/**
 * Click-by-click setup for one lead source, shown under its webhook URL, with
 * the exact values to paste one click away. Kept next to the URL on purpose:
 * that is where someone looks when they don't know where it goes.
 */
export function ConnectGuide({ source, url, defaultOpen = false }: { source: LeadSource; url: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const guide = steps(source, url);
  return (
    <div className="text-[11px] text-muted-foreground">
      <button
        type="button"
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`guide-toggle-${source}`}
      >
        How to connect
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3" data-testid={`guide-${source}`}>
          {guide.intro && <p>{guide.intro}</p>}
          <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed marker:text-muted-foreground">
            {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="border-t border-border pt-2"><Menu>Check it works:</Menu> {guide.check}</p>
        </div>
      )}
    </div>
  );
}
