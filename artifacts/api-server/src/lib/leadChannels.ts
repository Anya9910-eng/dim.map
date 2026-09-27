/**
 * Meta Lead Ads and WhatsApp Business as lead sources, next to Lemlist.
 *
 * Each source reaches us in its own shape. Everything here turns those shapes
 * into one `IncomingLead`, so the drafting pipeline in routes/webhooks.ts does
 * not care where a lead came from — and sends an approved reply back out of
 * the right channel.
 */
import type { Client } from "@workspace/db";
import { sendReply } from "./lemlist";
import { logger } from "./logger";

export type LeadChannel = "lemlist" | "meta" | "whatsapp" | "google" | "youtube";

/** One lead, whatever it arrived through. Empty strings mean "not given". */
export interface IncomingLead {
  channel: LeadChannel;
  /** The source system's id for this lead (Meta leadgen id, WhatsApp wa_id, Lemlist lead id). */
  externalLeadId: string;
  /**
   * Every id that could name the campaign this lead belongs to, most specific
   * first — a Meta lead carries a form id, an ad id and a campaign id, and a
   * client may have mapped any one of them.
   */
  campaignRefs: string[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  country: string;
  /** What the lead said. For a form, the answers rendered as lines. */
  message: string;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Digits only — WhatsApp's own format for a phone number (E.164 without "+"). */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function pick(obj: Json, ...keys: string[]): string {
  for (const key of keys) {
    const v = str(obj[key]);
    if (v) return v;
  }
  return "";
}

// ─── Meta Lead Ads ──────────────────────────────────────────────────────────

/** Standard Lead Ads question keys; everything else is a custom question. */
const META_STANDARD_FIELDS: Record<string, keyof IncomingLead | "full_name"> = {
  full_name: "full_name",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone_number: "phone",
  phone: "phone",
  company_name: "company",
  job_title: "jobTitle",
  country: "country",
};

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A lead as the Graph API returns it (`GET /{leadgen_id}`), or as an n8n /
 * Zapier step forwards it: `field_data: [{ name, values: [..] }]` plus ids.
 */
function metaLeadFromFieldData(lead: Json, ids: Json): IncomingLead {
  const out: IncomingLead = {
    channel: "meta",
    externalLeadId: pick(lead, "id", "leadgen_id") || pick(ids, "leadgen_id", "id"),
    campaignRefs: [],
    firstName: "", lastName: "", email: "", phone: "", company: "", jobTitle: "", country: "", message: "",
  };
  const answers: string[] = [];
  let fullName = "";

  for (const field of arr(lead["field_data"])) {
    if (!isObj(field)) continue;
    const name = str(field["name"]);
    const value = arr(field["values"]).map(str).filter(Boolean).join(", ");
    if (!name || !value) continue;
    const target = META_STANDARD_FIELDS[name.toLowerCase()];
    if (target === "full_name") fullName = value;
    else if (target) (out[target] as string) = value;
    else answers.push(`${humanize(name)}: ${value}`);
  }

  if (fullName && !out.firstName) Object.assign(out, splitName(fullName));
  out.phone = normalizePhone(out.phone);
  out.campaignRefs = [
    pick(lead, "form_id") || pick(ids, "form_id"),
    pick(lead, "ad_id") || pick(ids, "ad_id"),
    pick(lead, "adgroup_id") || pick(ids, "adgroup_id", "adset_id"),
    pick(lead, "campaign_id") || pick(ids, "campaign_id"),
  ].filter(Boolean);
  out.message = answers.length
    ? `Submitted a lead form:\n${answers.join("\n")}`
    : "Submitted a lead form asking to be contacted.";
  return out;
}

/** A flat payload an automation built by hand: `{ firstName, phone, message, campaignId, … }`. */
function metaLeadFromFlat(body: Json, channel: LeadChannel = "meta"): IncomingLead {
  const full = pick(body, "fullName", "full_name", "name");
  const names = full ? splitName(full) : { firstName: "", lastName: "" };
  return {
    channel,
    externalLeadId: pick(body, "leadId", "leadgen_id", "id"),
    campaignRefs: [pick(body, "formId", "form_id"), pick(body, "campaignId", "campaign_id"), pick(body, "adId", "ad_id")].filter(Boolean),
    firstName: pick(body, "firstName", "first_name") || names.firstName,
    lastName: pick(body, "lastName", "last_name") || names.lastName,
    email: pick(body, "email", "leadEmail"),
    phone: normalizePhone(pick(body, "phone", "phoneNumber", "phone_number")),
    company: pick(body, "company", "companyName"),
    jobTitle: pick(body, "jobTitle", "job_title"),
    country: pick(body, "country"),
    message: pick(body, "message", "text", "notes") || "Submitted a lead form asking to be contacted.",
  };
}

export interface ParsedMetaPayload {
  leads: IncomingLead[];
  /**
   * Native Meta webhook notifications that carry only a leadgen id. Meta does
   * not put the answers in the webhook itself — they have to be fetched with a
   * page token. These are reported, not drafted.
   */
  unresolvedLeadgenIds: string[];
}

export function parseMetaPayload(body: unknown): ParsedMetaPayload {
  const result: ParsedMetaPayload = { leads: [], unresolvedLeadgenIds: [] };
  if (!isObj(body)) return result;

  // Native webhook: { object: "page", entry: [{ changes: [{ field: "leadgen", value: {...} }] }] }
  if (Array.isArray(body["entry"])) {
    for (const entry of arr(body["entry"])) {
      if (!isObj(entry)) continue;
      for (const change of arr(entry["changes"])) {
        if (!isObj(change) || str(change["field"]) !== "leadgen" || !isObj(change["value"])) continue;
        const value = change["value"];
        if (Array.isArray(value["field_data"])) result.leads.push(metaLeadFromFieldData(value, value));
        else {
          const id = str(value["leadgen_id"]);
          if (id) result.unresolvedLeadgenIds.push(id);
        }
      }
    }
    return result;
  }

  if (Array.isArray(body["field_data"])) {
    result.leads.push(metaLeadFromFieldData(body, body));
    return result;
  }

  const flat = metaLeadFromFlat(body);
  if (flat.email || flat.phone || flat.firstName) result.leads.push(flat);
  return result;
}

// ─── Google Ads & YouTube lead forms ────────────────────────────────────────

/** Google's fixed column ids for standard lead-form questions. */
const GOOGLE_STANDARD_COLUMNS: Record<string, keyof IncomingLead | "full_name"> = {
  FULL_NAME: "full_name",
  FIRST_NAME: "firstName",
  LAST_NAME: "lastName",
  EMAIL: "email",
  WORK_EMAIL: "email",
  PHONE_NUMBER: "phone",
  WORK_PHONE: "phone",
  COMPANY_NAME: "company",
  JOB_TITLE: "jobTitle",
  COUNTRY: "country",
};

/**
 * A Google Ads lead-form webhook: `{ lead_id, form_id, campaign_id,
 * adgroup_id, creative_id, user_column_data: [{ column_id, column_name,
 * string_value }], is_test, google_key }`. YouTube video campaigns use the
 * same lead forms and the same payload, so `channel` only records which of the
 * two URLs the client pointed the form at. A flat payload from an automation
 * is accepted too.
 */
export function parseGooglePayload(body: unknown, channel: "google" | "youtube"): IncomingLead[] {
  if (!isObj(body)) return [];
  if (!Array.isArray(body["user_column_data"])) {
    const flat = metaLeadFromFlat(body, channel);
    return flat.email || flat.phone || flat.firstName ? [flat] : [];
  }

  const out: IncomingLead = {
    channel,
    externalLeadId: pick(body, "lead_id"),
    campaignRefs: [pick(body, "form_id"), pick(body, "campaign_id"), pick(body, "adgroup_id"), pick(body, "creative_id")].filter(Boolean),
    firstName: "", lastName: "", email: "", phone: "", company: "", jobTitle: "", country: "", message: "",
  };
  const answers: string[] = [];
  let fullName = "";
  for (const col of arr(body["user_column_data"])) {
    if (!isObj(col)) continue;
    const id = str(col["column_id"]).toUpperCase();
    const value = str(col["string_value"]);
    if (!value) continue;
    const target = GOOGLE_STANDARD_COLUMNS[id];
    if (target === "full_name") fullName = value;
    else if (target) (out[target] as string) = value;
    else answers.push(`${str(col["column_name"]) || humanize(str(col["column_id"]))}: ${value}`);
  }
  if (fullName && !out.firstName) Object.assign(out, splitName(fullName));
  out.phone = normalizePhone(out.phone);
  const where = channel === "youtube" ? "a YouTube ad" : "a Google ad";
  out.message = answers.length
    ? `Submitted a lead form on ${where}:\n${answers.join("\n")}`
    : `Submitted a lead form on ${where} asking to be contacted.`;
  return out.email || out.phone || out.firstName ? [out] : [];
}

/** Google marks leads sent with the "Send test data" button. */
export function isGoogleTestLead(body: unknown): boolean {
  return isObj(body) && body["is_test"] === true;
}

// ─── WhatsApp ───────────────────────────────────────────────────────────────

/** Text a WhatsApp message carries, for the message types a person types. */
function whatsappMessageText(msg: Json): string {
  const type = str(msg["type"]);
  if (type === "text" && isObj(msg["text"])) return str(msg["text"]["body"]);
  if (type === "button" && isObj(msg["button"])) return str(msg["button"]["text"]);
  if (type === "interactive" && isObj(msg["interactive"])) {
    const i = msg["interactive"];
    const reply = isObj(i["button_reply"]) ? i["button_reply"] : isObj(i["list_reply"]) ? i["list_reply"] : null;
    return reply ? str(reply["title"]) : "";
  }
  if (isObj(msg[type]) && str((msg[type] as Json)["caption"])) return str((msg[type] as Json)["caption"]);
  return "";
}

/**
 * The WhatsApp Cloud API webhook (`entry[].changes[].value.messages[]`), or a
 * flat `{ phone, name, message, campaignId }` from an automation. Delivery and
 * read receipts (`statuses`) carry no message and yield nothing.
 */
export function parseWhatsAppPayload(body: unknown): IncomingLead[] {
  if (!isObj(body)) return [];
  const leads: IncomingLead[] = [];

  if (Array.isArray(body["entry"])) {
    for (const entry of arr(body["entry"])) {
      if (!isObj(entry)) continue;
      for (const change of arr(entry["changes"])) {
        if (!isObj(change) || !isObj(change["value"])) continue;
        const value = change["value"];
        const metadata = isObj(value["metadata"]) ? value["metadata"] : {};
        const names = new Map<string, string>();
        for (const c of arr(value["contacts"])) {
          if (isObj(c) && isObj(c["profile"])) names.set(str(c["wa_id"]), str(c["profile"]["name"]));
        }
        for (const msg of arr(value["messages"])) {
          if (!isObj(msg)) continue;
          const text = whatsappMessageText(msg);
          const from = normalizePhone(str(msg["from"]));
          if (!text || !from) continue;
          leads.push({
            channel: "whatsapp",
            externalLeadId: from,
            campaignRefs: [pick(metadata, "phone_number_id"), pick(metadata, "display_phone_number")].filter(Boolean),
            ...splitName(names.get(from) ?? ""),
            email: "",
            phone: from,
            company: "",
            jobTitle: "",
            country: "",
            message: text,
          });
        }
      }
    }
    return leads;
  }

  const phone = normalizePhone(pick(body, "phone", "from", "waId", "wa_id"));
  const message = pick(body, "message", "text", "body");
  if (!phone || !message) return [];
  const full = pick(body, "name", "fullName");
  const names = full ? splitName(full) : { firstName: pick(body, "firstName"), lastName: pick(body, "lastName") };
  return [{
    channel: "whatsapp",
    externalLeadId: phone,
    campaignRefs: [pick(body, "campaignId", "campaign_id")].filter(Boolean),
    ...names,
    email: pick(body, "email"),
    phone,
    company: "",
    jobTitle: "",
    country: pick(body, "country"),
    message,
  }];
}

// ─── Sending ────────────────────────────────────────────────────────────────

export const WHATSAPP_GRAPH_VERSION = "v21.0";
export const WHATSAPP_SEND_TIMEOUT_MS = 30_000;

export function isWhatsAppConfigured(client: Pick<Client, "whatsappPhoneNumberId" | "whatsappAccessToken"> | null | undefined): boolean {
  return !!client?.whatsappPhoneNumberId?.trim() && !!client?.whatsappAccessToken?.trim();
}

/**
 * Sends a plain-text WhatsApp message from the client's own business number.
 *
 * WhatsApp only accepts free-form text within 24 hours of the lead's last
 * message; outside that window Meta answers with an error, which is surfaced
 * as-is so the operator can follow up with an approved template instead.
 */
export async function sendWhatsAppText(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? WHATSAPP_SEND_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(params.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: normalizePhone(params.to),
          type: "text",
          text: { preview_url: false, body: params.text },
        }),
        signal: controller.signal,
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.text();
    logger.error({ status: res.status, body: body.slice(0, 300) }, "WhatsApp send failed");
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // not JSON — keep the raw body
    }
    return { ok: false, error: `WhatsApp HTTP ${res.status}: ${detail}` };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why a draft cannot be sent from the app at all, or null when it can. Checked
 * before any network call, so the caller can refuse with a clear reason.
 */
