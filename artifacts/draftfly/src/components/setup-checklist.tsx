import { Link } from "wouter";
import { useListPersonas } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { useMySettings } from "@/hooks/use-my-settings";

/**
 * The four things between a fresh signup and a first drafted reply, in the
 * order they have to happen. Shown on a client's dashboard until all four
 * are done, then never again.
 *
 * Each step is judged from server state, not from a "done" flag the user
 * ticks: a step is done when the thing exists. So it is also correct for a
 * client the operator set up by hand, and it cannot drift.
 */
export function SetupChecklist() {
  const { data: settings } = useMySettings();
  const { data: personas } = useListPersonas();
  if (!settings) return null;

  const steps = [
    {
      key: "lemlist",
      title: "Connect a lead source",
      detail: "Add your Lemlist API key, or your WhatsApp Business details, in Settings — or connect a Meta lead form on the Campaigns page.",
      // A Meta-only account needs no key at all: its leads arrive by webhook
      // once a Meta campaign exists.
      done: settings.lemlist.hasApiKey || !!settings.whatsapp?.hasAccessToken || settings.usage.totalCampaigns > 0,
      href: "/settings",
    },
    {
      key: "persona",
      title: "Create a sales persona",
      detail: "Describe your project — units, price range, payment plans — and how your team talks to buyers.",
      done: (personas?.length ?? 0) > 0,
      href: "/personas",
    },
    {
      key: "campaign",
      title: "Activate a campaign",
      detail: "Pick a Lemlist campaign, Meta lead form or WhatsApp line, attach the persona, and switch it on.",
      done: settings.usage.activeCampaigns > 0,
      href: "/campaigns",
    },
    {
      key: "reply",
      title: "Receive your first lead",
      detail: "Point your Lemlist, Meta or WhatsApp webhook at DIM map (the URLs are in Settings). The next lead is qualified and gets a draft.",
      done: settings.usage.repliesThisMonth > 0,
      href: "/settings",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done);

  return (
    <Card className="border-primary/30" data-testid="setup-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Get set up</CardTitle>
            <CardDescription>
              {doneCount} of {steps.length} done — {next ? `next: ${next.title.toLowerCase()}` : ""}
            </CardDescription>
          </div>
          <div className="w-32">
            <Progress value={(doneCount / steps.length) * 100} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {steps.map((step) => (
          <Link
            key={step.key}
            href={step.href}
            data-testid={`setup-step-${step.key}`}
            data-done={step.done}
            className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
              step.done ? "opacity-60" : "hover:bg-muted/50"
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${step.done ? "line-through" : ""}`}>{step.title}</div>
              {!step.done && <div className="text-xs text-muted-foreground mt-0.5">{step.detail}</div>}
            </div>
            {!step.done && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
