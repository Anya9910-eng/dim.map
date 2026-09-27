import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { API_BASE } from "@/lib/api-base";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
  Send,
  Pencil,
  Trash2,
  Zap,
  Hash,
  Link2,
  Shield,
  Bot,
  Activity,
  Eye,
  EyeOff,
  Clock,
} from "lucide-react";


function StatusBadge({ status }: { status: "connected" | "warning" | "disconnected" }) {
  if (status === "connected") return (
    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10 font-normal gap-1">
      <CheckCircle2 className="h-3 w-3" /> Connected
    </Badge>
  );
  if (status === "warning") return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/10 font-normal gap-1">
      <AlertTriangle className="h-3 w-3" /> Pending
    </Badge>
  );
  return (
    <Badge className="bg-muted text-muted-foreground border-border hover:bg-muted font-normal gap-1">
      <XCircle className="h-3 w-3" /> Disconnected
    </Badge>
  );
}

function MaskedInput({ value, label, description }: { value: string; label: string; description?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider">{label}</Label>
      <div className="relative">
        <Input
          value={show ? value : value.replace(/./g, "•").slice(0, 32)}
          readOnly
          className="font-mono text-xs pr-10 bg-background/60 border-border"
          data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export default function SlackAppSetup() {
  const [sendClicked, setSendClicked] = useState(false);
  const [editClicked, setEditClicked] = useState(false);
  const [discardClicked, setDiscardClicked] = useState(false);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-title">Slack App Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configuration reference for the DraftFly Slack bot. Set <span className="font-mono text-foreground">SLACK_BOT_TOKEN</span> and <span className="font-mono text-foreground">SLACK_SIGNING_SECRET</span> in Replit Secrets to activate.
        </p>
      </div>

      {/* Safety notes banner */}
      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
        <Shield className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm space-y-1">
          <p className="font-medium text-amber-400">MVP Safety Defaults</p>
          <ul className="text-muted-foreground space-y-0.5 text-xs list-none">
            <li>— Draft Mode is default. All replies require human approval before sending.</li>
            <li>— No direct LinkedIn integration. Lemlist handles LinkedIn and email campaign delivery.</li>
            <li>— Clients interact only through Slack. This dashboard is internal operator-only.</li>
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">

          {/* App Status */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" /> Slack App Status
                </CardTitle>
                <StatusBadge status="connected" />
              </div>
              <CardDescription>DraftFly Slack app — installed in 3 client workspaces</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">App Name</p>
                  <p className="font-medium">DraftFly</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">App ID</p>
                  <p className="font-mono text-xs">A08DRAFT01</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Scopes</p>
                  <p className="font-mono text-xs">chat:write, channels:read</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Interactive Components</p>
                  <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Enabled
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Credentials */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Credentials
              </CardTitle>
              <CardDescription>Set these in Replit Secrets to activate Slack integration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Bot Token</Label>
                <Input
                  value="Set SLACK_BOT_TOKEN in Replit Secrets"
                  readOnly
                  className="font-mono text-xs bg-background/60 border-border text-muted-foreground"
                  data-testid="input-bot-token"
                />
                <p className="text-xs text-muted-foreground">OAuth bot token — used to post approval cards to client channels</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Signing Secret</Label>
                <Input
                  value="Set SLACK_SIGNING_SECRET in Replit Secrets"
                  readOnly
                  className="font-mono text-xs bg-background/60 border-border text-muted-foreground"
                  data-testid="input-signing-secret"
                />
                <p className="text-xs text-muted-foreground">Used to verify incoming webhook payloads are from Slack</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Approval Channel ID</Label>
                <Input
                  value="Set per-client in Clients → Slack Channel field (e.g. C0XXXXXXXX)"
                  readOnly
                  className="font-mono text-xs bg-background/60 border-border text-muted-foreground"
                  data-testid="input-approval-channel-id"
                />
                <p className="text-xs text-muted-foreground">Per-client channel ID where draft approval cards are posted</p>
              </div>
            </CardContent>
          </Card>

          {/* Webhook & Interactive Buttons */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Webhook & Interactive Buttons
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Webhook Endpoint URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value="https://n8n.draftfly.internal/webhook/slack-events"
                    readOnly
                    className="font-mono text-xs bg-background/60 border-border"
                    data-testid="input-webhook-url"
                  />
                  <Button variant="outline" size="sm" className="shrink-0" data-testid="button-copy-webhook">
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Registered in Slack App &gt; Event Subscriptions and Interactivity</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Interactive Buttons Request URL</Label>
                <Input
                  value="https://n8n.draftfly.internal/webhook/slack-actions"
                  readOnly
                  className="font-mono text-xs bg-background/60 border-border"
                  data-testid="input-actions-url"
                />
              </div>
              <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-xs">Subscribed Events</p>
                <p className="font-mono">message.channels &nbsp;·&nbsp; block_actions &nbsp;·&nbsp; url_verification</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">

          {/* Slack Message Mockup */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" /> Approval Card Preview
              </CardTitle>
              <CardDescription>
                This is what the client sees in Slack. They never access this dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Slack-style dark message card */}
              <div className="bg-[#1A1D21] border border-[#272A2E] rounded-lg p-4 text-[14px] space-y-3">
                {/* Bot header */}
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-[#D1D2D3]">DraftFly</span>
                    <span className="bg-[#2C3136] text-[#ABABAD] text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">App</span>
                    <span className="text-xs text-[#7E7E7E]">1:47 PM</span>
                  </div>
                </div>

                {/* Lead info */}
                <div className="text-[#D1D2D3] font-semibold">
                  New reply from <span className="text-primary">Sarah Mitchell</span> &mdash; Momentum Labs
                </div>

                {/* Prospect reply */}
                <div className="border-l-[3px] border-[#3F4147] pl-3">
                  <p className="text-[#ABABAD] text-[13px] italic">
                    "Yes, interested. Can you send more details?"
                  </p>
                </div>

                {/* Claude draft */}
                <div className="bg-[#222529] border border-[#35373B] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#ABABAD]">Claude Draft</span>
                  </div>
                  <p className="text-[#D1D2D3] text-[13px] leading-relaxed">
                    Hi Sarah, thanks for your reply. Happy to share more details. Based on your team size and current outreach goals, I think this could help you reduce manual follow-up work and respond faster to interested leads. Would it make sense to schedule a quick 15-minute call this week?
                  </p>
                </div>

                {/* Campaign / Persona metadata */}
                <div className="flex items-center gap-3 text-[11px] text-[#7E7E7E]">
                  <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> SaaS Founders Outreach Q3</span>
                  <span>&middot;</span>
                  <span>Persona: Senior SDR</span>
                  <span>&middot;</span>
                  <span>US</span>
                </div>

                <Separator className="bg-[#35373B]" />

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setSendClicked(true); setEditClicked(false); setDiscardClicked(false); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors ${sendClicked ? "bg-[#148567] text-white" : "bg-[#007A5A] hover:bg-[#148567] text-white"}`}
                    data-testid="mock-button-send"
                  >
                    <Send className="h-3.5 w-3.5" /> Send Reply
                  </button>
                  <button
                    onClick={() => { setEditClicked(true); setSendClicked(false); setDiscardClicked(false); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors border ${editClicked ? "bg-[#2C3136] border-primary text-primary" : "bg-[#222529] border-[#35373B] text-[#D1D2D3] hover:bg-[#2C3136]"}`}
                    data-testid="mock-button-edit"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Reply
                  </button>
                  <button
                    onClick={() => { setDiscardClicked(true); setSendClicked(false); setEditClicked(false); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors border ${discardClicked ? "bg-[#2C3136] border-red-500/60 text-red-400" : "bg-[#222529] border-[#35373B] text-[#E01E5A] hover:bg-[#2C3136]"}`}
                    data-testid="mock-button-discard"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Discard
                  </button>
                </div>

                {/* Feedback on click */}
                {sendClicked && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Reply sent to Lemlist — delivered to prospect
                  </div>
                )}
                {editClicked && (
                  <div className="flex items-center gap-1.5 text-xs text-primary">
                    <Pencil className="h-3.5 w-3.5" /> Edit modal would open in Slack — operator types revised reply
                  </div>
                )}
                {discardClicked && (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <XCircle className="h-3.5 w-3.5" /> Draft discarded — no reply sent to prospect
                  </div>
                )}
              </div>

              {/* Explanation */}
              <div className="mt-3 rounded-md bg-muted/20 border border-border px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Client experience</p>
                <p>The client installs the DraftFly Slack app, selects an approval channel, and receives cards like the above for every prospect reply. They never visit a web dashboard. Operator manages everything else internally.</p>
              </div>
            </CardContent>
          </Card>

          {/* Event Logs */}
          <SlackEventLogs />
        </div>
      </div>
    </div>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SlackLog {
  id: number;
  level: string;
  message: string;
  source: string | null;
  createdAt: string;
}

function SlackEventLogs() {
  const [slackLogs, setSlackLogs] = useState<SlackLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/logs?source=slack&limit=20`)
      .then((r) => r.ok ? r.json() as Promise<SlackLog[]> : Promise.resolve([]))
      .then(setSlackLogs)
      .catch(() => setSlackLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Slack Event Logs
          </CardTitle>
          <Badge variant="outline" className="text-xs font-normal">Live</Badge>
        </div>
        <CardDescription>Slack events from the real pipeline</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : slackLogs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No Slack events yet. Run a test flow or connect Slack to see events here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {slackLogs.map((log) => (
              <div key={log.id} className="px-4 py-2.5 flex items-start gap-3 text-xs">
                <span className="font-mono text-muted-foreground shrink-0 pt-0.5 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-primary/80">slack</span>
                    <span className={`ml-auto shrink-0 font-medium ${log.level === "error" ? "text-red-400" : "text-emerald-400"}`}>
                      {log.level}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate">{log.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