export function unsendableReason(
  draft: { channel?: LeadChannel | null; lemlistLeadId: string | null; prospectEmail: string; prospectPhone?: string | null },
  client: Pick<Client, "whatsappPhoneNumberId" | "whatsappAccessToken"> | null | undefined,
): string | null {
  const channel = draft.channel ?? "lemlist";
  if (channel === "lemlist") {
    if (!draft.lemlistLeadId) {
      return "This draft predates Lemlist lead tracking and cannot be sent automatically — reply to the lead directly in Lemlist.";
    }
    if (!draft.prospectEmail.trim()) {
      return "This reply came in without an email address — most likely over LinkedIn. Answer it in Lemlist, then discard this draft.";
    }
    return null;
  }
  if (!draft.prospectPhone?.trim()) {
    return "This lead left no phone number, so there is no WhatsApp to reply to — contact them by email, then discard this draft.";
  }
  if (!isWhatsAppConfigured(client)) {
    return "WhatsApp sending is not set up — add your WhatsApp phone number ID and access token in Settings, or copy this reply into WhatsApp yourself.";
  }
  return null;
}

/**
 * Sends an approved reply back through the channel the lead came from:
 * Lemlist for campaign replies, WhatsApp for WhatsApp chats and Meta form leads.
 * A WhatsApp send that cannot happen (no number, no credentials) fails here
 * with the reason, before any network call.
 */
