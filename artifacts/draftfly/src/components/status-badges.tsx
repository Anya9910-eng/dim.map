import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

export function DraftStatusBadge({
  status,
  autoFailed,
}: {
  status: "pending" | "sent" | "edited" | "discarded" | "send_failed" | "escalated";
  autoFailed?: boolean;
}) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary" className="bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-900/50">Pending</Badge>;
    case "sent":
      return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 hover:bg-green-50 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900/50">Sent</Badge>;
    case "edited":
      return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-900/50">Edited</Badge>;
    case "discarded":
      return <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200 hover:bg-red-50 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900/50">Discarded</Badge>;
    case "send_failed":
      if (autoFailed) {
        return (
          <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-900/50 gap-1">
            <Clock className="h-3 w-3" />
            Timed out — auto-failed
          </Badge>
        );
      }
      return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-900/50">Send Failed</Badge>;
    // Set by the Slack "Escalate" action. It was missing here, so such a draft
    // fell through to the default and rendered the raw enum value — a lowercase
    // "escalated" chip among properly labelled ones.
    case "escalated":
      return <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-900/50">Escalated</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function ClientModeBadge({ mode }: { mode: "draft" | "auto" }) {
  if (mode === "auto") {
    return <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-900/50">Auto</Badge>;
  }
  return <Badge variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">Draft</Badge>;
}

export function LogLevelBadge({ level }: { level: "info" | "warning" | "error" }) {
  switch (level) {
    case "info":
      return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50/50 dark:text-blue-400 dark:border-blue-900/50 dark:bg-transparent">Info</Badge>;
    case "warning":
      return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50/50 dark:text-amber-400 dark:border-amber-900/50 dark:bg-transparent">Warn</Badge>;
    case "error":
      return <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50/50 dark:text-red-400 dark:border-red-900/50 dark:bg-transparent">Error</Badge>;
    default:
      return <Badge variant="outline">{level}</Badge>;
  }
}

export function ClientBillingBadge({
  status,
  trialDaysLeft,
}: {
  status?: "managed" | "trial" | "active" | "past_due" | "locked";
  trialDaysLeft?: number | null;
}) {
  // The field is optional in the shared Client schema; the list and detail
  // endpoints always send it, but render nothing rather than crash if absent.
  if (!status) return null;
  switch (status) {
    case "managed":
      // Operator-billed. Deliberately muted — it is the norm for hand-set-up
      // clients and needs no attention.
      return <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">Managed</Badge>;
    case "trial": {
      const label = trialDaysLeft != null ? `Trial — ${trialDaysLeft}d left` : "Trial";
      return <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-900/50">{label}</Badge>;
    }
    case "active":
      return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 hover:bg-green-50 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900/50">Subscribed</Badge>;
    case "past_due":
      return <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900/50">Payment failed</Badge>;
    case "locked":
      return <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200 hover:bg-red-50 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900/50">Lapsed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
