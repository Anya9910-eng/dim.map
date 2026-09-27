import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, personasTable } from "@workspace/db";
import {
  ListPersonasQueryParams,
  ListPersonasResponse,
  CreatePersonaBody,
  CreatePersonaResponse,
  GetPersonaParams,
  GetPersonaResponse,
  UpdatePersonaParams,
  UpdatePersonaBody,
  UpdatePersonaResponse,
  DeletePersonaParams,
} from "@workspace/api-zod";

import { clientScope, canAccessClient, denyNotFound, scopedClientId } from "../middleware/scope";

const router: IRouter = Router();

router.get("/personas", async (req, res): Promise<void> => {
  const query = ListPersonasQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const personas = query.data.clientId != null
    ? await db.select().from(personasTable).where(and(clientScope(req, personasTable.clientId), eq(personasTable.clientId, query.data.clientId))).orderBy(personasTable.createdAt)
    : await db.select().from(personasTable).where(clientScope(req, personasTable.clientId)).orderBy(personasTable.createdAt);
  res.json(ListPersonasResponse.parse(personas));
});

router.post("/personas", async (req, res): Promise<void> => {
  const parsed = CreatePersonaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const scoped = scopedClientId(req);
  if (scoped !== null && parsed.data.clientId !== scoped) {
    res.status(403).json({ error: "Cannot create a persona for another client" });
    return;
  }
  const [persona] = await db.insert(personasTable).values(parsed.data).returning();
  res.status(201).json(CreatePersonaResponse.parse(persona));
});

router.get("/personas/:id", async (req, res): Promise<void> => {
  const params = GetPersonaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [persona] = await db.select().from(personasTable).where(eq(personasTable.id, params.data.id));
  if (persona && !canAccessClient(req, persona.clientId)) {
    denyNotFound(res, "Persona");
    return;
  }
  if (!persona) {
    res.status(404).json({ error: "Persona not found" });
    return;
  }
  res.json(GetPersonaResponse.parse(persona));
});

router.patch("/personas/:id", async (req, res): Promise<void> => {
  const params = UpdatePersonaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePersonaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [persona] = await db
    .update(personasTable)
    .set(parsed.data)
    .where(and(eq(personasTable.id, params.data.id), clientScope(req, personasTable.clientId)))
    .returning();
  if (!persona) {
    res.status(404).json({ error: "Persona not found" });
    return;
  }
  res.json(UpdatePersonaResponse.parse(persona));
});

router.delete("/personas/:id", async (req, res): Promise<void> => {
  const params = DeletePersonaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [persona] = await db
    .delete(personasTable)
    .where(and(eq(personasTable.id, params.data.id), clientScope(req, personasTable.clientId)))
    .returning();
  if (!persona) {
    res.status(404).json({ error: "Persona not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
