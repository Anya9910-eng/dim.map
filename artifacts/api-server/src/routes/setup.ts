import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, setupItemsTable } from "@workspace/db";
import {
  ListSetupItemsQueryParams,
  ListSetupItemsResponse,
  UpdateSetupItemParams,
  UpdateSetupItemBody,
  UpdateSetupItemResponse,
} from "@workspace/api-zod";

import { requireOperator } from "../middleware/requireOperator";

const router: IRouter = Router();

router.get("/setup", requireOperator, async (req, res): Promise<void> => {
  const query = ListSetupItemsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const items = query.data.checklistType
    ? await db.select().from(setupItemsTable).where(eq(setupItemsTable.checklistType, query.data.checklistType as "client_onboarding" | "internal_setup")).orderBy(setupItemsTable.id)
    : await db.select().from(setupItemsTable).orderBy(setupItemsTable.id);
  res.json(ListSetupItemsResponse.parse(items));
});

router.patch("/setup/:id", requireOperator, async (req, res): Promise<void> => {
  const params = UpdateSetupItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateSetupItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [item] = await db
    .update(setupItemsTable)
    .set({ isCompleted: body.data.isCompleted, completedAt: body.data.isCompleted ? new Date() : null })
    .where(eq(setupItemsTable.id, params.data.id))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Setup item not found" });
    return;
  }
  res.json(UpdateSetupItemResponse.parse(item));
});

export default router;
