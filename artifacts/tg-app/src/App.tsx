import { useState, useEffect, useCallback, useRef } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { useLang } from "@/hooks/use-lang";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
    Telegram?: {
      WebApp: {
        ready(): void;
        expand(): void;
        colorScheme: "light" | "dark";
        themeParams: Record<string, string>;
        initData: string;
        initDataUnsafe: { user?: { id?: number; first_name?: string } };
        HapticFeedback: {
          impactOccurred(style: "light" | "medium" | "heavy"): void;
          notificationOccurred(type: "error" | "success" | "warning"): void;
        };
      };
    };
  }
}

const BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

type DraftStatus = "pending" | "sent" | "edited" | "discarded" | "send_failed";

interface Draft {
  id: number;
  clientId: number;
  campaignId: number;
  prospectEmail: string;
  prospectName: string;
  prospectCompany?: string | null;
  prospectRole?: string | null;
  conversationSnippet?: string | null;
  replyText: string;
  editedReplyText?: string | null;
  status: DraftStatus;
  actionedAt?: string | null;
  createdAt: string;
}

interface DashboardStats {
  totalClients: number;
  activeCampaigns: number;
  pendingDrafts: number;
  totalSent: number;
  sentToday: number;
  successRate: number;
}

type Tab = "pending" | "history";

