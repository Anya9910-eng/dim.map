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
      title: "Connect your Lemlist account",
      detail: "Paste your Lemlist API key so DraftFly can see your campaigns and send approved replies.",
      done: settings.lemlist.hasApiKey,
      href: "/settings",
    },
    {
      key: "persona",
      title: "Create a persona",
      detail: "Tell the AI who it's writing as and how — tone, what to emphasise, what to avoid.",
      done: (personas?.length ?? 0) > 0,
      href: "/personas",
    },
    {
      key: "campaign",
      title: "Activate a campaign",
      detail: "Pick a Lemlist campaign, attach the persona, and switch it on.",
      done: settings.usage.activeCampaigns > 0,
      href: "/campaigns",
    },
    {
      key: "reply",
      title: "Receive your first reply",
      detail: "Point Lemlist's reply webhook at DraftFly (the URL is in Settings). The next reply becomes a draft.",
      done: settings.usage.repliesThisMonth > 0,
      href: "/settings",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done);

  return (
    <Card className="border-indigo-500/30" data-testid="setup-checklist">
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
