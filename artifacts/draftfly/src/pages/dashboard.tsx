import { useGetDashboardStats, useListPendingDrafts, useListDrafts, useListActivity, useListClients, useListCampaigns, useGetReplyTrends, getListDraftsQueryKey, getListActivityQueryKey } from "@workspace/api-client-react";
import { SetupChecklist } from "@/components/setup-checklist";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useLocation, useSearch } from "wouter";
import {
  Users,
  Activity,
  Inbox,
  CheckCircle2,
  Megaphone,
  ArrowRight,
  Zap,
  Bot,
  MessageSquare,
  Link2,
  Loader2,
  TriangleAlert,
  AlertCircle,
  X,
  RefreshCw,
  Clock,
  Flame,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api-base";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{9,}$/;

/**
 * A channel that was filled in but is not a usable channel ID — a #name, a
 * leftover placeholder, a typo.
 *
 * A *blank* channel is deliberately not one of these. It used to be, back when
 * blank meant "falls through to the global channel" and every client needed one
 * of their own. Blank now means the client approves in the dashboard, which is
 * a finished configuration, not something to nag about.
 */
function isMisconfiguredChannel(channel: string | null | undefined): boolean {
  if (!channel) return false;
  return !SLACK_CHANNEL_ID_RE.test(channel);
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PLACEHOLDER_ACK_KEY = "draftfly_placeholder_ack";

function getAckedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PLACEHOLDER_ACK_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function ackIds(ids: string[]): void {
  try {
    const existing = getAckedIds();
    for (const id of ids) existing.add(id);
    localStorage.setItem(PLACEHOLDER_ACK_KEY, JSON.stringify([...existing]));
  } catch {
    // ignore storage errors
  }
}

interface IntegrationStatus {
  slack: { configured: boolean };
  lemlist: { configured: boolean };
  claude: { configured: boolean };
  n8n: { configured: boolean };
  database: { configured: boolean };
}

/**
 * `enabled` is false for a client user: the endpoint is operator-only and
 * would answer 403, so asking would only fill their console with errors for a
 * panel they are not shown.
 */
function useIntegrationStatus(enabled: boolean) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    fetch(`${API_BASE}/api/integrations/status`)
      .then((r) => r.json() as Promise<IntegrationStatus>)
      .then((s) => { setStatus(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, [enabled]);

  return { status, loading };
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: pendingDrafts, isLoading: draftsLoading } = useListPendingDrafts();
  const { data: failedDrafts, isLoading: failedLoading, refetch: refetchFailed } = useListDrafts({ status: "send_failed" });
  const { isOperator } = useAuth();
  // Operator-only. The feed is a per-lead trail of the reply pipeline, which
  // is useful across clients but on a client's own dashboard is a second copy
  // of what Draft Replies and Reply History already show, stamped with their
  // own name on every row. Not fetched for them at all, rather than fetched
  // and hidden.
  //
  // queryKey is passed explicitly because the generated options type is
  // UseQueryOptions rather than one with queryKey omitted, so it is required
  // even though the hook derives the same key itself.
  const { data: activity, isLoading: activityLoading } = useListActivity(
    { limit: 10 },
    { query: { queryKey: getListActivityQueryKey({ limit: 10 }), enabled: isOperator } },
  );
  const { status: integrations, loading: intLoading } = useIntegrationStatus(isOperator);
  const { data: clients } = useListClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/drafts/${id}/repost`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Retry failed", description: (body as any).error ?? `HTTP ${res.status}`, variant: "destructive" });
      } else {
        toast({ title: "Draft requeued", description: "A fresh Slack approval card has been posted." });
        queryClient.invalidateQueries({ queryKey: getListDraftsQueryKey({ status: "send_failed" }) });
        refetchFailed();
      }
    } catch {
      toast({ title: "Retry failed", description: "Network error — please try again.", variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  };

  const search = useSearch();
  const [location, navigate] = useLocation();

  const _searchParams = new URLSearchParams(search);
  const trendClientId = _searchParams.has("trendClientId")
    ? Number(_searchParams.get("trendClientId"))
    : undefined;
  const trendCampaignId = _searchParams.has("trendCampaignId")
    ? Number(_searchParams.get("trendCampaignId"))
    : undefined;

  function setTrendFilters(clientId: number | undefined, campaignId: number | undefined) {
    const params = new URLSearchParams(search);
    if (clientId !== undefined) {
      params.set("trendClientId", String(clientId));
    } else {
      params.delete("trendClientId");
    }
    if (campaignId !== undefined) {
      params.set("trendCampaignId", String(campaignId));
    } else {
      params.delete("trendCampaignId");
    }
    const qs = params.toString();
    navigate(`${location}${qs ? "?" + qs : ""}`);
  }

  const { data: allCampaigns } = useListCampaigns();
  const filteredCampaigns = trendClientId !== undefined
    ? (allCampaigns ?? []).filter((c) => c.clientId === trendClientId)
    : (allCampaigns ?? []);

  const { data: replyTrends, isLoading: trendsLoading } = useGetReplyTrends(
    Object.fromEntries(
      Object.entries({ clientId: trendClientId, campaignId: trendCampaignId }).filter(
        ([, v]) => v !== undefined
      )
    ) as { clientId?: number; campaignId?: number }
  );

  const loading = statsLoading || intLoading;

  const placeholderClients = (clients ?? []).filter((c) =>
    isMisconfiguredChannel(c.slackChannel)
  );

  // Slack counts as connected when OAuth is configured and no client is left
  // with a broken channel ID. A client with no channel at all is fine — that
  // is a choice, not an unfinished setup.
  const slackConnected =
    !!integrations?.slack.configured && placeholderClients.length === 0;

  // Banner is dismissed when every current placeholder ID has been acknowledged.
  // New placeholder clients (IDs not yet acked) break through the dismissal.
  const [ackedIds, setAckedIds] = useState<Set<string>>(() => getAckedIds());

  // Prune stale acks: remove any stored ID that is no longer a placeholder client
  // (the client was fixed or deleted). Runs once after the clients list loads.
  useEffect(() => {
    if (!clients) return;
    const currentPlaceholderIds = new Set(
      (clients ?? []).filter((c) => isMisconfiguredChannel(c.slackChannel)).map((c) => String(c.id))
    );
    const stored = getAckedIds();
    const pruned = new Set<string>();
    for (const id of stored) {
      if (currentPlaceholderIds.has(id)) pruned.add(id);
    }
    if (pruned.size !== stored.size) {
      try {
        localStorage.setItem(PLACEHOLDER_ACK_KEY, JSON.stringify([...pruned]));
      } catch {
        // ignore storage errors
      }
      setAckedIds(pruned);
    }
  }, [clients]);

  const unackedPlaceholders = placeholderClients.filter((c) => !ackedIds.has(String(c.id)));
  // Operator-only. It counts *clients*, links to client pages a client user
  // cannot open, and asks for a fix only an operator can make.
  const showBanner = isOperator && unackedPlaceholders.length > 0;

  function dismissBanner() {
    const ids = placeholderClients.map((c) => String(c.id));
    ackIds(ids);
    setAckedIds(getAckedIds());
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live overview of your leads across Lemlist, Meta and WhatsApp.
        </p>
      </div>

      {showBanner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <span className="font-semibold">
                {unackedPlaceholders.length} {unackedPlaceholders.length === 1 ? "client has" : "clients have"} an
                unrecognised Slack channel
              </span>{" "}
              — {unackedPlaceholders.length === 1 ? "it is" : "they are"} not a valid channel ID, so no approval card is posted. Fix the ID, or clear the field to approve in the dashboard only.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 pl-6 sm:pl-0">
            {unackedPlaceholders.slice(0, 3).map((c) => (
              <Button key={c.id} variant="outline" size="sm" asChild
                className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs h-7">
                <Link href={`/clients/${c.id}`}>{c.name}</Link>
              </Button>
            ))}
            {unackedPlaceholders.length > 3 && (
              <Button variant="outline" size="sm" asChild
                className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs h-7">
                <Link href="/clients">+{unackedPlaceholders.length - 3} more</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss warning"
              onClick={dismissBanner}
              className="h-7 w-7 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0 ml-1"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {!isOperator && <SetupChecklist />}

      {/* KPI Cards. "Total Clients" counts a client user's own single client,
          so it always reads 1 for them — a number that says nothing and frames
          the page as the operator's roster rather than their own account. */}
      <div className={`grid grid-cols-2 gap-4 ${isOperator ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {isOperator && (
          <KpiCard
            title="Total Clients"
            value={stats?.totalClients}
            icon={Users}
            loading={loading}
          />
        )}
        <KpiCard
          title="Active Campaigns"
          value={stats?.activeCampaigns}
          icon={Megaphone}
          loading={loading}
        />
        <KpiCard
          title="Leads Awaiting Reply"
          value={stats?.pendingDrafts}
          icon={Inbox}
          loading={loading}
          alert={!!stats?.pendingDrafts && stats.pendingDrafts > 0}
        />
        <KpiCard
          title="Send Failed"
          value={stats?.sendFailedDrafts}
          icon={AlertCircle}
          loading={loading}
          variant={!!stats?.sendFailedDrafts && stats.sendFailedDrafts > 0 ? "error" : "default"}
          href="/drafts?status=send_failed"
        />
        <KpiCard
          title="Total Sent"
          value={stats?.totalDraftsSent}
          icon={CheckCircle2}
          loading={loading}
        />
      </div>

      {/* Hot leads — what a sales team should look at first. */}
      {(() => {
        const hot = pendingDrafts?.filter((d) => d.qualification === "hot").length ?? 0;
        if (hot === 0) return null;
        return (
          <Link
            href="/drafts?status=pending"
            className="flex items-center gap-3 rounded-lg border border-sage/60 bg-mist px-4 py-3 text-sm text-forest hover:bg-mist/70 dark:bg-sage/10 dark:text-foreground dark:hover:bg-sage/15 transition-colors"
            data-testid="hot-leads-banner"
          >
            <Flame className="h-4 w-4 text-forest dark:text-sage shrink-0" />
            <span>
              <span className="font-semibold">{hot} hot {hot === 1 ? "lead is" : "leads are"} waiting for a reply</span>
              <span className="opacity-70"> — budget and timeline confirmed. Reply while they're warm.</span>
            </span>
          </Link>
        );
      })()}

      {/* Reply Trends Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle className="text-base font-semibold">Lead Volume — Last 30 Days</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Choosing between clients is only meaningful for an operator.
                  A client user has exactly one, so the control offers them a
                  choice they do not have. */}
              {isOperator && (
                <Select
                  value={trendClientId !== undefined ? String(trendClientId) : "all"}
                  onValueChange={(v) => {
                    setTrendFilters(v === "all" ? undefined : Number(v), undefined);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-36">
                    <SelectValue placeholder="All clients" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {(clients ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={trendCampaignId !== undefined ? String(trendCampaignId) : "all"}
                onValueChange={(v) => {
                  setTrendFilters(trendClientId, v === "all" ? undefined : Number(v));
                }}
                disabled={filteredCampaigns.length === 0}
              >
                <SelectTrigger className="h-7 text-xs w-40">
                  <SelectValue placeholder="All campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All campaigns</SelectItem>
                  {filteredCampaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trendsLoading ? (
            <div className="h-52 bg-muted/40 animate-pulse rounded-md" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={replyTrends ?? []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v + "T00:00:00");
                    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  }}
                  interval={4}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(label: string) => {
                    const d = new Date(label + "T00:00:00");
                    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="sent" name="Sent" stackId="a" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="edited" name="Edited" stackId="a" fill="hsl(217 91% 60%)" />
                <Bar dataKey="pending" name="Pending" stackId="a" fill="hsl(38 92% 50%)" />
                <Bar dataKey="discarded" name="Discarded" stackId="a" fill="hsl(0 0% 60%)" />
                <Bar dataKey="send_failed" name="Send Failed" stackId="a" fill="hsl(0 84% 60%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className={`grid grid-cols-1 gap-5 ${isOperator ? "lg:grid-cols-3" : ""}`}>
        {/* Left column */}
        <div className={`space-y-5 ${isOperator ? "lg:col-span-2" : ""}`}>

          {/* Workflow Status — how OUR integrations are wired. A client has no
              account with Lemlist-the-vendor or n8n through us and cannot act
              on any of it, so it is operator-only. */}
          {isOperator && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Workflow Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1 sm:gap-0">
                <WorkflowStep
                  name="Lemlist"
                  icon={Link2}
                  connected={integrations?.lemlist.configured}
                  loading={intLoading}
                  description="Webhook source"
                />
                <ChainArrow />
                <WorkflowStep
                  name="n8n"
                  icon={Zap}
                  connected={integrations?.n8n.configured}
                  loading={intLoading}
                  description="Orchestration"
                />
                <ChainArrow />
                <WorkflowStep
                  name="Claude"
                  icon={Bot}
                  connected={integrations?.claude.configured}
                  loading={intLoading}
                  description="AI draft"
                />
                <ChainArrow />
                <WorkflowStep
                  name="Slack"
                  icon={MessageSquare}
                  connected={slackConnected}
                  loading={intLoading}
                  description="Operator approval"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 text-center text-sm pt-1">
                <div>
                  <div className="font-semibold text-xl tabular-nums">
                    {loading ? <span className="text-muted-foreground/40">—</span> : (stats?.webhooksToday ?? 0)}
                  </div>
                  <div className="text-muted-foreground text-xs">Webhooks Today</div>
                </div>
                <div>
                  <div className="font-semibold text-xl tabular-nums">
                    {loading ? <span className="text-muted-foreground/40">—</span> : `${Math.round((stats?.successRate ?? 0) * 100)}%`}
                  </div>
                  <div className="text-muted-foreground text-xs">Success Rate</div>
                </div>
                <div>
                  <div className="font-semibold text-xl tabular-nums">
                    {loading ? <span className="text-muted-foreground/40">—</span> : (stats?.totalDraftsDiscarded ?? 0)}
                  </div>
                  <div className="text-muted-foreground text-xs">Discarded</div>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Requires Action — Pending */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">Requires Action</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/drafts">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {draftsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-14 bg-muted/50 animate-pulse rounded-md" />
                  ))}
                </div>
              ) : (pendingDrafts?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <CheckCircle2 className="mx-auto h-7 w-7 mb-2 opacity-20" />
                  <p>No pending drafts to review.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingDrafts?.slice(0, 5).map((draft) => (
                    <div
                      key={draft.id}
                      className="flex items-center justify-between p-3 border border-border rounded-md bg-card hover:bg-accent/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {draft.prospectName}{" "}
                          {/* A WhatsApp lead rarely has a company — show nothing rather than "()". */}
                          {draft.prospectCompany && (
                            <span className="text-muted-foreground font-normal">({draft.prospectCompany})</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                          {draft.replyText}
                        </div>
                      </div>
                      <Button size="sm" asChild className="shrink-0 ml-3">
                        <Link href={`/drafts/${draft.id}`}>Review</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failed Drafts — needs retry */}
          {((failedDrafts?.length ?? 0) > 0 || failedLoading) && (
            <Card className="border-orange-300/60 dark:border-orange-800/60">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-orange-700 dark:text-orange-400">
                  <AlertCircle className="h-4 w-4" />
                  Failed — Needs Retry
                  {(failedDrafts?.length ?? 0) > 0 && (
                    <span className="ml-1 text-xs font-mono bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 rounded-full">
                      {failedDrafts!.length}
                    </span>
                  )}
                </CardTitle>
                <Button variant="ghost" size="sm" asChild className="text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30">
                  <Link href="/drafts?status=send_failed">View all</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {failedLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-14 bg-muted/50 animate-pulse rounded-md" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {failedDrafts?.slice(0, 3).map((draft) => {
                      const isAutoFailed = !!draft.sweeperAlertedAt;
                      return (
                        <div
                          key={draft.id}
                          className="flex items-center justify-between p-3 border border-orange-200 dark:border-orange-900/50 rounded-md bg-orange-50/50 dark:bg-orange-950/20"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">
                              {draft.prospectName}{" "}
                              {/* A WhatsApp lead rarely has a company — show nothing rather than "()". */}
                              {draft.prospectCompany && (
                                <span className="text-muted-foreground font-normal">({draft.prospectCompany})</span>
                              )}
                            </div>
                            <div className="text-xs text-orange-600 dark:text-orange-400 mt-0.5 flex items-center gap-1">
                              {isAutoFailed ? (
                                <><Clock className="h-3 w-3" /> Timed out — auto-failed by sweeper</>
                              ) : (
                                <>Send failed — Slack post error</>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40 h-7 text-xs gap-1"
                              onClick={() => handleRetry(draft.id)}
                              disabled={retryingId === draft.id}
                            >
                              <RefreshCw className={`h-3 w-3 ${retryingId === draft.id ? "animate-spin" : ""}`} />
                              {retryingId === draft.id ? "Retrying…" : "Retry"}
                            </Button>
                            <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                              <Link href={`/drafts/${draft.id}`}>View</Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Recent Activity (operator only) */}
        {isOperator && (
        <div>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 bg-muted/50 animate-pulse rounded-md" />
                  ))}
                </div>
              ) : (activity?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
                  <Activity className="mx-auto h-7 w-7 opacity-20" />
                  <p>No activity yet.</p>
                  <p className="text-xs">Events will appear once the pipeline starts processing replies.</p>
                </div>
              ) : (
                <div className="space-y-0 divide-y divide-border -mx-6 px-0">
                  {activity?.map((item) => (
                    <div key={item.id} className="flex gap-3 text-sm px-6 py-2.5">
                      <div className="mt-2 shrink-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-foreground leading-snug text-xs">{item.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(item.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {item.clientName && ` · ${item.clientName}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon: Icon,
  loading,
  alert,
  variant = "default",
  href,
}: {
  title: string;
  value?: number;
  icon: React.ElementType;
  loading: boolean;
  alert?: boolean;
  variant?: "default" | "error";
  href?: string;
}) {
  const isError = variant === "error";
  const isAlert = alert || isError;

  const card = (
    <Card
      className={[
        isError ? "border-orange-400 dark:border-orange-700/70" : "",
        alert && !isError ? "border-amber-300 dark:border-amber-900/60" : "",
        href ? "cursor-pointer hover:bg-accent/30 transition-colors" : "",
      ].filter(Boolean).join(" ")}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            isError ? "text-orange-500" : isAlert ? "text-amber-500" : "text-muted-foreground/60"
          }`}
        />
      </CardHeader>
      <CardContent className="pt-1 pb-4 px-4">
        {loading ? (
          <div className="h-7 w-12 bg-muted animate-pulse rounded" />
        ) : (
          <div
            className={`text-2xl font-bold tabular-nums ${
              isError ? "text-orange-600 dark:text-orange-400" : isAlert ? "text-amber-600 dark:text-amber-500" : ""
            }`}
          >
            {value ?? 0}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }
  return card;
}

function WorkflowStep({
  name,
  icon: Icon,
  connected,
  loading,
  description,
}: {
  name: string;
  icon: React.ElementType;
  connected?: boolean;
  loading: boolean;
  description: string;
}) {
  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center gap-1 px-2 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-md transition-colors">
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-semibold border ${
          connected
            ? "bg-primary/10 text-primary border-primary/30 dark:bg-primary/20"
            : "bg-muted/40 text-muted-foreground border-border"
        }`}
      >
        <Icon className="h-3 w-3" />
        {name}
      </div>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{description}</p>
      <span
        className={`text-[9px] font-mono font-semibold uppercase tracking-wider ${
          connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50"
        }`}
      >
        {connected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}

function ChainArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground/30 px-0.5 shrink-0 self-start mt-4 sm:self-center sm:mt-0">
      <ArrowRight className="h-3.5 w-3.5 hidden sm:block" />
      <div className="w-px h-3 bg-border block sm:hidden mx-auto" />
    </div>
  );
}
