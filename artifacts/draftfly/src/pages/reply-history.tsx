import { useListDrafts, useListCampaigns, useListClients } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DraftStatusBadge } from "@/components/status-badges";
import { Download, Link2, Check } from "lucide-react";
import { buildCSV } from "@/lib/csv-utils";

export function getInitialFilters(search: string) {
  const params = new URLSearchParams(search);
  return {
    status: params.get("status") || "all",
    client: params.get("clientId") || "all",
    campaign: params.get("campaignId") || "all",
  };
}

export function buildShareUrl(status: string, client: string, campaign: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (client !== "all") params.set("clientId", client);
  if (campaign !== "all") params.set("campaignId", campaign);
  const qs = params.toString();
  return `/reply-history${qs ? `?${qs}` : ""}`;
}

export default function ReplyHistoryPage() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const initial = getInitialFilters(search);
  const [statusFilter, setStatusFilter] = useState<string>(initial.status);
  const [campaignFilter, setCampaignFilter] = useState<string>(initial.campaign);
  const [clientFilter, setClientFilter] = useState<string>(initial.client);
  const [copied, setCopied] = useState(false);
  const isMounted = useRef(false);

  const syncToUrl = useCallback(
    (status: string, client: string, campaign: string) => {
      navigate(buildShareUrl(status, client, campaign), { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    syncToUrl(statusFilter, clientFilter, campaignFilter);
  }, [statusFilter, clientFilter, campaignFilter, syncToUrl]);

  function handleClientChange(v: string) {
    setClientFilter(v);
    setCampaignFilter("all");
    // Eagerly clear campaignId from the URL so a share taken immediately
    // after a client switch never encodes a campaign from the previous client.
    syncToUrl(statusFilter, v, "all");
  }

  const queryParams: Record<string, unknown> = {};
  if (statusFilter !== "all") queryParams.status = statusFilter;
  if (clientFilter !== "all") queryParams.clientId = parseInt(clientFilter, 10);
  if (campaignFilter !== "all") queryParams.campaignId = parseInt(campaignFilter, 10);

  const { data: drafts, isLoading } = useListDrafts(queryParams as any);
  const { data: campaigns } = useListCampaigns(clientFilter !== "all" ? { clientId: parseInt(clientFilter, 10) } : {});
  const { data: clients } = useListClients();
  const { isOperator } = useAuth();

  const sortedDrafts = drafts ? [...drafts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : [];

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function truncate(text: string, max = 120) {
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  const campaignMap = new Map(campaigns?.map((c) => [c.id, c.name]) ?? []);
  const clientMap = new Map(clients?.map((c) => [c.id, c.name]) ?? []);

  function exportToCSV() {
    const csvRows = sortedDrafts.map((draft) => {
      const finalText = draft.editedReplyText ?? draft.replyText;
      const campaignName = campaignMap.get(draft.campaignId) ?? `Campaign ${draft.campaignId}`;
      return {
        received: formatTime(draft.createdAt),
        leadName: draft.prospectName,
        leadEmail: draft.prospectEmail,
        campaign: campaignName,
        status: draft.status,
        draftText: finalText,
        actionedAt: draft.actionedAt ? formatTime(draft.actionedAt) : "",
      };
    });
    const csv = buildCSV(csvRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reply-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reply History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every Lemlist reply that triggered a Slack draft, with its final outcome.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            disabled={sortedDrafts.length === 0}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={copyShareLink}
            className="gap-1.5"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" />
                <span className="text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5" />
                Copy link
              </>
            )}
          </Button>

          {/* Filtering by client is only a choice an operator has. */}
          {isOperator && (
            <Select value={clientFilter} onValueChange={handleClientChange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns?.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="edited">Edited</SelectItem>
              <SelectItem value="discarded">Discarded</SelectItem>
              <SelectItem value="send_failed">Send Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
              <tr>
                <th className="px-4 py-3 w-40">Received</th>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3 w-36">Campaign</th>
                <th className="px-4 py-3 w-28">Status</th>
                <th className="px-4 py-3">Draft (final)</th>
              </tr>
            </thead>
            <tbody className="divide-y text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center animate-pulse text-muted-foreground">
                    Loading reply history…
                  </td>
                </tr>
              ) : sortedDrafts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No replies found matching the selected filters.
                  </td>
                </tr>
              ) : (
                sortedDrafts.map((draft) => {
                  const finalText = draft.editedReplyText ?? draft.replyText;
                  const campaignName = campaignMap.get(draft.campaignId) ?? `Campaign ${draft.campaignId}`;
                  const clientName = clientMap.get(draft.clientId);
                  return (
                    <tr key={draft.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono">
                        {formatTime(draft.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{draft.prospectName}</div>
                        <div className="text-muted-foreground">{draft.prospectEmail}</div>
                        {isOperator && clientName && (
                          <div className="text-[10px] text-muted-foreground/70 mt-0.5">{clientName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{campaignName}</td>
                      <td className="px-4 py-3">
                        <DraftStatusBadge status={draft.status as any} />
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        <div className="leading-relaxed">{truncate(finalText)}</div>
                        <Link
                          href={`/drafts/${draft.id}`}
                          className="mt-1 inline-block text-[10px] text-primary hover:underline"
                        >
                          View full draft →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {sortedDrafts.length > 0 && (
          <div className="px-4 py-2 border-t text-xs text-muted-foreground bg-muted/30">
            {sortedDrafts.length} {sortedDrafts.length === 1 ? "reply" : "replies"} found
          </div>
        )}
      </Card>
    </div>
  );
}
