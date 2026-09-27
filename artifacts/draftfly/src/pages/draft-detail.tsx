import { useGetDraft, useApplyDraftAction, getGetDraftQueryKey, useListActivity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, X, Send, User, Building, Mail, RefreshCw, Clock, Activity, Phone, Flame } from "lucide-react";
import { DraftStatusBadge, LeadChannelBadge, LeadQualificationBadge } from "@/components/status-badges";
import { ConversationMessage } from "@/components/conversation-message";
import { API_BASE } from "@/lib/api-base";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ACTIVITY_ICONS: Record<string, string> = {
  draft_created: "📝",
  draft_sent: "✅",
  draft_edited: "✏️",
  draft_discarded: "🗑️",
  draft_send_failed: "⚠️",
  webhook_received: "🔔",
  error: "❌",
};

export default function DraftDetail() {
  const { id } = useParams();
  const draftId = parseInt(id || "0", 10);
  
  const { data: draft, isLoading } = useGetDraft(draftId, { query: { enabled: !!draftId, queryKey: getGetDraftQueryKey(draftId) } });
  const { data: draftActivity, isLoading: activityLoading } = useListActivity(
    { draftId, limit: 20 },
    { query: { enabled: !!draftId, queryKey: ["activity", "draft", draftId] } }
  );
  const applyAction = useApplyDraftAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editText, setEditText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (draft && !isEditing) {
      setEditText(draft.editedReplyText || draft.replyText);
    }
  }, [draft, isEditing]);

  const handleAction = (action: "send" | "edit" | "discard") => {
    const payload: any = { action };
    if (action === "edit") {
      payload.editedText = editText;
    }
    
    applyAction.mutate({ id: draftId, data: payload }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetDraftQueryKey(draftId), updated);
        setIsEditing(false);
        toast({ title: `Draft ${action === 'edit' ? 'edited' : action + 't'}` });
      },
      // The server says why — e.g. WhatsApp sending not set up yet.
      onError: (err) => {
        toast({ title: "Failed to apply action", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      }
    });
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`${API_BASE}/api/drafts/${draftId}/repost`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Retry failed", description: (body as any).error ?? `HTTP ${res.status}`, variant: "destructive" });
      } else {
        toast({ title: "Draft requeued", description: "A fresh Slack approval card has been posted." });
        queryClient.invalidateQueries({ queryKey: getGetDraftQueryKey(draftId) });
      }
    } catch {
      toast({ title: "Retry failed", description: "Network error — please try again.", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading draft...</div>;
  if (!draft) return <div className="p-8 text-center text-muted-foreground">Draft not found.</div>;

  const isPending = draft.status === "pending";
  const isSendFailed = draft.status === "send_failed";
  const isAutoFailed = !!draft.sweeperAlertedAt;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/drafts"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Review Reply</h1>
              <DraftStatusBadge status={draft.status as any} autoFailed={isAutoFailed} />
              <LeadChannelBadge channel={draft.channel} />
              <LeadQualificationBadge qualification={draft.qualification} reason={draft.qualificationReason} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">Generated {new Date(draft.createdAt).toLocaleString()}</p>
          </div>
        </div>
        {isSendFailed && (
          <Button onClick={handleRetry} disabled={retrying} variant="outline" className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30">
            <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry — Repost to Slack"}
          </Button>
        )}
      </div>

      {isSendFailed && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${isAutoFailed ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200" : "border-orange-200 bg-orange-50/60 text-orange-700 dark:border-orange-900 dark:bg-orange-950/20 dark:text-orange-300"}`}>
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              {isAutoFailed
                ? "This draft was automatically moved to send_failed by the sweeper because no operator acted on the Slack approval card within the configured time limit."
                : "This draft failed to send. Click Retry to re-post the Slack approval card so an operator can approve it again."}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Lead Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><User className="h-4 w-4" /></div>
                <div>
                  <div className="font-medium">{draft.prospectName}</div>
                  <div className="text-muted-foreground text-xs">Name</div>
                </div>
              </div>
              {draft.prospectCompany && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Building className="h-4 w-4" /></div>
                  <div>
                    <div className="font-medium">{draft.prospectCompany}</div>
                    <div className="text-muted-foreground text-xs">Company</div>
                  </div>
                </div>
              )}
              {draft.prospectEmail && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Mail className="h-4 w-4" /></div>
                  <div>
                    <div className="font-medium">{draft.prospectEmail}</div>
                    <div className="text-muted-foreground text-xs">Email</div>
                  </div>
                </div>
              )}
              {draft.prospectPhone && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Phone className="h-4 w-4" /></div>
                  <div>
                    <div className="font-medium">+{draft.prospectPhone}</div>
                    <div className="text-muted-foreground text-xs">Phone / WhatsApp</div>
                  </div>
                </div>
              )}
              {draft.qualification && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0"><Flame className="h-4 w-4" /></div>
                  <div>
                    <LeadQualificationBadge qualification={draft.qualification} />
                    {draft.qualificationReason && <div className="text-muted-foreground text-xs mt-1">{draft.qualificationReason}</div>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Draft Activity History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <div key={i} className="h-10 bg-muted/50 animate-pulse rounded-md" />)}
                </div>
              ) : (draftActivity?.length ?? 0) === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">No activity recorded yet.</div>
              ) : (
                <div className="space-y-3">
                  {draftActivity?.map((item) => (
                    <div key={item.id} className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">{ACTIVITY_ICONS[item.type] ?? "•"}</span>
                      <div className="min-w-0">
                        <p className="text-xs text-foreground leading-snug">{item.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(item.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 bg-muted/20 border-b">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Conversation Context</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ConversationMessage
                text={draft.conversationSnippet || "No conversation history available."}
                className="text-sm p-4 bg-muted/30 border rounded-md font-serif italic text-muted-foreground"
              />
            </CardContent>
          </Card>

          <Card className={isPending ? "border-primary/50 shadow-md" : isSendFailed ? "border-orange-300/60 dark:border-orange-800/60" : ""}>
            <CardHeader className="pb-3 bg-muted/20 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Generated Reply</CardTitle>
              {isPending && !isEditing && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>Edit Text</Button>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              {isEditing ? (
                <Textarea 
                  className="min-h-[200px] text-base leading-relaxed" 
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  autoFocus
                />
              ) : (
                <div className="text-base whitespace-pre-wrap leading-relaxed">
                  {draft.editedReplyText || draft.replyText}
                </div>
              )}
            </CardContent>
            
            {isPending && (
              <CardFooter className="border-t bg-muted/10 pt-4 flex justify-between gap-3">
                {isEditing ? (
                  <>
                    <Button variant="ghost" onClick={() => { setIsEditing(false); setEditText(draft.editedReplyText || draft.replyText); }}>Cancel</Button>
                    <Button onClick={() => handleAction("edit")} disabled={applyAction.isPending}><Check className="h-4 w-4 mr-2" /> Save & Mark Edited</Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="text-destructive hover:bg-destructive/10 border-destructive/20" onClick={() => handleAction("discard")} disabled={applyAction.isPending}>
                      <X className="h-4 w-4 mr-2" /> Discard
                    </Button>
                    <Button className="flex-1" onClick={() => handleAction("send")} disabled={applyAction.isPending}>
                      <Send className="h-4 w-4 mr-2" /> Approve & Send
                    </Button>
                  </>
                )}
              </CardFooter>
            )}

            {isSendFailed && (
              <CardFooter className="border-t bg-muted/10 pt-4">
                <Button onClick={handleRetry} disabled={retrying} className="w-full gap-2">
                  <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
                  {retrying ? "Retrying…" : "Retry — Repost Slack Approval Card"}
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
