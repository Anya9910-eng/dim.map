import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { BillingCard } from "@/components/billing-card";
import { CheckCircle2, AlertCircle, Copy, Check, RefreshCw, Loader2, KeyRound, Webhook, MessageSquare, Gauge } from "lucide-react";
import {
  useMySettings,
  useUpdateMySettings,
  useTestLemlist,
  useRegenerateWebhook,
} from "@/hooks/use-my-settings";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard is blocked outside a secure context; the field is
          // selectable, so the value is still reachable by hand.
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const full = used >= limit;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={full ? "font-semibold text-destructive" : "font-medium"}>
          {used} / {limit}
        </span>
      </div>
      <Progress value={pct} className={full ? "[&>div]:bg-destructive" : ""} />
    </div>
  );
}

export default function ClientSettingsPage() {
  const { data, isLoading, error } = useMySettings();
  const update = useUpdateMySettings();
  const testLemlist = useTestLemlist();
  const regenerate = useRegenerateWebhook();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [channel, setChannel] = useState<string | null>(null);

  if (isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <Card key={i} className="h-40 animate-pulse" />)}</div>;
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <AlertCircle className="mx-auto h-10 w-10 opacity-30 mb-3" />
          <p>{error instanceof Error ? error.message : "Could not load your settings."}</p>
        </CardContent>
      </Card>
    );
  }

  const channelValue = channel ?? data.slack.channel ?? "";

  const saveKey = () => {
    if (!apiKey.trim()) return;
    update.mutate({ lemlistApiKey: apiKey.trim() }, {
      onSuccess: () => {
        setApiKey("");
        toast({ title: "Lemlist key saved" });
      },
      onError: (e) => toast({ title: "Could not save", description: String(e), variant: "destructive" }),
    });
  };

  const saveChannel = () => {
    update.mutate({ slackChannel: channelValue.trim() === "" ? null : channelValue.trim() }, {
      onSuccess: () => toast({ title: channelValue.trim() ? "Slack channel saved" : "Slack channel cleared" }),
      onError: (e) => toast({ title: "Could not save", description: String(e), variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Connect DraftFly to your Lemlist account. Everything here is yours alone.
        </p>
      </div>

      <BillingCard />

      {/* ── 1. Lemlist API key ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Lemlist API key
            {data.lemlist.hasApiKey && (
              <Badge variant="outline" className="ml-auto gap-1 text-green-600 border-green-600/30">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            In Lemlist: Settings → Integrations → API. This lets DraftFly read your campaigns and send
            approved replies on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.lemlist.hasApiKey && (
            <p className="text-sm text-muted-foreground">
              Saved key ends in <span className="font-mono">{data.lemlist.keyHint}</span>. Keys cannot be
              read back — paste a new one to replace it.
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={data.lemlist.hasApiKey ? "Replace the saved key…" : "Paste your Lemlist API key"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              data-testid="lemlist-key"
            />
            <Button onClick={saveKey} disabled={!apiKey.trim() || update.isPending} data-testid="save-lemlist-key">
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
          {data.lemlist.hasApiKey && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testLemlist.mutate(undefined, {
                  onSuccess: (r) => toast({
                    title: r.ok ? "Lemlist connection works" : "Lemlist refused the key",
                    description: r.error,
                    variant: r.ok ? undefined : "destructive",
                  }),
                  onError: (e) => toast({ title: "Test failed", description: String(e), variant: "destructive" }),
                })}
                disabled={testLemlist.isPending}
              >
                {testLemlist.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
                Test connection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Webhook ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" /> Your webhook URL
          </CardTitle>
          <CardDescription>
            Paste this into Lemlist under Settings → Integrations → Webhooks, subscribed to the
            <span className="font-medium"> replied </span> event. This is how DraftFly hears about a reply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.webhook.url ? (
            <div className="flex gap-2">
              <Input readOnly value={data.webhook.url} className="font-mono text-xs" data-testid="webhook-url" />
              <CopyButton value={data.webhook.url} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No webhook secret yet — generate one to get your URL.</p>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => regenerate.mutate(undefined, {
                onSuccess: () => toast({
                  title: "New webhook URL generated",
                  description: "Update it in Lemlist — the previous URL no longer works.",
                }),
              })}
              disabled={regenerate.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${regenerate.isPending ? "animate-spin" : ""}`} />
              {data.webhook.hasSecret ? "Regenerate" : "Generate"}
            </Button>
            {data.webhook.hasSecret && (
              <span className="text-xs text-muted-foreground">
                Regenerating breaks the old URL until you paste the new one into Lemlist.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Slack (optional) ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> Slack channel
            <Badge variant="secondary" className="ml-auto font-normal">Optional</Badge>
          </CardTitle>
          <CardDescription>
            Get an approval card in Slack for every draft. Leave this empty to approve in the dashboard only.
            In Slack: open the channel → View channel details → copy the ID at the bottom.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="C0123456789"
              value={channelValue}
              onChange={e => setChannel(e.target.value)}
              className="font-mono"
              data-testid="slack-channel"
            />
            <Button variant="outline" onClick={saveChannel} disabled={update.isPending} data-testid="save-slack-channel">Save</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 4. Plan usage ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Your plan
            <Badge variant="outline" className="ml-auto capitalize">{data.client.plan}</Badge>
          </CardTitle>
          <CardDescription>
            You can map as many campaigns as you like — your plan sets how many run at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageBar
            label="Campaigns drafting"
            used={data.usage.activeCampaigns}
            limit={data.usage.activeCampaignLimit}
          />
          <UsageBar
            label="Replies this month"
            used={data.usage.repliesThisMonth}
            limit={data.usage.replyLimit}
          />
          {data.usage.totalCampaigns > data.usage.activeCampaigns && (
            <p className="text-xs text-muted-foreground">
              {data.usage.totalCampaigns - data.usage.activeCampaigns} mapped campaign
              {data.usage.totalCampaigns - data.usage.activeCampaigns === 1 ? " is" : "s are"} switched off
              and cost nothing.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
