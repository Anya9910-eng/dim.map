import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, logsTable } from "@workspace/db";
import {
  ListLogsQueryParams,
  ListLogsResponse,
  GetLogParams,
  GetLogResponse,
} from "@workspace/api-zod";

import { clientScope, canAccessClient, denyNotFound } from "../middleware/scope";

const router: IRouter = Router();

router.get("/logs", async (req, res): Promise<void> => {
  const query = ListLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const conditions = [];
  conditions.push(clientScope(req, logsTable.clientId));
  if (query.data.clientId != null) conditions.push(eq(logsTable.clientId, query.data.clientId));
  if (query.data.level) conditions.push(eq(logsTable.level, query.data.level as "info" | "warning" | "error"));
  if (query.data.source) conditions.push(eq(logsTable.source, query.data.source as "lemlist" | "n8n" | "claude" | "slack" | "system"));
  const limit = query.data.limit ?? 50;
  const logs = conditions.length > 0
    ? await db.select().from(logsTable).where(and(...conditions)).orderBy(desc(logsTable.createdAt)).limit(limit)
    : await db.select().from(logsTable).where(clientScope(req, logsTable.clientId)).orderBy(desc(logsTable.createdAt)).limit(limit);
  res.json(ListLogsResponse.parse(logs));
});

router.get("/logs/:id", async (req, res): Promise<void> => {
  const params = GetLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [log] = await db.select().from(logsTable).where(eq(logsTable.id, params.data.id));
  if (log && !canAccessClient(req, log.clientId)) {
    denyNotFound(res, "Log");
    return;
  }
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }
  res.json(GetLogResponse.parse(log));
});

export default router;
