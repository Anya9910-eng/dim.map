import { useGetClient, useUpdateClient, useListCampaigns, getGetClientQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Megaphone, CheckCircle2, AlertTriangle, Info, Copy, Check, RefreshCw, Webhook, UserPlus, Trash2, Send } from "lucide-react";
import { ClientModeBadge, ClientBillingBadge } from "@/components/status-badges";
import { API_BASE } from "@/lib/api-base";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ClientUser {
  id: number;
  clientId: number;
  email: string;
  invitedBy: string | null;
  createdAt: string;
}

/**
 * Who from the client's side may sign in and see this client's dashboard.
 *
 * Access is granted by email because it is the one identifier that holds
 * whether the person is a guest in our Slack workspace or signs in from their
 * own. Adding an address grants nothing by itself — they still have to prove
 * it by signing in with Slack.
 */
function ClientAccessCard({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<ClientUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/users`, { credentials: "include" });
      setUsers(res.ok ? ((await res.json()) as ClientUser[]) : []);
    } catch {
      setUsers([]);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/users`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (res.ok) {
        setEmail("");
        await load();
        toast({ title: "Access granted", description: `${value} can now sign in and see this client.` });
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: "Could not grant access", description: body.error ?? "Please try again.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: ClientUser) => {
    if (!window.confirm(`Remove access for ${user.email}?\n\nThey keep their current session until it expires.`)) return;
    const res = await fetch(`${API_BASE}/api/clients/${clientId}/users/${user.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      await load();
      toast({ title: "Access removed" });
    } else {
      toast({ title: "Could not remove access", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <UserPlus className="h-3.5 w-3.5" /> Dashboard Access
        </CardTitle>
        <CardDescription className="text-xs">
          People from this client who may sign in. They see only this client's drafts,
          campaigns and history — never other clients, credentials or operator tools.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8 shrink-0" disabled={busy || !email.trim()} onClick={() => void add()}>
            Invite
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Must match the email on their Slack account — that is what we check at sign-in.
        </p>

        {users === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground">
            No one yet. This client works entirely in Slack until you invite someone.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="font-mono text-[11px] truncate">{u.email}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void remove(u)}
                  title="Remove access"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Archive is the reversible one and is offered first: it stops the client
 * consuming replies while keeping everything, which is what "we're pausing with
 * this client" actually means. Delete is permanent and takes their drafts,
 * campaigns, personas, logs and dashboard access with it, so it asks the
 * operator to type the client's name — a confirm dialog is too easy to dismiss
 * by reflex for something with no undo.
 */
function DangerZoneCard({ client }: { client: { id: number; name: string; isActive: boolean } }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleArchive = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${client.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !client.isActive }),
      });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) });
        toast({
          title: client.isActive ? "Client archived" : "Client restored",
          description: client.isActive
            ? "Incoming replies are ignored. Nothing was deleted."
            : "Replies are processed again.",
        });
      } else {
        toast({ title: "Could not change the client", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${client.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Client deleted", description: `${client.name} and all of its data are gone.` });
        setLocation("/clients");
      } else {
        toast({ title: "Could not delete the client", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Danger Zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="space-y-2">
          <p className="text-muted-foreground">
            {client.isActive
              ? "Archiving stops this client consuming replies — no drafts, no Slack posts, no model calls. Everything is kept and can be switched back on."
              : "This client is archived. Incoming replies are ignored until you restore it."}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void toggleArchive()}>
            {client.isActive ? "Archive client" : "Restore client"}
          </Button>
        </div>

        <div className="space-y-2 pt-3 border-t border-destructive/20">
          <p className="text-muted-foreground">
            Deleting removes this client along with its drafts, campaigns, personas,
            logs and dashboard access. This cannot be undone.
          </p>
          <Input
            placeholder={`Type ${client.name} to confirm`}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={busy || confirmName !== client.name}
            onClick={() => void remove()}
          >
            <Trash2 className="h-3 w-3" /> Delete permanently
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


interface LemlistWebhookInfo {
  clientId: number;
  path: string;
  url: string | null;
  secret: string | null;
  hasSecret: boolean;
  headerName: string;
  hasClientApiKey: boolean;
  usingGlobalApiKeyFallback: boolean;
}

/**
 * The per-client Lemlist webhook URL, ready for the operator to copy and hand
 * to the client. Rotating the secret takes effect immediately, so the old URL
 * stops working the moment the button is pressed — hence the confirmation.
 */
function LemlistWebhookCard({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<LemlistWebhookInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/lemlist-webhook`);
      setInfo(res.ok ? ((await res.json()) as LemlistWebhookInfo) : null);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopy = async () => {
    if (!info?.url) return;
    await navigator.clipboard.writeText(info.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRegenerate = async () => {
    if (info?.hasSecret && !window.confirm(
      "Regenerate this client's webhook secret?\n\nThe URL they already pasted into Lemlist will stop working immediately — you'll need to send them the new one.",
    )) return;
    setRegenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/lemlist-webhook/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setInfo((await res.json()) as LemlistWebhookInfo);
      toast({ title: "New webhook URL generated", description: "Send the new URL to the client — the old one no longer works." });
    } catch {
      toast({ title: "Failed to regenerate webhook secret", variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Webhook className="h-3.5 w-3.5" /> Lemlist Webhook
        </CardTitle>
        <CardDescription className="text-xs">
          This client's own endpoint — paste it into their Lemlist account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {loading ? (
          <p className="text-muted-foreground animate-pulse">Loading…</p>
        ) : !info ? (
          <p className="text-muted-foreground">Webhook details unavailable.</p>
        ) : (
          <>
            {info.url ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">Webhook URL</p>
                <div className="flex items-start gap-1.5">
                  <code className="flex-1 font-mono text-[10px] break-all bg-muted/50 rounded px-2 py-1.5 leading-relaxed">
                    {info.url}
                  </code>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy} title="Copy URL">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Lemlist can't send custom headers, so the secret travels in the URL. Tools that can (n8n) may send it
                  as the <span className="font-mono">{info.headerName}</span> header instead.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-600 dark:text-amber-400">
                  No webhook secret yet — generate one to enable this client's endpoint.
                </span>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">API Key</p>
              {info.hasClientApiKey ? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="text-emerald-600 dark:text-emerald-400">Per-client key active</span>
                </div>
              ) : info.usingGlobalApiKeyFallback ? (
                <div className="flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">
                    Falling back to global <span className="font-mono">LEMLIST_API_KEY</span> — replies will be sent
                    from that account.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-amber-600 dark:text-amber-400">
                    No key for this client and no global fallback — replies cannot be sent.
                  </span>
                </div>
              )}
            </div>

            <Button variant="outline" size="sm" className="w-full" onClick={handleRegenerate} disabled={regenerating}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
              {info.hasSecret ? "Regenerate secret" : "Generate secret"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function isRealSlackChannelId(value: string | null | undefined): boolean {
  return !!value && /^[CG][A-Z0-9]{9,}/.test(value);
}

function isRealSlackToken(value: string | null | undefined): boolean {
  return !!value && value.startsWith("xoxb-") && !value.includes("placeholder");
}

function SlackChannelStatus({ value }: { value: string }) {
  // Blank is a valid, complete configuration — not a warning. It used to mean
  // "falls back to the global channel", which is why this said so; that
  // fallback is gone, because it put every channel-less client's replies in
  // one shared channel.
  if (!value) {
    return (
      <p className="text-[11px] text-muted-foreground mt-1">
        No Slack channel — this client's drafts are approved in the dashboard only. Add a Channel ID (e.g. <span className="font-mono">C0BK6NPBHKJ</span>, found in Slack under channel details) to also post approval cards.
      </p>
    );
  }
  if (isRealSlackChannelId(value)) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          Valid Slack Channel ID — replies will post to this channel.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
      <p className="text-[11px] text-amber-600 dark:text-amber-400">
        Looks like a name, not a Slack Channel ID — no card will be posted. Copy the ID from Slack (starts with C or G), or clear the field to approve in the dashboard only.
      </p>
    </div>
  );
}

function SlackTokenStatus({ value }: { value: string }) {
  if (!value) {
    return (
      <p className="text-[11px] text-muted-foreground mt-1">
        Optional. Leave blank to use the global <span className="font-mono">SLACK_BOT_TOKEN</span>. Set a per-client token if this client uses a separate Slack workspace.
      </p>
    );
  }
  if (isRealSlackToken(value)) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          Per-client bot token set — this token will be used for this client's Slack messages.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
      <p className="text-[11px] text-amber-600 dark:text-amber-400">
        Token doesn't look like a valid <span className="font-mono">xoxb-</span> bot token. Will fall back to global <span className="font-mono">SLACK_BOT_TOKEN</span>.
      </p>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const clientId = parseInt(id || "0", 10);
  
  const { data: client, isLoading } = useGetClient(clientId, { query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId) } });
  const { data: campaigns } = useListCampaigns({ clientId });
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    company: "",
    slackChannel: "",
    slackBotToken: "",
    mode: "draft" as "draft" | "auto",
    lemlistApiKey: "",
    n8nWebhookUrl: ""
  });
  const [channelError, setChannelError] = useState<string | null>(null);

  const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{9,}$/;
  // Blank is allowed — clearing the channel is how you turn Slack cards off for
  // a client who approves in the dashboard. Requiring it here also meant no
  // other field on this page could be saved without one.
  const validateChannel = (value: string): string | null => {
    if (!value) return null;
    if (!SLACK_CHANNEL_ID_RE.test(value)) {
      return "Must be a Slack channel ID starting with C or G, like C012AB3CD45.";
    }
    return null;
  };

  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name,
        company: client.company || "",
        slackChannel: client.slackChannel ?? "",
        slackBotToken: client.slackBotToken || "",
        mode: client.mode,
        lemlistApiKey: client.lemlistApiKey || "",
        n8nWebhookUrl: client.n8nWebhookUrl || ""
      });
    }
  }, [client]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateChannel(formData.slackChannel);
    if (err) {
      setChannelError(err);
      return;
    }
    setChannelError(null);
    // An empty channel field means "remove it", which has to travel as null:
    // the API validates a channel against the C…/G… pattern, so "" is not a
    // blank value to it but a malformed id, and the whole save was rejected.
    const payload = {
      ...formData,
      slackChannel: formData.slackChannel.trim() === "" ? null : formData.slackChannel.trim(),
    };
    updateClient.mutate({ id: clientId, data: payload }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetClientQueryKey(clientId), updated);
        toast({ title: "Client updated successfully" });
      },
      onError: () => {
        toast({ title: "Failed to update client", variant: "destructive" });
      }
    });
  };

  const [sendingTest, setSendingTest] = useState(false);

  const handleSendTestCard = async () => {
    setSendingTest(true);
    try {
      const res = await fetch(`${API_BASE}/api/slack/test-approval-card`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: formData.slackChannel }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        toast({ title: "Test card sent", description: "Check the channel in Slack. The buttons are safe — no email is sent." });
      } else {
        toast({
          title: "Could not post to that channel",
          description: body.error ?? "The bot may not be a member of it.",
          variant: "destructive",
        });
      }
    } finally {
      setSendingTest(false);
    }
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading client...</div>;
  if (!client) return <div className="p-8 text-center text-muted-foreground">Client not found.</div>;

  const effectiveChannelIsReal = isRealSlackChannelId(formData.slackChannel);
  const effectiveTokenIsReal = isRealSlackToken(formData.slackBotToken);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/clients"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
            <ClientModeBadge mode={client.mode} />
            <ClientBillingBadge status={client.billingStatus} trialDaysLeft={client.trialDaysLeft} />
            {!client.isActive && (
              <Badge className="bg-muted text-muted-foreground border-border font-normal text-[10px] h-5">
                Archived
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Client ID: {client.id} · Created {new Date(client.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="mode">Operating Mode</Label>
                  <Select value={formData.mode} onValueChange={(val: "draft" | "auto") => setFormData({ ...formData, mode: val })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft (Manual Approval)</SelectItem>
                      <SelectItem value="auto">Auto (Direct Send)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Slack Configuration */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">Slack Configuration</h3>
                    {effectiveChannelIsReal ? (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-normal text-[10px] gap-1 h-5">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Channel configured
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground border-border font-normal text-[10px] gap-1 h-5">
                        <Info className="h-2.5 w-2.5" /> Dashboard only
                      </Badge>
                    )}
                  </div>

                  <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                    <p>
                      Slack is optional. Every draft is approved in the dashboard; a channel here additionally posts an approval card for this client. Cards go only to this client's own channel — there is no shared fallback channel, so one client's replies can never appear in another's.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="slackChannel">
                      Slack Channel ID
                      <span className="text-muted-foreground font-normal ml-1.5 text-[11px]">optional — leave blank to approve in the dashboard only</span>
                    </Label>
                    <Input
                      id="slackChannel"
                      placeholder="C0BK6NPBHKJ"
                      className={`font-mono text-sm${channelError ? " border-destructive focus-visible:ring-destructive" : ""}`}
                      value={formData.slackChannel}
                      onChange={e => {
                        setFormData({ ...formData, slackChannel: e.target.value });
                        if (channelError) setChannelError(validateChannel(e.target.value));
                      }}
                    />
                    {channelError ? (
                      <p className="text-[11px] text-destructive">{channelError}</p>
                    ) : (
                      <SlackChannelStatus value={formData.slackChannel} />
                    )}
                    {/* Proves the bot can actually reach the channel. A channel
                        id can be well-formed and still be one the bot was never
                        added to, which otherwise only shows up as drafts that
                        never arrive. */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        disabled={!effectiveChannelIsReal || sendingTest}
                        onClick={() => void handleSendTestCard()}
                      >
                        <Send className="h-3 w-3" />
                        {sendingTest ? "Sending…" : "Send test card"}
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        Posts a marked test card. No email is sent.
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="slackBotToken">
                      Slack Bot Token
                      <span className="text-muted-foreground font-normal ml-1.5 text-[11px]">optional — override per client</span>
                    </Label>
                    <Input
                      id="slackBotToken"
                      type="password"
                      placeholder="xoxb-••••••••••••••••"
                      value={formData.slackBotToken}
                      onChange={e => setFormData({ ...formData, slackBotToken: e.target.value })}
                    />
                    <SlackTokenStatus value={formData.slackBotToken} />
                  </div>
                </div>

                {/* Other integrations */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <h3 className="text-sm font-medium">Other Integrations</h3>
                  <div className="space-y-1.5">
                    <Label htmlFor="lemlistApiKey">
                      Lemlist API Key
                      <span className="text-muted-foreground font-normal ml-1.5 text-[11px]">this client's own Lemlist account</span>
                    </Label>
                    <Input id="lemlistApiKey" type="password" placeholder="sk_..." value={formData.lemlistApiKey} onChange={e => setFormData({ ...formData, lemlistApiKey: e.target.value })} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Replies for this client are sent through this key. Leave blank to fall back to the global{" "}
                      <span className="font-mono">LEMLIST_API_KEY</span>.
                    </p>
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="n8nWebhookUrl">n8n Webhook URL</Label>
                    <Input id="n8nWebhookUrl" placeholder="https://..." value={formData.n8nWebhookUrl} onChange={e => setFormData({ ...formData, n8nWebhookUrl: e.target.value })} />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button type="submit" disabled={updateClient.isPending}>
                    {updateClient.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Slack routing summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Slack Routing</CardTitle>
              <CardDescription className="text-xs">How this client's replies get posted</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">Channel</p>
                {effectiveChannelIsReal ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 break-all">{formData.slackChannel}</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">No channel — dashboard only</span>
                    </div>
                    <p className="text-muted-foreground pl-5">Drafts still arrive in Draft Replies for approval. Enter a Channel ID above to also post cards.</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">Bot Token</p>
                {effectiveTokenIsReal ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="text-emerald-600 dark:text-emerald-400">Per-client token active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Global <span className="font-mono">SLACK_BOT_TOKEN</span></span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <LemlistWebhookCard clientId={clientId} />
          <ClientAccessCard clientId={clientId} />
          <DangerZoneCard client={client} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Campaigns</CardTitle>
              <CardDescription>Linked outreach campaigns</CardDescription>
            </CardHeader>
            <CardContent>
              {campaigns?.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">No campaigns found.</div>
              ) : (
                <div className="space-y-3">
                  {campaigns?.map(camp => (
                    <div key={camp.id} className="flex items-center justify-between p-2 rounded border bg-muted/30">
                      <div>
                        <Link href={`/campaigns/${camp.id}`} className="font-medium hover:underline text-sm block">{camp.name}</Link>
                        <span className="text-xs text-muted-foreground">{camp.lemlistCampaignId}</span>
                      </div>
                      <Megaphone className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" className="w-full mt-4" asChild>
                <Link href="/campaigns">Manage Campaigns</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
