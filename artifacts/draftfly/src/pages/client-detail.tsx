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
import { ArrowLeft, Megaphone, CheckCircle2, AlertTriangle, Info, Copy, Check, RefreshCw, Webhook, UserPlus, Trash2 } from "lucide-react";
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
 * Access is granted by email. Adding an address grants nothing by itself —
 * they still have to prove it by entering the sign-in code emailed to them.
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
          They sign in at /app with this email; a one-time code is emailed to it.
        </p>

        {users === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground">
            No one yet. Invite someone so this client can review their own leads.
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
              ? "Archiving stops this client consuming replies — no drafts and no model calls. Everything is kept and can be switched back on."
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


interface LeadSourcesInfo {
  clientId: number;
  url: string | null;
  hasSecret: boolean;
  headerName: string;
  hasClientApiKey: boolean;
  usingGlobalApiKeyFallback: boolean;
  sources?: { lemlist: string | null; meta: string | null; google: string | null; youtube: string | null; whatsapp: string | null };
  whatsappSendingReady?: boolean;
}

const SOURCE_ROWS: Array<{ key: "lemlist" | "meta" | "google" | "youtube" | "whatsapp"; label: string; hint: string }> = [
  { key: "lemlist", label: "Lemlist", hint: "Lemlist → Settings → Integrations → Webhooks, subscribed to the replied event." },
  { key: "meta", label: "Meta lead ads", hint: "Forward new leads (with their field_data) from n8n, Zapier or Make, or subscribe the Page's leadgen webhook." },
  { key: "google", label: "Google Ads", hint: "Lead form → Lead delivery → Webhook integration. Use the secret at the end of the URL as the key." },
  { key: "youtube", label: "YouTube", hint: "Same as Google Ads, for lead forms on YouTube video campaigns." },
  { key: "whatsapp", label: "WhatsApp", hint: "Meta for Developers → WhatsApp → Configuration: callback URL; verify token = the secret; subscribe to messages." },
];

function CopyRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">{label}</p>
      <div className="flex items-start gap-1.5">
        <code className="flex-1 font-mono text-[10px] break-all bg-muted/50 rounded px-2 py-1.5 leading-relaxed">{url}</code>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Copy URL"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard blocked; the URL is selectable.
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <p className="text-muted-foreground text-[11px]">{hint}</p>
    </div>
  );
}

/**
 * Every lead source's webhook address for this client, ready for the operator
 * to copy and hand over — plus whether replies can actually go back out
 * (Lemlist key, WhatsApp sending). All addresses share one secret, so rotating
 * it breaks every one of them at once — hence the confirmation.
 */
function LeadSourcesCard({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<LeadSourcesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [savingWa, setSavingWa] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/lemlist-webhook`);
      setInfo(res.ok ? ((await res.json()) as LeadSourcesInfo) : null);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRegenerate = async () => {
    if (info?.hasSecret && !window.confirm(
      "Regenerate this client's webhook secret?\n\nEvery webhook URL below (Lemlist, Meta, Google Ads, YouTube, WhatsApp) stops working immediately — you'll need to paste the new ones in.",
    )) return;
    setRegenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/lemlist-webhook/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setInfo((await res.json()) as LeadSourcesInfo);
      toast({ title: "New webhook URLs generated", description: "Update them in every lead source — the old ones no longer work." });
    } catch {
      toast({ title: "Failed to regenerate webhook secret", variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  };

  const saveWhatsApp = async () => {
    setSavingWa(true);
    try {
      const res = await fetch(`${API_BASE}/api/me/settings?clientId=${clientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(waPhoneId.trim() ? { whatsappPhoneNumberId: waPhoneId.trim() } : {}),
          ...(waToken.trim() ? { whatsappAccessToken: waToken.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setWaPhoneId("");
      setWaToken("");
      toast({ title: "WhatsApp settings saved" });
      void load();
    } catch (err) {
      toast({ title: "Could not save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingWa(false);
    }
  };

  const sources = info?.sources ?? (info?.url ? { lemlist: info.url, meta: null, google: null, youtube: null, whatsapp: null } : null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Webhook className="h-3.5 w-3.5" /> Lead sources
        </CardTitle>
        <CardDescription className="text-xs">
          This client's own webhook addresses — paste each into the matching tool
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {loading ? (
          <p className="text-muted-foreground animate-pulse">Loading…</p>
        ) : !info ? (
          <p className="text-muted-foreground">Webhook details unavailable.</p>
        ) : (
          <>
            {sources && info.hasSecret ? (
              SOURCE_ROWS.map((row) =>
                sources[row.key] ? <CopyRow key={row.key} label={row.label} url={sources[row.key] as string} hint={row.hint} /> : null,
              )
            ) : (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-600 dark:text-amber-400">
                  No webhook secret yet — generate one to enable this client's addresses.
                </span>
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={handleRegenerate} disabled={regenerating}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
              {info.hasSecret ? "Regenerate secret (breaks all URLs above)" : "Generate secret"}
            </Button>

            <div className="space-y-1.5 border-t pt-3">
              <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium">Sending replies</p>
              <div className="flex items-start gap-1.5">
                {info.hasClientApiKey ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /><span>Lemlist: this client's own key</span></>
                ) : info.usingGlobalApiKeyFallback ? (
                  <><Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /><span className="text-muted-foreground">Lemlist: using the global <span className="font-mono">LEMLIST_API_KEY</span></span></>
                ) : (
                  <><AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /><span className="text-amber-600 dark:text-amber-400">Lemlist: no API key — add one below to send email replies</span></>
                )}
              </div>
              <div className="flex items-start gap-1.5">
                {info.whatsappSendingReady ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /><span>WhatsApp: sending enabled (WhatsApp, Meta, Google and YouTube leads with a phone number)</span></>
                ) : (
                  <><Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /><span className="text-muted-foreground">WhatsApp: not set up — leads are still qualified and drafted; replies are copied across by hand</span></>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                <Input className="h-8 text-xs font-mono" placeholder="WhatsApp phone number ID" value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} />
                <Input className="h-8 text-xs" type="password" placeholder={info.whatsappSendingReady ? "Replace access token…" : "WhatsApp access token"} value={waToken} onChange={(e) => setWaToken(e.target.value)} />
                <Button size="sm" variant="outline" onClick={saveWhatsApp} disabled={savingWa || (!waPhoneId.trim() && !waToken.trim())}>
                  Save WhatsApp settings
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
    mode: "draft" as "draft" | "auto",
    lemlistApiKey: "",
    n8nWebhookUrl: ""
  });
  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name,
        company: client.company || "",
        mode: client.mode,
        lemlistApiKey: client.lemlistApiKey || "",
        n8nWebhookUrl: client.n8nWebhookUrl || ""
      });
    }
  }, [client]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateClient.mutate({ id: clientId, data: formData }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetClientQueryKey(clientId), updated);
        toast({ title: "Client updated successfully" });
      },
      onError: () => {
        toast({ title: "Failed to update client", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading client...</div>;
  if (!client) return <div className="p-8 text-center text-muted-foreground">Client not found.</div>;

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

                {/* Other integrations */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <h3 className="text-sm font-medium">Integrations</h3>
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
          <LeadSourcesCard clientId={clientId} />
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
