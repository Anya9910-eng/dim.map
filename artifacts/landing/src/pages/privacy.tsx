import { LegalLayout, Section, Table } from "./legal-layout";

const UPDATED = "27 September 2026";
// See terms.tsx — privacy@ was never a real mailbox. A published contact
// address that bounces is worse here than anywhere else on the site.
const CONTACT = "outreach@draftfly.app";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated={UPDATED}>
      <p>
        DIM map receives the leads your campaigns generate — replies to your outbound email, Meta
        lead-form submissions and WhatsApp messages — qualifies them, and drafts replies for a person
        to approve. Doing that means handling two different kinds of personal data: information about
        you, our customer, and information about your leads. This policy covers both, and is explicit
        about which is which.
      </p>

      <Section heading="Who is responsible for what">
        <p>
          For your own account data we are the controller. For the prospect data that flows through
          the service we are a processor: you decide whose details enter DIM map and why, and we
          act on your instructions. If you operate under the GDPR, you are the controller for that
          data and are responsible for having a lawful basis for the outreach and advertising that produced it.
        </p>
      </Section>

      <Section heading="What we collect">
        <Table
          rows={[
            ["Account", "Your name, work email and company."],
            ["Credentials", "Your Lemlist API key, your WhatsApp Business phone number ID and access token, your Slack bot token, and the secret for your webhooks."],
            ["Configuration", "Personas, campaigns, tone and reply rules, and the Slack channel that receives your drafts."],
            ["Lead data", "For each lead: their name, email address and/or phone number, company, role and country where given, the text of their message or lead-form answers, and the qualification grade we assign."],
            ["Generated content", "The drafts we produce, whether each was approved, edited or discarded, and by whom."],
            ["Operational logs", "Request metadata and errors, used to keep the service working and to investigate faults."],
          ]}
        />
      </Section>

      <Section heading="How we use it">
        <p>
          The lead's message and details are sent to Anthropic's Claude API to qualify the lead and
          produce a draft. The draft and grade are stored, shown in your dashboard, and — if you
          connected Slack — posted to your Slack channel. Nothing is used to train
          any model: Anthropic does not train on data submitted through its API, and we do not use
          your data to build or improve models of our own.
        </p>
        <p>
          We do not sell personal data, and we do not use lead data for our own marketing.
        </p>
      </Section>

      <Section heading="Who else processes it">
        <p>We rely on a small number of sub-processors. Each receives only what its function requires.</p>
        <Table
          rows={[
            ["Anthropic", "Qualifies leads and generates the drafts. Receives the lead's message and details. Does not train on it."],
            ["Meta (WhatsApp Business, Lead Ads)", "Your own accounts. Send us leads and messages, and deliver approved WhatsApp replies."],
            ["Lemlist", "Your own account. Sends us replies and receives approved responses."],
            ["Slack", "Optional. Delivers approval cards. Receives the draft and lead details."],
            ["Contabo", "Hosting. Servers located in Germany."],
          ]}
        />
      </Section>

      <Section heading="Where it is stored, and how">
        <p>
          Data is held in Germany, within the EU. Traffic to the service is encrypted with TLS.
          Credentials — your Lemlist API key, WhatsApp access token, Slack bot token and webhook
          secret — are encrypted
          before they are written to the database using AES-256-GCM, so a copy of the database or a
          backup file does not expose them. Backups are taken daily and kept for fourteen days.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Drafts and the reply data attached to them are kept while your account is active, so the
          service can show history and calibrate to your voice. Delete a client in the dashboard and
          its drafts and configuration go with it. Close your account and we delete your data within
          30 days, except where we are required to keep records for longer. Operational logs are
          retained for 90 days.
        </p>
      </Section>

      <Section heading="Rights of your leads">
        <p>
          The people whose details pass through DIM map have rights over that data — access,
          correction, deletion, objection, and portability, among others, depending on where they
          live. Because we hold that data on your behalf, requests are normally handled by you. If
          someone contacts us directly we will tell them to approach you, and we will help you
          respond. Write to <span className="text-foreground">{CONTACT}</span> and we will act on
          a documented instruction from you.
        </p>
      </Section>

      <Section heading="Your rights as a customer">
        <p>
          You can access, correct, export or delete your own account data at any time by writing to{" "}
          <span className="text-foreground">{CONTACT}</span>. If you are in the EU or the UK you may
          also complain to your local data protection authority.
        </p>
      </Section>

      <Section heading="Security incidents">
        <p>
          If a breach affects your data we will notify you without undue delay, and in any event
          within 72 hours of becoming aware of it, with what we know about the scope and what we are
          doing about it.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          If we change this policy in a way that materially affects how we handle your data, we will
          tell you before the change takes effect. The date at the top always reflects the current
          version.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this policy, or about data we hold:{" "}
          <span className="text-foreground">{CONTACT}</span>.
        </p>
      </Section>
    </LegalLayout>
  );
}
