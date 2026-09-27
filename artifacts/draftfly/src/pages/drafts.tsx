import { useListDrafts, useListClients, useApplyDraftAction, getListDraftsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useSearch } from "wouter";
import { DraftStatusBadge, LeadChannelBadge, LeadQualificationBadge } from "@/components/status-badges";
import { ConversationMessage } from "@/components/conversation-message";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Clock, Mail, RefreshCw, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api-base";

const VALID_STATUSES = new Set(["pending", "sent", "edited", "discarded", "send_failed", "escalated"]);
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getInitialStatus(search: string): string {
  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "";
  return VALID_STATUSES.has(status) ? status : "all";
}

export default function DraftsPage() {
  const search = useSearch();
  const [statusFilter, setStatusFilter] = useState<string>(() => getInitialStatus(search));
  const [clientFilter, setClientFilter] = useState<string>("all");
  // Channel and grade are narrowed here rather than on the server: the list is
  // already scoped to one client's drafts, and this keeps the API unchanged.
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [qualificationFilter, setQualificationFilter] = useState<string>("all");
  const [retryingId, setRetryingId] = useState<number | null>(null);
  
  const queryParams: any = {};
  if (statusFilter !== "all") queryParams.status = statusFilter;
  if (clientFilter !== "all") queryParams.clientId = parseInt(clientFilter, 10);

  const { data: allDrafts, isLoading, refetch } = useListDrafts(queryParams);
  const drafts = allDrafts?.filter((d) =>
    (channelFilter === "all" || (d.channel ?? "lemlist") === channelFilter) &&
    (qualificationFilter === "all" || d.qualification === qualificationFilter),
  );
  const { data: clients } = useListClients();
  const applyAction = useApplyDraftAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAction = (id: number, action: "send" | "discard") => {
    applyAction.mutate({ id, data: { action } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDraftsQueryKey(queryParams) });
        toast({ title: `Draft ${action === 'send' ? 'sent' : 'discarded'}` });
      },
      onError: (err) => {
        queryClient.invalidateQueries({ queryKey: getListDraftsQueryKey(queryParams) });
        toast({ title: `Could not ${action} this draft`, description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      },
    });
  };

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/drafts/${id}/repost`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Retry failed", description: (body as any).error ?? `HTTP ${res.status}`, variant: "destructive" });
      } else {
        toast({ title: "Draft requeued", description: "A fresh Slack approval card has been posted." });
        queryClient.invalidateQueries({ queryKey: getListDraftsQueryKey(queryParams) });
        refetch();
      }
    } catch {
      toast({ title: "Retry failed", description: "Network error — please try again.", variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">Every lead from Lemlist, Meta and WhatsApp — qualified by AI, with a reply drafted and ready to approve.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="lemlist">Lemlist</SelectItem>
              <SelectItem value="meta">Meta Ads</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
          <Select value={qualificationFilter} onValueChange={setQualificationFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Leads" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leads</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
              <SelectItem value="unqualified">Unqualified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="edited">Edited</SelectItem>
              <SelectItem value="discarded">Discarded</SelectItem>
              <SelectItem value="send_failed">Send Failed</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <Card key={i} className="h-32 animate-pulse" />)
        ) : drafts?.length === 0 ? (
          <div className="p-12 text-center border rounded-lg bg-card text-muted-foreground">
            <Mail className="mx-auto h-12 w-12 opacity-20 mb-4" />
            <p>Inbox zero. No leads match your filters.</p>
          </div>
        ) : (
          drafts?.map(draft => {
            const isAutoFailed = !!draft.sweeperAlertedAt;
            const isSendFailed = draft.status === "send_failed";
            return (
              <Card key={draft.id} className={`overflow-hidden transition-all ${draft.status === 'pending' ? 'border-primary/30 shadow-sm' : isSendFailed ? 'border-orange-300/50 dark:border-orange-800/50' : 'opacity-80'}`}>
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    <div className="flex-1 p-5">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base">{draft.prospectName}</span>
                          <span className="text-sm text-muted-foreground">{draft.prospectCompany}</span>
                          <LeadChannelBadge channel={draft.channel} />
                          <LeadQualificationBadge qualification={draft.qualification} reason={draft.qualificationReason} />
                          <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full ml-2 font-mono">
                            {clients?.find(c => c.id === draft.clientId)?.name}
                          </span>
                        </div>
                        <DraftStatusBadge status={draft.status as any} autoFailed={isAutoFailed} />
                      </div>
                      
                      {(draft.prospectEmail || draft.prospectPhone) && (
                        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                          {draft.prospectEmail && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{draft.prospectEmail}</span>}
                          {draft.prospectPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />+{draft.prospectPhone}</span>}
                        </div>
                      )}
                      {draft.qualificationReason && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">Why: </span>{draft.qualificationReason}
                        </p>
                      )}

                      {/* The reply the lead actually sent. Approving a draft
                          without it means judging an answer to a question you
                          cannot see. */}
                      {draft.conversationSnippet && (
                        <div className="mt-3 text-sm">
                          <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                            Their message
                          </div>
                          <ConversationMessage
                            text={draft.conversationSnippet}
                            className="p-3 border-l-2 border-muted-foreground/30 bg-muted/20 rounded-r-md text-muted-foreground"
                          />
                        </div>
                      )}

                      <div className="mt-3 text-sm">
                        <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">AI Suggested Reply</div>
                        <div className="p-3 bg-muted/40 border rounded-md whitespace-pre-wrap font-sans text-foreground">
                          {draft.editedReplyText || draft.replyText}
                        </div>
                      </div>
                    </div>
                    
                    <div className="md:w-[220px] p-5 md:border-l flex flex-col justify-center gap-2 bg-muted/10">
                      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(draft.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      
                      {draft.status === "pending" ? (
                        <>
                          <Button className="w-full justify-center" onClick={() => handleAction(draft.id, "send")} disabled={applyAction.isPending}>
                            <Check className="h-4 w-4 mr-2" /> Send
                          </Button>
                          <Button variant="outline" className="w-full justify-center" asChild>
                            <Link href={`/drafts/${draft.id}`}>Edit</Link>
                          </Button>
                          <Button variant="ghost" className="w-full justify-center text-destructive hover:bg-destructive/10" onClick={() => handleAction(draft.id, "discard")} disabled={applyAction.isPending}>
                            <X className="h-4 w-4 mr-2" /> Discard
                          </Button>
                        </>
                      ) : isSendFailed ? (
                        <>
                          <Button
                            className="w-full justify-center"
                            variant="outline"
                            onClick={() => handleRetry(draft.id)}
                            disabled={retryingId === draft.id}
                          >
                            <RefreshCw className={`h-4 w-4 mr-2 ${retryingId === draft.id ? "animate-spin" : ""}`} />
                            {retryingId === draft.id ? "Retrying…" : "Retry"}
                          </Button>
                          <Button variant="ghost" className="w-full" asChild>
                            <Link href={`/drafts/${draft.id}`}>View Details</Link>
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" className="w-full" asChild>
                          <Link href={`/drafts/${draft.id}`}>View Details</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
