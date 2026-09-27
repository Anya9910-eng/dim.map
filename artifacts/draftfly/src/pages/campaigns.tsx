import { useListCampaigns, useCreateCampaign, useUpdateCampaign, useListClients, useListPersonas, getListCampaignsQueryKey, getListPersonasQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Megaphone, Plus, MessageSquare, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useMySettings, useLemlistCampaignOptions } from "@/hooks/use-my-settings";
import { LeadChannelBadge } from "@/components/status-badges";

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const { data: clients } = useListClients();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isOperator, clientId: ownClientId } = useAuth();
  const [open, setOpen] = useState(false);

  // These are the fields the draft prompt actually reads. The form previously
  // collected a free-text "Persona" and a "System Prompt", neither of which the
  // API accepts — zod dropped them, so every campaign was created with no
  // persona linked and no rules, and the model fell back to generic defaults.
  // A client user has exactly one client and the API refuses any other, so it
  // is preselected rather than offered as a choice they could get wrong.
  const [formData, setFormData] = useState({
    clientId: ownClientId != null ? String(ownClientId) : "",
    name: "",
    channel: "lemlist" as "lemlist" | "meta" | "whatsapp" | "google" | "youtube",
    lemlistCampaignId: "",
    personaId: "",
    tone: "",
    replyRules: "",
    regionRules: "",
  });

  // useAuth resolves asynchronously, so the initial state above is empty on the
  // first render; this fills it in once the session is known. Without it a
  // client user submits no clientId and the API refuses the campaign.
  useEffect(() => {
    if (ownClientId != null) {
      setFormData((prev) => (prev.clientId ? prev : { ...prev, clientId: String(ownClientId) }));
    }
  }, [ownClientId]);

  // A persona belongs to one client, so the list is only meaningful once a
  // client is chosen — and offering another client's personas would create a
  // mapping that silently never matches.
  // The client's own plan usage, and their real Lemlist campaigns. Both are
  // client-scoped endpoints, so an operator (who has no client of their own)
  // gets nothing back and simply keeps the manual ID field.
  const { data: mySettings } = useMySettings();
  const { data: lemlistOptions, isFetching: lemlistLoading, refetch: refetchLemlist } =
    useLemlistCampaignOptions(!isOperator && !!mySettings?.lemlist.hasApiKey);
  const unmappedOptions = (lemlistOptions ?? []).filter(o => !o.mapped);

  const activeCount = campaigns?.filter(c => c.isActive).length ?? 0;
  const activeLimit = mySettings?.usage.activeCampaignLimit ?? null;
  const atCap = activeLimit != null && activeCount >= activeLimit;

  const toggleActive = (id: number, next: boolean) => {
    updateCampaign.mutate({ id, data: { isActive: next } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        toast({ title: next ? "Campaign is drafting replies" : "Campaign switched off" });
      },
      onError: (err: unknown) => {
        // The 422 body carries the plan wording; it is far more useful than a
        // generic failure, since the fix is "switch another one off".
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({
          title: next ? "Could not switch this on" : "Could not switch this off",
          description: msg ?? "Please try again.",
          variant: "destructive",
        });
      },
    });
  };

  const { data: allPersonas } = useListPersonas();
  // queryKey is passed explicitly because orval generates the options as
  // UseQueryOptions rather than a variant with queryKey omitted, so TanStack
  // requires it even though the hook derives the very same key itself.
  const personaParams = formData.clientId
    ? { clientId: parseInt(formData.clientId, 10) }
    : undefined;
  const { data: personas } = useListPersonas(personaParams, {
    query: {
      queryKey: getListPersonasQueryKey(personaParams),
      enabled: !!formData.clientId,
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCampaign.mutate({
      data: {
        clientId: parseInt(formData.clientId, 10),
        name: formData.name,
        channel: formData.channel,
        lemlistCampaignId: formData.lemlistCampaignId,
        ...(formData.personaId ? { personaId: parseInt(formData.personaId, 10) } : {}),
        ...(formData.tone.trim() ? { tone: formData.tone.trim() } : {}),
        ...(formData.replyRules.trim() ? { replyRules: formData.replyRules.trim() } : {}),
        ...(formData.regionRules.trim() ? { regionRules: formData.regionRules.trim() } : {}),
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setOpen(false);
        setFormData({ clientId: ownClientId != null ? String(ownClientId) : "", name: "", channel: "lemlist", lemlistCampaignId: "", personaId: "", tone: "", replyRules: "", regionRules: "" });
        toast({ title: "Campaign created" });
      },
      onError: () => {
        toast({ title: "Error creating campaign", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your cold email (Lemlist), Meta, Google Ads and YouTube lead forms, and WhatsApp to an AI sales persona. Switch one on to have it qualify leads and draft replies.
          </p>
          {activeLimit != null && (
            <Badge variant={atCap ? "destructive" : "outline"} className="mt-2 font-normal">
              {activeCount} of {activeLimit} campaigns drafting
              {atCap ? " — switch one off to free a slot" : ""}
            </Badge>
          )}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New Campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Connect a Campaign</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isOperator && (
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client</Label>
                  <Select value={formData.clientId} onValueChange={(val) => setFormData({ ...formData, clientId: val, personaId: "" })}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Campaign Name</Label>
                <Input id="name" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="channel">Lead source</Label>
                <Select
                  value={formData.channel}
                  onValueChange={(val) => setFormData({ ...formData, channel: val as typeof formData.channel, lemlistCampaignId: "" })}
                >
                  <SelectTrigger id="channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lemlist">Lemlist — cold email / LinkedIn replies</SelectItem>
                    <SelectItem value="meta">Meta — Facebook / Instagram lead ads</SelectItem>
                    <SelectItem value="google">Google Ads — lead forms</SelectItem>
                    <SelectItem value="youtube">YouTube — video ad lead forms</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp — inbound chats</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.channel === "lemlist" ? (
              <div className="space-y-2">
                <Label htmlFor="lemlistCampaignId">Lemlist campaign</Label>
                {/* Once a Lemlist key is saved we can list the real campaigns,
                    so nobody has to find an ID in Lemlist and paste it in — the
                    step where a typo produced a mapping that silently never
                    matched a reply. Falls back to the raw field when we have no
                    key, or when Lemlist cannot be reached. */}
                {unmappedOptions.length > 0 ? (
                  <>
                    <Select
                      value={formData.lemlistCampaignId}
                      onValueChange={(val) => {
                        const picked = unmappedOptions.find(o => o.id === val);
                        setFormData(prev => ({
                          ...prev,
                          lemlistCampaignId: val,
                          name: prev.name || picked?.name || "",
                        }));
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Pick one of your Lemlist campaigns" /></SelectTrigger>
                      <SelectContent>
                        {unmappedOptions.map(o => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => refetchLemlist()}
                      className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <RefreshCw className={`h-3 w-3 ${lemlistLoading ? "animate-spin" : ""}`} />
                      Refresh from Lemlist
                    </button>
                  </>
                ) : (
                  <>
                    <Input id="lemlistCampaignId" required value={formData.lemlistCampaignId} onChange={e => setFormData({ ...formData, lemlistCampaignId: e.target.value })} />
                    {!isOperator && !mySettings?.lemlist.hasApiKey && (
                      <p className="text-[11px] text-muted-foreground">
                        Save your Lemlist API key in <Link href="/settings" className="underline">Settings</Link> and
                        we will list your campaigns here instead.
                      </p>
                    )}
                    {!isOperator && mySettings?.lemlist.hasApiKey && lemlistOptions?.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">Lemlist returned no campaigns for this account.</p>
                    )}
                  </>
                )}
              </div>
              ) : (
              <div className="space-y-2">
                <Label htmlFor="lemlistCampaignId">
                  {formData.channel === "meta" ? "Meta lead form ID" : formData.channel === "whatsapp" ? "WhatsApp label" : "Google Ads lead form ID"}
                </Label>
                <Input
                  id="lemlistCampaignId"
                  required
                  placeholder={formData.channel === "whatsapp" ? "e.g. main-sales-line" : "e.g. 1234567890123456"}
                  value={formData.lemlistCampaignId}
                  onChange={e => setFormData({ ...formData, lemlistCampaignId: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  {formData.channel === "meta"
                    ? "Find it in Meta Ads Manager → Instant Forms. The ad ID or campaign ID also works. If you run only one Meta campaign here, every Meta lead goes to it."
                    : formData.channel === "whatsapp"
                      ? "Any name you like, or your WhatsApp phone number ID. If you run only one WhatsApp campaign here, every WhatsApp chat goes to it."
                      : `Find it in Google Ads → Assets → Lead forms. The campaign ID also works. If you run only one ${formData.channel === "youtube" ? "YouTube" : "Google Ads"} campaign here, every such lead goes to it.`}
                  {" "}The webhook URL is in <Link href="/settings" className="underline">Settings</Link>.
                </p>
              </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="personaId">Persona</Label>
                <Select
                  value={formData.personaId}
                  onValueChange={(val) => setFormData({ ...formData, personaId: val })}
                  disabled={!formData.clientId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={formData.clientId ? "Select persona" : "Pick a client first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {personas?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {formData.clientId && personas?.length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-500">
                    This client has no personas yet. Without one the drafts fall back to
                    generic wording — create a persona first.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tone">Tone <span className="text-muted-foreground font-normal text-[11px]">optional — overrides the persona's tone for this campaign</span></Label>
                <Input id="tone" placeholder="e.g. Warmer than usual, first-name basis" value={formData.tone} onChange={e => setFormData({ ...formData, tone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="replyRules">Reply rules <span className="text-muted-foreground font-normal text-[11px]">optional</span></Label>
                <Textarea
                  id="replyRules"
                  className="min-h-[80px]"
                  placeholder="What the reply must never do. e.g. Never quote a price — offer a call instead. Never promise a delivery date. Three paragraphs maximum."
                  value={formData.replyRules}
                  onChange={e => setFormData({ ...formData, replyRules: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regionRules">Region rules <span className="text-muted-foreground font-normal text-[11px]">optional</span></Label>
                <Input id="regionRules" placeholder="e.g. Australian market — informal, avoid US sales language" value={formData.regionRules} onChange={e => setFormData({ ...formData, regionRules: e.target.value })} />
              </div>
              <Button type="submit" className="w-full" disabled={createCampaign.isPending || !formData.clientId}>
                {createCampaign.isPending ? "Creating..." : "Connect Campaign"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center animate-pulse text-muted-foreground">Loading campaigns...</div>
        ) : campaigns?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No campaigns connected yet.</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-medium">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                {/* A client user has one client; the column repeats their own name
                    on every row, and its link goes to a page they cannot open. */}
                {isOperator && <th className="px-4 py-3">Client</th>}
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Persona</th>
                <th className="px-4 py-3 text-right">Replies</th>
                <th className="px-4 py-3 text-right">Drafting</th>
              </tr>
            </thead>
            <tbody className="divide-y border-t">
              {campaigns?.map(camp => {
                const client = clients?.find(c => c.id === camp.clientId);
                return (
                  <tr key={camp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/campaigns/${camp.id}`} className="hover:underline flex items-center gap-2">
                        <Megaphone className="h-4 w-4 text-muted-foreground" />
                        {camp.name}
                      </Link>
                    </td>
                    {isOperator && (
                      <td className="px-4 py-3">
                        {client ? <Link href={`/clients/${client.id}`} className="hover:underline">{client.name}</Link> : "Unknown"}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <LeadChannelBadge channel={camp.channel} />
                        <span className="font-mono text-xs text-muted-foreground">{camp.lemlistCampaignId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {camp.personaId ? (
                        allPersonas?.find(p => p.id === camp.personaId)?.name ?? `#${camp.personaId}`
                      ) : (
                        <span className="text-amber-600 dark:text-amber-500">No persona — generic drafts</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      <span className="inline-flex items-center justify-end gap-1">
                        {camp.replyCount || 0}
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* Switching off is always allowed; switching on is
                          blocked at the cap, and disabling the control says so
                          before the request fails rather than after. */}
                      <Switch
                        checked={!!camp.isActive}
                        onCheckedChange={(next) => toggleActive(camp.id, next)}
                        disabled={updateCampaign.isPending || (!camp.isActive && atCap)}
                        aria-label={`${camp.isActive ? "Switch off" : "Switch on"} ${camp.name}`}
                        title={!camp.isActive && atCap ? "Your plan's active campaigns are all in use" : undefined}
                        data-testid={`toggle-campaign-${camp.id}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