export async function sendApprovedReply(params: {
  draft: { channel?: LeadChannel | null; lemlistLeadId: string | null; prospectEmail: string; prospectPhone?: string | null };
  lemlistCampaignId: string;
  client: Pick<Client, "lemlistApiKey" | "whatsappPhoneNumberId" | "whatsappAccessToken"> | null | undefined;
  replyText: string;
}): Promise<{ ok: boolean; error?: string }> {
  const channel = params.draft.channel ?? "lemlist";
  if (channel === "lemlist") {
    return sendReply({
      leadId: params.draft.lemlistLeadId ?? "",
      campaignId: params.lemlistCampaignId,
      replyText: params.replyText,
      apiKey: params.client?.lemlistApiKey,
    });
  }
  const reason = unsendableReason(params.draft, params.client);
  if (reason) return { ok: false, error: reason };
  return sendWhatsAppText({
    phoneNumberId: params.client?.whatsappPhoneNumberId ?? "",
    accessToken: params.client?.whatsappAccessToken ?? "",
    to: params.draft.prospectPhone ?? "",
    text: params.replyText,
  });
}

/** Human name of a channel, for log lines and messages. */
export function channelLabel(channel: LeadChannel | null | undefined): string {
  switch (channel) {
    case "meta": return "Meta";
    case "whatsapp": return "WhatsApp";
    case "google": return "Google Ads";
    case "youtube": return "YouTube";
    default: return "Lemlist";
  }
}
