import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { API_BASE } from "@/lib/api-base";
import {
  Play,
  CheckCircle2,
  Pencil,
  Trash2,
  Send,
  MessageSquare,
  Zap,
  Bot,
  Hash,
  Clock,
  AlertTriangle,
  ArrowRight,
  User,
  Globe,
  FileText,
  Activity,
  Loader2,
  XCircle,
  Database,
  RefreshCw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbClient {
  id: number;
  name: string;
  slackChannel: string;
}

interface DbCampaign {
  id: number;
  clientId: number;
  name: string;
  lemlistCampaignId: string | null;
  isActive: boolean;
}

interface FormFields {
  clientId: string;
  campaignId: string;
  leadName: string;
  leadCompany: string;
  leadRole: string;
  leadCountry: string;
  incomingReply: string;
}

interface SimulateResult {
  ok: boolean;
  draftId?: number;
  generatedDraft?: string;
  confidenceScore?: number;
  detectedIntent?: string;
  suggestedNextAction?: string;
  slackTs?: string | null;
  error?: string;
}

type Decision = "send" | "edit" | "discard" | null;

interface LogEntry {
  ts: string;
  step: string;
  detail: string;
  ok: boolean;
}

type FlowStage = "idle" | "running" | "approval" | "done";

const STEPS = [
  { id: "webhook", label: "Lemlist Webhook" },
  { id: "campaign", label: "Campaign Detection" },
  { id: "persona", label: "Persona Selection" },
  { id: "region", label: "Regional Tone" },
  { id: "draft", label: "Claude Draft" },
  { id: "slack", label: "Lead Inbox Approval" },
  { id: "done", label: "Final Status" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function TestFlow() {
  const [clients, setClients] = useState<DbClient[]>([]);
  const [campaigns, setCampaigns] = useState<DbCampaign[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [fields, setFields] = useState<FormFields>({
    clientId: "",
    campaignId: "",
    leadName: "Sarah Mitchell",
    leadCompany: "Momentum Labs",
    leadRole: "VP of Sales",
    leadCountry: "US",
    incomingReply: "Yes, interested. Can you send more details?",
  });

  const [stage, setStage] = useState<FlowStage>("idle");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [editedDraft, setEditedDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [decidingAction, setDecidingAction] = useState<Decision | null>(null);

  // Load clients and campaigns from the real database
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoadingData(true);
    setDataError(null);
    try {
      const [clientsRes, campaignsRes] = await Promise.all([
        fetch(`${API_BASE}/api/clients`),
        fetch(`${API_BASE}/api/campaigns`),
      ]);
      if (!clientsRes.ok) throw new Error(`Failed to load clients: HTTP ${clientsRes.status}`);
      if (!campaignsRes.ok) throw new Error(`Failed to load campaigns: HTTP ${campaignsRes.status}`);

      const clientsData = await clientsRes.json() as DbClient[];
      const campaignsData = await campaignsRes.json() as DbCampaign[];

      setClients(clientsData);
      setCampaigns(campaignsData);

      // Auto-select first client and its first campaign
      if (clientsData.length > 0) {
        const firstClient = clientsData[0];
        const firstCampaign = campaignsData.find((c) => c.clientId === firstClient.id);
        setFields((f) => ({
          ...f,
          clientId: String(firstClient.id),
          campaignId: firstCampaign ? String(firstCampaign.id) : "",
        }));
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoadingData(false);
    }
  }

  const selectedClient = clients.find((c) => String(c.id) === fields.clientId);
  const availableCampaigns = campaigns.filter((c) => String(c.clientId) === fields.clientId);
  const selectedCampaign = campaigns.find((c) => String(c.id) === fields.campaignId);

  function now() {
    return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function addLog(step: string, detail: string, ok = true) {
    setLogs((prev) => [...prev, { ts: now(), step, detail, ok }]);
  }

  async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function runFlow() {
    if (stage === "running") return;

    setStage("running");
    setCompletedSteps([]);
    setActiveStep(null);
    setResult(null);
    setDecision(null);
    setLogs([]);
    setEditing(false);
    setEditedDraft("");

    const stepTimings: [string, number][] = [
      ["webhook", 500],
      ["campaign", 600],
      ["persona", 500],
      ["region", 400],
      ["draft", 1200],
      ["slack", 500],
    ];

    const stepAnimPromise = (async () => {
      for (const [stepId, delay] of stepTimings) {
        setActiveStep(stepId);
        await sleep(delay);
        setCompletedSteps((prev) => [...prev, stepId]);
        addLog(
          stepLabels[stepId] ?? stepId,
          stepMessages(stepId, fields, selectedCampaign),
        );
      }
    })();

    const apiPromise = fetch(`${API_BASE}/api/webhooks/lemlist/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: selectedCampaign?.lemlistCampaignId ?? fields.campaignId,
        leadName: fields.leadName,
        leadEmail: `${fields.leadName.toLowerCase().replace(/\s+/g, ".")}@${fields.leadCompany.toLowerCase().replace(/\s+/g, "")}.io`,
        leadCompany: fields.leadCompany,
        leadRole: fields.leadRole,
        leadCountry: fields.leadCountry,
        replyText: fields.incomingReply,
      }),
    })
      .then((r) => r.json() as Promise<SimulateResult>)
      .catch((err): SimulateResult => ({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      }));

    const [apiResult] = await Promise.all([apiPromise, stepAnimPromise]);

    setResult(apiResult);
    setActiveStep("done");
    setCompletedSteps((prev) => [...prev, "done"]);
    setEditedDraft(apiResult.generatedDraft ?? "");

    if (apiResult.ok && apiResult.generatedDraft) {
      setStage("approval");
    } else {
      setStage("done");
    }
  }

  async function handleDecision(d: Decision) {
    if (decision || !result) return;
    setDecidingAction(d);

    if (result.draftId) {
      try {
        await fetch(`${API_BASE}/api/drafts/${result.draftId}/action`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: d,
            editedText: d === "edit" ? editedDraft : undefined,
          }),
        });
        addLog("Draft Action", `PATCH /api/drafts/${result.draftId}/action — status updated to "${d}"`, true);
      } catch {
        addLog("Draft Action", `API call failed — status not persisted`, false);
      }
    }

    setDecidingAction(null);
    setDecision(d);
    setStage("done");

    if (d === "send") {
      addLog("Approval Decision", `✅ SEND — draft approved and dispatched`, true);
    } else if (d === "edit") {
      setEditing(true);
      addLog("Approval Decision", `✏️ EDIT — revision opened`, true);
    } else {
      addLog("Approval Decision", `🗑️ DISCARD — draft rejected, no reply sent`, false);
    }
  }

  async function handleSendEdited() {
    if (result?.draftId) {
      try {
        await fetch(`${API_BASE}/api/drafts/${result.draftId}/action`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "edit", editedText: editedDraft }),
        });
      } catch { /* noop */ }
    }
    setEditing(false);
    addLog("Edited Draft Sent", "Revised draft dispatched", true);
  }

  const showApproval = stage === "approval" || stage === "done";
  const draft = editedDraft || result?.generatedDraft || "";
  const hasNoData = !loadingData && clients.length === 0;

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-title">Test Flow</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Simulate the full pipeline end-to-end against real APIs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-mono text-[10px] tracking-wider">REAL API CALLS</Badge>
          <Badge className="bg-primary/10 text-primary border-primary/20 font-mono text-[10px] tracking-wider">HUMAN APPROVAL FLOW</Badge>
        </div>
      </div>

      {/* Pipeline explanation */}
      <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2.5">
        <Zap className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
        <p>
          <span className="font-medium text-foreground">Production flow: </span>
          Lemlist webhook → campaign / persona mapping → Claude qualification and draft → Lead Inbox → your decision → Lemlist send.
          This calls <span className="font-mono text-foreground">POST /api/webhooks/lemlist/simulate</span> which runs the real server-side pipeline using configured API keys.
        </p>
      </div>

      {/* No clients/campaigns warning */}
      {hasNoData && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <AlertDescription className="text-amber-300">
            No clients or campaigns found in the database. Go to{" "}
            <a href="/" className="underline font-medium">Clients</a> and{" "}
            <a href="/" className="underline font-medium">Campaigns</a> to create them first, then return here to run a test.
          </AlertDescription>
        </Alert>
      )}

      {dataError && (
        <Alert className="border-red-500/30 bg-red-500/10">
          <XCircle className="h-4 w-4 text-red-400" />
          <AlertDescription className="text-red-300 flex items-center gap-2">
            {dataError}
            <button onClick={loadData} className="underline font-medium flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6 items-start">
        {/* LEFT — Form + Pipeline tracker */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Test Parameters
              </CardTitle>
              <CardDescription>Configure the simulated incoming reply</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Client */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Client</Label>
                {loadingData ? (
                  <div className="h-9 rounded-md border border-border bg-muted/30 animate-pulse" />
                ) : (
                  <Select
                    value={fields.clientId}
                    onValueChange={(v) => {
                      const first = campaigns.find((c) => String(c.clientId) === v);
                      setFields((f) => ({ ...f, clientId: v, campaignId: first ? String(first.id) : "" }));
                    }}
                    disabled={stage === "running"}
                  >
                    <SelectTrigger data-testid="select-client">
                      <SelectValue placeholder={clients.length === 0 ? "No clients — create one first" : "Select client"} />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Campaign */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Campaign</Label>
                {loadingData ? (
                  <div className="h-9 rounded-md border border-border bg-muted/30 animate-pulse" />
                ) : (
                  <Select
                    value={fields.campaignId}
                    onValueChange={(v) => setFields((f) => ({ ...f, campaignId: v }))}
                    disabled={stage === "running" || availableCampaigns.length === 0}
                  >
                    <SelectTrigger data-testid="select-campaign">
                      <SelectValue placeholder={availableCampaigns.length === 0 ? "No campaigns for this client" : "Select campaign"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCampaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {selectedCampaign?.lemlistCampaignId && (
                  <p className="text-[10px] text-muted-foreground font-mono">Lemlist ID: {selectedCampaign.lemlistCampaignId}</p>
                )}
              </div>

              <Separator />

              {/* Lead fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <User className="h-3 w-3" /> Lead Name
                  </Label>
                  <Input value={fields.leadName} onChange={(e) => setFields((f) => ({ ...f, leadName: e.target.value }))} className="text-sm" disabled={stage === "running"} data-testid="input-lead-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Company</Label>
                  <Input value={fields.leadCompany} onChange={(e) => setFields((f) => ({ ...f, leadCompany: e.target.value }))} className="text-sm" disabled={stage === "running"} data-testid="input-lead-company" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Role</Label>
                  <Input value={fields.leadRole} onChange={(e) => setFields((f) => ({ ...f, leadRole: e.target.value }))} className="text-sm" disabled={stage === "running"} data-testid="input-lead-role" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Globe className="h-3 w-3" /> Country
                  </Label>
                  <Input value={fields.leadCountry} onChange={(e) => setFields((f) => ({ ...f, leadCountry: e.target.value }))} className="text-sm" placeholder="US, UK, Germany…" disabled={stage === "running"} data-testid="input-lead-country" />
                </div>
              </div>

              {/* Incoming reply */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Incoming Reply Text</Label>
                <Textarea value={fields.incomingReply} onChange={(e) => setFields((f) => ({ ...f, incomingReply: e.target.value }))} rows={3} className="text-sm resize-none" placeholder="Paste the lead's reply…" disabled={stage === "running"} data-testid="input-incoming-reply" />
              </div>

              <Button
                onClick={runFlow}
                disabled={stage === "running" || !fields.campaignId || !fields.leadName || !fields.incomingReply || hasNoData}
                className="w-full gap-2 font-semibold"
                data-testid="button-run-flow"
              >
                {stage === "running"
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Running pipeline…</>
                  : <><Play className="h-4 w-4" /> {stage === "idle" ? "Run Test Flow" : "Run Again"}</>
                }
              </Button>
            </CardContent>
          </Card>

          {/* Pipeline steps tracker */}
          {stage !== "idle" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Pipeline Steps
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pb-4">
                {STEPS.map((s) => {
                  const done = completedSteps.includes(s.id);
                  const active = activeStep === s.id && !done;
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 text-xs py-0.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                        done ? "bg-emerald-500/20 text-emerald-400" :
                        active ? "bg-primary/20 text-primary ring-1 ring-primary/40" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {done ? <CheckCircle2 className="h-3 w-3" /> :
                         active ? <Loader2 className="h-3 w-3 animate-spin" /> :
                         <span className="text-[9px] font-bold">{STEPS.indexOf(s) + 1}</span>}
                      </div>
                      <span className={`font-medium ${done ? "text-emerald-400" : active ? "text-primary" : "text-muted-foreground"}`}>
                        {s.label}
                      </span>
                      {done && <span className="text-emerald-400 ml-auto text-[10px]">✓</span>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — Results */}
        <div className="space-y-5">
          {stage === "idle" && (
            <div className="min-h-64 flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/10">
              <div className="text-center space-y-2 px-6">
                <Play className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {hasNoData
                    ? "Create a client and campaign first, then run the test flow."
                    : "Configure the test parameters and click Run Test Flow to simulate the pipeline."}
                </p>
              </div>
            </div>
          )}

          {/* API / intent result card */}
          {result && (
            <Card className={`border ${result.ok ? "border-primary/20 bg-primary/5" : "border-red-500/20 bg-red-500/5"}`} data-testid="result-api-info">
              <CardContent className="pt-4 pb-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                  {result.draftId && (
                    <div className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">Draft ID:</span>
                      <span className="font-mono text-foreground">#{result.draftId}</span>
                    </div>
                  )}
                  {result.confidenceScore != null && (
                    <div className="flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">Confidence:</span>
                      <span className="font-mono text-foreground">{Math.round(result.confidenceScore * 100)}%</span>
                    </div>
                  )}
                  {result.detectedIntent && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Intent:</span>
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-mono">{result.detectedIntent}</Badge>
                    </div>
                  )}
                  {result.suggestedNextAction && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Next:</span>
                      <span className="font-mono text-foreground">{result.suggestedNextAction}</span>
                    </div>
                  )}
                </div>
                {result.error && (
                  <p className="text-xs text-red-400 mt-2">Error: {result.error}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Generated draft */}
          {showApproval && draft && !editing && (
            <Card data-testid="result-draft">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" /> Claude Draft
                  </CardTitle>
                  <Badge className="bg-primary/10 text-primary border-primary/20 font-mono text-[10px]">
                    claude-3-5-sonnet
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed font-sans bg-muted/30 border border-border rounded-md p-3">{draft}</pre>
              </CardContent>
            </Card>
          )}

          {/* Edit mode */}
          {editing && (
            <Card className="border-primary/30" data-testid="result-edit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-primary" /> Edit Draft
                </CardTitle>
                <CardDescription>Revise the draft before sending</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={editedDraft} onChange={(e) => setEditedDraft(e.target.value)} rows={10} className="font-sans text-xs resize-none" data-testid="textarea-edit-draft" />
                <Button size="sm" className="gap-2" onClick={handleSendEdited} data-testid="button-send-edited">
                  <Send className="h-3.5 w-3.5" /> Send Edited Draft
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Approval preview, as it appears in the Lead Inbox */}
          {showApproval && draft && !decision && (
            <Card data-testid="result-slack-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" /> Approval preview
                </CardTitle>
                <CardDescription>
                  The draft now waits in the Lead Inbox. Try the buttons below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-[#1A1D21] border border-[#272A2E] rounded-lg p-4 text-[13px] space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0">
                      <MessageSquare className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-[#D1D2D3]">DIM Convert</span>
                      <span className="bg-[#2C3136] text-[#ABABAD] text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">App</span>
                      <span className="text-xs text-[#7E7E7E]">{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>

                  <p className="text-[#D1D2D3] font-semibold">
                    New reply from <span className="text-[#A9C97D]">{fields.leadName}</span> — {fields.leadCompany}
                  </p>

                  <div className="border-l-[3px] border-[#3F4147] pl-3">
                    <p className="text-[#ABABAD] italic">"{fields.incomingReply}"</p>
                  </div>

                  <div className="bg-[#222529] border border-[#35373B] rounded-md p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#A9C97D]" />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#ABABAD]">Claude Draft</span>
                    </div>
                    <pre className="text-[#D1D2D3] text-[12px] leading-relaxed font-sans whitespace-pre-wrap">{draft}</pre>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-[#7E7E7E]">
                    <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> {selectedCampaign?.name ?? "—"}</span>
                    <span>&middot;</span>
                    <span>{fields.leadCountry}</span>
                    {result?.confidenceScore != null && (
                      <><span>&middot;</span><span>Confidence: {Math.round(result.confidenceScore * 100)}%</span></>
                    )}
                  </div>

                  <Separator className="bg-[#35373B]" />

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleDecision("send")}
                      disabled={!!decidingAction}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-[#007A5A] hover:bg-[#148567] text-white transition-colors disabled:opacity-60"
                      data-testid="slack-button-send"
                    >
                      {decidingAction === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      ✅ Send Reply
                    </button>
                    <button
                      onClick={() => handleDecision("edit")}
                      disabled={!!decidingAction}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border bg-[#222529] border-[#35373B] text-[#D1D2D3] hover:bg-[#2C3136] transition-colors disabled:opacity-60"
                      data-testid="slack-button-edit"
                    >
                      {decidingAction === "edit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                      ✏️ Edit Reply
                    </button>
                    <button
                      onClick={() => handleDecision("discard")}
                      disabled={!!decidingAction}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border bg-[#222529] border-[#35373B] text-[#E01E5A] hover:bg-[#2C3136] transition-colors disabled:opacity-60"
                      data-testid="slack-button-discard"
                    >
                      {decidingAction === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      🗑️ Discard
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Final status card */}
          {decision && !editing && (
            <Card className={`border-2 ${
              decision === "send" ? "border-emerald-500/30 bg-emerald-500/5" :
              decision === "edit" ? "border-primary/30 bg-primary/5" :
              "border-red-500/20 bg-red-500/5"
            }`} data-testid="result-final-status">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start gap-3">
                  {decision === "send" && <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />}
                  {decision === "edit" && <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />}
                  {decision === "discard" && <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-semibold text-sm">
                      {decision === "send" && "Reply approved — flow complete"}
                      {decision === "edit" && "Edited draft dispatched — flow complete"}
                      {decision === "discard" && "Draft discarded — no reply sent"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {decision === "send" && `Draft #${result?.draftId ?? "?"} status updated to "sent".`}
                      {decision === "edit" && `Draft #${result?.draftId ?? "?"} status updated to "edited".`}
                      {decision === "discard" && `Draft #${result?.draftId ?? "?"} status updated to "discarded".`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity log */}
          {logs.length > 0 && (
            <Card data-testid="result-logs">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Activity Log
                </CardTitle>
                <CardDescription>Step-by-step execution trace</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {logs.map((log, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-xs" data-testid={`log-entry-${i}`}>
                      <span className="font-mono text-muted-foreground shrink-0 flex items-center gap-1 pt-0.5">
                        <Clock className="h-3 w-3" /> {log.ts}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground/80">{log.step}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className={`ml-auto shrink-0 font-mono font-medium ${log.ok ? "text-emerald-400" : "text-red-400"}`}>
                            {log.ok ? "ok" : "err"}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-0.5 break-words">{log.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stepLabels: Record<string, string> = {
  webhook: "Lemlist Webhook",
  campaign: "Campaign Detection",
  persona: "Persona Selection",
  region: "Regional Tone",
  draft: "Claude Draft",
  slack: "Lead Inbox Approval",
  done: "Done",
};

function stepMessages(stepId: string, fields: FormFields, campaign: DbCampaign | undefined): string {
  switch (stepId) {
    case "webhook": return `POST /api/webhooks/lemlist/simulate — reply from ${fields.leadName} at ${fields.leadCompany}`;
    case "campaign": return `Matched campaign "${campaign?.name ?? "—"}" (${campaign?.lemlistCampaignId ?? "?"}) by Lemlist campaign ID`;
    case "persona": return `Persona lookup — loading tone, CTA, objection handling, region rules`;
    case "region": return `Country "${fields.leadCountry}" → regional tone bucket applied`;
    case "draft": return `Claude — qualifying the lead and drafting a reply`;
    case "slack": return `Draft added to the Lead Inbox for approval`;
    default: return "";
  }
}
