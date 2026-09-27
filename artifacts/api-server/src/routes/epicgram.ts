import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { epicgramDraftsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateEpicgramDraft } from "../lib/claude-epicgram";
import { logger } from "../lib/logger";

const router = Router();

// ─── API key auth middleware ────────────────────────────────────────────────

function requireEpicgramApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.EPICGRAM_API_KEY;
  if (!key) {
    res.status(503).json({ error: "EPICGRAM_API_KEY not configured" });
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== key) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }
  next();
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const createDraftSchema = z.object({
  workspace_id: z.string().min(1),
  audit_id: z.string().min(1),
  telegram_account_slot: z.string().optional(),
  chat_id: z.string().min(1),
  chat_title: z.string().optional(),
  messages: z
    .array(
      z.object({
        from: z.string().min(1),
        text: z.string().min(1),
      }),
    )
    .min(1),
  task: z.string().min(1),
});

const approveSchema = z.object({
  edited_text: z.string().optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/epicgram/drafts
 * Create a new AI draft from EPIC GRAM chat context.
 */
router.post("/v1/epicgram/drafts", requireEpicgramApiKey, async (req: Request, res: Response) => {
  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  try {
    const result = await generateEpicgramDraft({
      chatTitle: body.chat_title,
      messages: body.messages,
      task: body.task,
    });

    const [draft] = await db
      .insert(epicgramDraftsTable)
      .values({
        workspaceId: body.workspace_id,
        auditId: body.audit_id,
        telegramAccountSlot: body.telegram_account_slot ?? null,
        chatId: body.chat_id,
        chatTitle: body.chat_title ?? null,
        messages: JSON.stringify(body.messages),
        task: body.task,
        replyText: result.draft,
        confidenceScore: result.confidenceScore,
        detectedIntent: result.detectedIntent,
        suggestedAction: result.suggestedAction,
        status: "pending",
      })
      .returning();

    logger.info(
      { draftId: draft.id, workspaceId: body.workspace_id, chatId: body.chat_id },
      "EpicGram draft created",
    );

    res.status(201).json({
      draft_id: draft.id,
      text: draft.replyText,
      confidence: draft.confidenceScore,
      detected_intent: draft.detectedIntent,
      suggested_action: draft.suggestedAction,
      status: draft.status,
      created_at: draft.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "EpicGram draft creation failed");
    res.status(500).json({ error: "Draft generation failed" });
  }
});

/**
 * GET /api/v1/epicgram/drafts/:id
 * Get a draft by ID (workspace-scoped).
 */
router.get("/v1/epicgram/drafts/:id", requireEpicgramApiKey, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid draft ID" });
    return;
  }

  const workspaceId = typeof req.query.workspace_id === "string" ? req.query.workspace_id : undefined;
  if (!workspaceId) {
    res.status(422).json({ error: "workspace_id query parameter required" });
    return;
  }

  const [draft] = await db
    .select()
    .from(epicgramDraftsTable)
    .where(and(eq(epicgramDraftsTable.id, id), eq(epicgramDraftsTable.workspaceId, workspaceId)));

  if (!draft) {
    res.status(404).json({ error: "Draft not found" });
    return;
  }

  res.json({
    draft_id: draft.id,
    workspace_id: draft.workspaceId,
    audit_id: draft.auditId,
    telegram_account_slot: draft.telegramAccountSlot,
    chat_id: draft.chatId,
    chat_title: draft.chatTitle,
    messages: JSON.parse(draft.messages) as unknown[],
    task: draft.task,
    text: draft.editedText ?? draft.replyText,
    original_text: draft.replyText,
    edited_text: draft.editedText,
    confidence: draft.confidenceScore,
    detected_intent: draft.detectedIntent,
    suggested_action: draft.suggestedAction,
    status: draft.status,
    created_at: draft.createdAt,
    actioned_at: draft.actionedAt,
  });
});

/**
 * POST /api/v1/epicgram/drafts/:id/approve
 * Approve a draft (operator confirmed; EPIC GRAM will send via TDLib).
 * Optionally accepts { edited_text } if the operator modified the reply.
 */
router.post(
  "/v1/epicgram/drafts/:id/approve",
  requireEpicgramApiKey,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid draft ID" });
      return;
    }

    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const workspaceId = typeof req.query.workspace_id === "string" ? req.query.workspace_id : undefined;
    if (!workspaceId) {
      res.status(422).json({ error: "workspace_id query parameter required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(epicgramDraftsTable)
      .where(and(eq(epicgramDraftsTable.id, id), eq(epicgramDraftsTable.workspaceId, workspaceId)));

    if (!existing) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    if (existing.status !== "pending") {
      res.status(409).json({ error: `Draft already ${existing.status}` });
      return;
    }

    const [updated] = await db
      .update(epicgramDraftsTable)
      .set({
        status: "approved",
        editedText: parsed.data.edited_text ?? null,
        actionedAt: new Date(),
      })
      .where(eq(epicgramDraftsTable.id, id))
      .returning();

    logger.info(
      { draftId: id, workspaceId, edited: !!parsed.data.edited_text },
      "EpicGram draft approved",
    );

    res.json({
      draft_id: updated.id,
      status: updated.status,
      final_text: updated.editedText ?? updated.replyText,
      actioned_at: updated.actionedAt,
    });
  },
);

/**
 * POST /api/v1/epicgram/drafts/:id/reject
 * Reject a draft (operator dismissed it).
 */
router.post(
  "/v1/epicgram/drafts/:id/reject",
  requireEpicgramApiKey,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid draft ID" });
      return;
    }

    const workspaceId = typeof req.query.workspace_id === "string" ? req.query.workspace_id : undefined;
    if (!workspaceId) {
      res.status(422).json({ error: "workspace_id query parameter required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(epicgramDraftsTable)
      .where(and(eq(epicgramDraftsTable.id, id), eq(epicgramDraftsTable.workspaceId, workspaceId)));

    if (!existing) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    if (existing.status !== "pending") {
      res.status(409).json({ error: `Draft already ${existing.status}` });
      return;
    }

    const [updated] = await db
      .update(epicgramDraftsTable)
      .set({
        status: "rejected",
        actionedAt: new Date(),
      })
      .where(eq(epicgramDraftsTable.id, id))
      .returning();

    logger.info({ draftId: id, workspaceId }, "EpicGram draft rejected");

    res.json({
      draft_id: updated.id,
      status: updated.status,
      actioned_at: updated.actionedAt,
    });
  },
);

export default router;
