import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Where a lead came from, and therefore where a reply to them goes back out.
 *
 * `lemlist`: a reply to a cold email / LinkedIn campaign — the original and
 * still the default, so every row that predates this column reads as one.
 * `meta`: a Meta (Facebook / Instagram) Lead Ads form submission.
 * `whatsapp`: an inbound WhatsApp Business message.
 *
 * Shared by campaigns (which channel a campaign listens on) and drafts (which
 * channel a given lead arrived through).
 */
export const leadChannelEnum = pgEnum("lead_channel", ["lemlist", "meta", "whatsapp"]);
export type LeadChannel = (typeof leadChannelEnum.enumValues)[number];

/**
 * How ready a lead is to buy, as judged by the model when it drafts the reply.
 *
 * `hot`: budget, timeline and intent are all there — call them today.
 * `warm`: interested, but missing one of those.
 * `cold`: curious at best; nurture.
 * `unqualified`: wrong fit, not a buyer, or asked to be left alone.
 */
export const leadQualificationEnum = pgEnum("lead_qualification", ["hot", "warm", "cold", "unqualified"]);
export type LeadQualification = (typeof leadQualificationEnum.enumValues)[number];