function StatsBar({ stats, tr }: { stats: DashboardStats; tr: ReturnType<typeof useLang>["tr"] }) {
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-value pending">{stats.pendingDrafts}</span>
        <span className="stat-label">{tr.pending}</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-value">{stats.sentToday ?? 0}</span>
        <span className="stat-label">{tr.sentToday}</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-value">{stats.totalSent}</span>
        <span className="stat-label">{tr.totalSent}</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-value accent">{stats.successRate}%</span>
        <span className="stat-label">{tr.successRate}</span>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  onAction,
  tr,
}: {
  draft: Draft;
  onAction: (id: number, action: string, editedText?: string) => void;
  tr: ReturnType<typeof useLang>["tr"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.replyText);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  const toggleVoice = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const rec = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) setEditText((prev) => prev + (prev.endsWith(" ") ? "" : " ") + transcript);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);

    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [isListening]);

  const initials = draft.prospectName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="draft-card">
      <div className="draft-header" onClick={() => !editing && setExpanded((e) => !e)}>
        <div className="prospect-avatar">{initials}</div>
        <div className="prospect-info">
          <div className="prospect-name">{draft.prospectName}</div>
          <div className="prospect-meta">
            {draft.prospectCompany && <span>{draft.prospectCompany}</span>}
            {draft.prospectRole && <span className="role"> · {draft.prospectRole}</span>}
          </div>
        </div>
        <div className="expand-icon">{expanded ? "▲" : "▼"}</div>
      </div>

      {!expanded && (
        <div className="reply-preview">
          {draft.replyText.slice(0, 120)}
          {draft.replyText.length > 120 ? "…" : ""}
        </div>
      )}

      {expanded && (
        <div className="reply-full">
          {draft.conversationSnippet && (
            <div className="snippet">
              <div className="snippet-label">THEIR MESSAGE</div>
              <div className="snippet-text">{draft.conversationSnippet}</div>
            </div>
          )}
          <div className="reply-label">AI DRAFT</div>
          {editing ? (
            <div className="edit-wrapper">
              <textarea
                className="reply-edit"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={8}
              />
              <button
                className={`mic-btn${isListening ? " mic-btn--active" : ""}`}
                onClick={toggleVoice}
                title={isListening ? tr.stopRecording : tr.dictateEdit}
                type="button"
              >
                {isListening ? "⏹" : "🎙"}
              </button>
              {isListening && <div className="mic-hint">{tr.listening}</div>}
            </div>
          ) : (
            <div className="reply-text">{draft.replyText}</div>
          )}
        </div>
      )}

      <div className="draft-actions">
        {editing ? (
          <>
            <button
              className="btn btn-send"
              onClick={() => {
                onAction(draft.id, "edit", editText);
                setEditing(false);
              }}
            >
              {tr.sendEdited}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              {tr.cancel}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-send" onClick={() => onAction(draft.id, "send")}>
              {tr.send}
            </button>
            <button
              className="btn btn-edit"
              onClick={() => {
                setExpanded(true);
                setEditing(true);
              }}
            >
              {tr.edit}
            </button>
            <button className="btn btn-discard" onClick={() => onAction(draft.id, "discard")}>
              {tr.discard}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryCard({ draft }: { draft: Draft }) {
  const statusColor: Record<DraftStatus, string> = {
    sent: "#22c55e",
    edited: "#6f9a45",
    discarded: "#ef4444",
    pending: "#f59e0b",
    send_failed: "#ef4444",
  };

  return (
    <div className="draft-card history">
      <div className="draft-header">
        <div className="prospect-avatar" style={{ opacity: 0.6 }}>
          {draft.prospectName
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="prospect-info">
          <div className="prospect-name">{draft.prospectName}</div>
          <div className="prospect-meta">
            {draft.prospectCompany && <span>{draft.prospectCompany}</span>}
          </div>
        </div>
        <span
          className="status-badge"
          style={{ color: statusColor[draft.status] ?? "#888" }}
        >
          {draft.status}
        </span>
      </div>
      <div className="reply-preview" style={{ opacity: 0.65 }}>
        {(draft.editedReplyText ?? draft.replyText).slice(0, 100)}…
      </div>
    </div>
  );
}

function AppInner() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, tr } = useLang();
  const [tab, setTab] = useState<Tab>("pending");

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["stats"],
    queryFn: () => apiFetch<DashboardStats>("/dashboard/stats"),
    refetchInterval: 15_000,
  });

  const { data: pending = [], isLoading: loadingPending } = useQuery<Draft[]>({
    queryKey: ["drafts", "pending"],
    queryFn: () => apiFetch<Draft[]>("/drafts/pending"),
    refetchInterval: 15_000,
    enabled: tab === "pending",
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery<Draft[]>({
    queryKey: ["drafts", "history"],
    queryFn: () => apiFetch<Draft[]>("/drafts?status=sent"),
    enabled: tab === "history",
  });

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
      editedText,
    }: {
      id: number;
      action: string;
      editedText?: string;
    }) =>
      apiFetch<Draft>(`/drafts/${id}/action`, {
        method: "PATCH",
        body: JSON.stringify({ action, editedReplyText: editedText }),
      }),
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      window.Telegram?.WebApp.HapticFeedback.notificationOccurred("success");
      toast({
        title: action === "send" ? tr.replySent : action === "edit" ? tr.editedSent : tr.discarded,
        duration: 2000,
      });
    },
    onError: () => {
      window.Telegram?.WebApp.HapticFeedback.notificationOccurred("error");
      toast({ title: "Action failed", variant: "destructive", duration: 3000 });
    },
  });

  const handleAction = useCallback(
    (id: number, action: string, editedText?: string) => {
      actionMutation.mutate({ id, action, editedText });
    },
    [actionMutation],
  );

  const userName = window.Telegram?.WebApp.initDataUnsafe?.user?.first_name;

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <img src={theme === "dark" ? "/logo-dark.png" : "/logo.png"} alt="DIM Convert" className="logo-img" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {userName && <span className="user-name">{tr.hiUser} {userName}</span>}
          {/* Theme toggle */}
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 2, gap: 2 }}>
            <button
              onClick={() => setTheme("light")}
              title="Light"
              style={{
                background: theme === "light" ? "var(--accent)" : "transparent",
                border: "none",
                borderRadius: 6,
                color: theme === "light" ? "#fff" : "var(--text-muted)",
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              ☀
            </button>
            <button
              onClick={() => setTheme("dark")}
              title="Dark"
              style={{
                background: theme === "dark" ? "var(--accent)" : "transparent",
                border: "none",
                borderRadius: 6,
                color: theme === "dark" ? "#fff" : "var(--text-muted)",
                width: 26,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              ☽
            </button>
          </div>
          {/* Lang toggle */}
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 2, gap: 2 }}>
            <button
              onClick={() => setLang("en")}
              style={{
                background: lang === "en" ? "var(--accent)" : "transparent",
                border: "none",
                borderRadius: 6,
                color: lang === "en" ? "#fff" : "var(--text-muted)",
                padding: "2px 7px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              EN
            </button>
            <button
              onClick={() => setLang("ru")}
              style={{
                background: lang === "ru" ? "var(--accent)" : "transparent",
                border: "none",
                borderRadius: 6,
                color: lang === "ru" ? "#fff" : "var(--text-muted)",
                padding: "2px 7px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              RU
            </button>
          </div>
        </div>
      </header>

      {stats && <StatsBar stats={stats} tr={tr} />}

      <div className="tab-bar">
        <button
          className={`tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          {tr.pending}
          {(stats?.pendingDrafts ?? 0) > 0 && (
            <span className="tab-badge">{stats!.pendingDrafts}</span>
          )}
        </button>
        <button
          className={`tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
        >
          {tr.sentHistory}
        </button>
      </div>

      <div className="draft-list">
        {tab === "pending" && (
          <>
            {loadingPending && <div className="loading">{tr.loadingDrafts}</div>}
            {!loadingPending && pending.length === 0 && (
              <div className="empty">
                <div className="empty-icon">✓</div>
                <div className="empty-title">{tr.allClear}</div>
                <div className="empty-sub">{tr.noPendingDrafts}</div>
              </div>
            )}
            {pending.map((d) => (
              <DraftCard key={d.id} draft={d} onAction={handleAction} tr={tr} />
            ))}
          </>
        )}

        {tab === "history" && (
          <>
            {loadingHistory && <div className="loading">{tr.loadingDrafts}</div>}
            {!loadingHistory && history.length === 0 && (
              <div className="empty">
                <div className="empty-sub">{tr.noHistory}</div>
              </div>
            )}
            {history.map((d) => (
              <HistoryCard key={d.id} draft={d} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

type AuthState = "loading" | "ok" | "denied" | "no-tg";

function TelegramAuthGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() =>
    window.Telegram?.WebApp ? "loading" : "no-tg"
  );

  useEffect(() => {
    if (auth !== "loading") return;
    const initData = window.Telegram?.WebApp.initData ?? "";

    if (!initData) {
      setAuth("no-tg");
      return;
    }

    fetch("/api/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then((r) => {
        if (r.ok) setAuth("ok");
        else if (r.status === 403) setAuth("denied");
        else setAuth("no-tg");
      })
      .catch(() => setAuth("no-tg"));
  }, [auth]);

  if (auth === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#121714" }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid #a9c97d", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (auth === "denied") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#121714", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Access denied</div>
        <div style={{ color: "#888", fontSize: 14 }}>Your account is not authorized to use DIM Convert.</div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    window.Telegram?.WebApp.ready();
    window.Telegram?.WebApp.expand();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TelegramAuthGate>
        <AppInner />
      </TelegramAuthGate>
      <Toaster />
    </QueryClientProvider>
  );
}
