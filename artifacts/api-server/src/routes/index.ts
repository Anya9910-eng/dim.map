import { Router, type IRouter } from "express";
import { apiGate } from "../middleware/apiGate";
import { billingGate } from "../middleware/billingGate";
import healthRouter from "./health";
import clientsRouter from "./clients";
import personasRouter from "./personas";
import campaignsRouter from "./campaigns";
import draftsRouter from "./drafts";
import logsRouter from "./logs";
import setupRouter from "./setup";
import dashboardRouter from "./dashboard";
import integrationsRouter from "./integrations";
import slackRouter from "./slack";
import webhooksRouter from "./webhooks";
import authRouter from "./auth";
import epicgramRouter from "./epicgram";
import meRouter from "./me";
import earlyAccessRouter from "./earlyAccess";
import billingRouter from "./billing";

const router: IRouter = Router();

// Default-deny: everything below requires an operator session unless apiGate
// lists it as carrying its own credential check.
router.use(apiGate);
// A locked self-serve tenant can still sign in and pay, and nothing else.
router.use(billingGate);

router.use(healthRouter);
router.use(clientsRouter);
router.use(personasRouter);
router.use(campaignsRouter);
router.use(draftsRouter);
router.use(logsRouter);
router.use(setupRouter);
router.use(dashboardRouter);
router.use(integrationsRouter);
router.use(slackRouter);
router.use(webhooksRouter);
router.use(authRouter);
router.use(meRouter);
router.use(earlyAccessRouter);
router.use(billingRouter);
router.use(epicgramRouter);

export default router;
