import { LegalLayout, Section, Table } from "./legal-layout";

const UPDATED = "27 September 2026";
// The only mailbox that exists on this domain — hello@ and privacy@ were
// never provisioned and bounced with 550 Recipient not found.
const CONTACT = "outreach@draftfly.app";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated={UPDATED}>
      <p>
        These terms govern your use of DIM map. By creating an account or connecting a lead source
        you agree to them.
      </p>

      <Section heading="What the service does">
        <p>
          DIM map receives the leads your campaigns generate — replies to your outbound email, Meta
          lead-form submissions and WhatsApp messages — grades each lead using Claude, and drafts a
          suggested response for approval in the dashboard or Slack. In draft mode nothing is sent to
          a lead until a person approves it. If you switch a client to auto mode, replies are sent
          without review — that is your decision and your responsibility.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          You are responsible for what happens under your account, including what the people you
          give access to do with it. Keep your credentials to yourself, and tell us promptly if you
          think someone else has them.
        </p>
      </Section>

      <Section heading="Your responsibilities for outreach">
        <p>
          You decide who you contact and what you say to them. You are responsible for complying
          with the law that applies to that outreach and advertising — including anti-spam rules such
          as CAN-SPAM, data protection law such as the GDPR, Meta's advertising and WhatsApp Business
          policies, and any rules on marketing property — and for having a lawful basis for
          processing the personal data of the people you contact. DIM map is a tool for replying to
          people who already wrote to you; it is not a way to bypass those obligations.
        </p>
      </Section>

      <Section heading="AI-generated content">
        <p>
          Drafts and lead grades are produced by a language model. They can be wrong, can misread
          intent, and can state things about your properties — prices, availability, payment plans,
          handover dates — that are not accurate. Review before sending. You own what
          you send and are responsible for it, whether or not you edited the draft first.
        </p>
        <p>
          Because the model is probabilistic, the same reply will not always produce the same draft.
          We do not warrant that any particular draft is accurate, appropriate, or fit for a
          particular lead, and a grade is a suggestion, not a credit or suitability assessment.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>You may not use DIM map to:</p>
        <Table
          rows={[
            ["Deceive", "Impersonate someone else, or misrepresent who is writing."],
            ["Harass", "Send abusive, threatening or harassing messages."],
            ["Spam", "Contact people in breach of anti-spam law, or ignore opt-out requests."],
            ["Break the law", "Anything illegal in your jurisdiction or the recipient's."],
            ["Attack the service", "Probe, overload, or attempt to gain unauthorised access."],
          ]}
        />
        <p>We may suspend an account that does any of these, with notice where circumstances allow.</p>
      </Section>

      <Section heading="Third-party services">
        <p>
          DIM map connects to Lemlist, Meta (Lead Ads and WhatsApp Business), Slack and Anthropic.
          Your use of those services is governed by their own terms, and their availability is
          outside our control. If one of them changes or withdraws access, parts of DIM map may stop
          working.
        </p>
      </Section>

      <Section heading="Fees">
        <p>
          Paid plans are billed in advance for the period you select. Fees are non-refundable except
          where the law requires otherwise. We will give you notice before a price change takes
          effect, and you may cancel before it does.
        </p>
      </Section>

      <Section heading="Availability">
        <p>
          We aim to keep the service running but do not promise uninterrupted availability. We may
          take it down for maintenance, and will avoid doing so without warning where we can.
        </p>
      </Section>

      <Section heading="Ownership">
        <p>
          You keep all rights to your data, your configuration and the content you send. We keep all
          rights to the DIM map software itself. Nothing here transfers ownership either way.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          To the extent the law allows, DIM map is provided as is, and we are not liable for
          indirect or consequential loss, including lost profits, lost business or lost data. Our
          total liability in any twelve-month period is limited to what you paid us during that
          period. Nothing here limits liability that cannot legally be limited.
        </p>
      </Section>

      <Section heading="Ending the agreement">
        <p>
          You may stop using DIM map and close your account at any time. We may end this agreement
          if you materially breach these terms and do not fix it within a reasonable time after we
          tell you. On termination your access stops and your data is deleted as described in the{" "}
          <a href="/privacy" className="text-foreground underline underline-offset-4">Privacy Policy</a>.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          We may update these terms. If a change materially affects your rights we will tell you
          before it takes effect. Continuing to use the service after that means you accept the
          revised terms.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about these terms: <span className="text-foreground">{CONTACT}</span>.
        </p>
      </Section>
    </LegalLayout>
  );
}
