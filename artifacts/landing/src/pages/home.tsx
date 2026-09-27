import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, MessageSquare, Slack, CheckCircle, Zap, Shield, GitMerge, BarChart, Mail, Bot, Send, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

const DASHBOARD_URL = "/app";
const SIGNUP_URL = "/app/signup";

function startTrial() {
  window.location.href = SIGNUP_URL;
}

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } },
};

const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const DEMO_STEPS = [
  {
    id: 0,
    label: "Reply detected",
    icon: Mail,
    color: "text-blue-400",
    bg: "bg-blue-400/10 border-blue-400/20",
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground font-mono mb-4">Incoming reply — Lemlist webhook</div>
        <div className="bg-background/60 border border-foreground/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">From</span>
            <span className="text-xs font-mono text-foreground/80">j.smith@acmecorp.io</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Campaign</span>
            <span className="text-xs font-mono text-primary">Q3 Enterprise Outbound</span>
          </div>
          <div className="border-t border-foreground/10 mt-3 pt-3">
            <p className="text-sm text-foreground/80 leading-relaxed">"Hey, actually this looks interesting. Can you tell me more about pricing and how the onboarding works?"</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-green-400 font-mono mt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Positive intent detected — routing to AI
        </div>
      </div>
    ),
  },
  {
    id: 1,
    label: "AI drafting",
    icon: Bot,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/20",
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground font-mono mb-4">AI model — context loading</div>
        <div className="space-y-2">
          {[
            { label: "Persona", value: "Enterprise CTO — Acme Corp", done: true },
            { label: "Thread context", value: "3 previous emails loaded", done: true },
            { label: "Tone rules", value: "Technical, concise, no fluff", done: true },
            { label: "Draft", value: "Generating...", done: false },
          ].map((row, i) => (
            <div key={i} className="flex items-center justify-between bg-background/60 border border-foreground/10 rounded-lg px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-foreground/70">{row.value}</span>
                {row.done ? (
                  <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                ) : (
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((j) => (
                      <span
                        key={j}
                        className="w-1 h-1 rounded-full bg-yellow-400 animate-bounce"
                        style={{ animationDelay: `${j * 0.15}s` }}
                      />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 2,
    label: "Slack approval",
    icon: Slack,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground font-mono mb-4">Posted to #sales-approvals</div>
        <div className="bg-background/60 border border-foreground/10 rounded-lg p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-sm bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="text-sm font-semibold text-foreground">DraftFly</span>
              <span className="text-xs text-muted-foreground ml-2">2:04 PM</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">New draft — <strong className="text-foreground/80">John Smith (Acme Corp)</strong></p>
          <div className="bg-foreground/5 border border-foreground/10 rounded p-3 text-xs text-foreground/70 leading-relaxed mb-3">
            "Hi John, happy to break down pricing for you. For an org your size, our Enterprise tier is the right fit — it includes SSO, dedicated onboarding and SLA guarantees. Onboarding typically takes 2 weeks..."
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors">
              <Send className="w-3 h-3" /> Approve & Send
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-foreground/10 hover:bg-foreground/15 text-foreground/80 text-xs font-medium transition-colors">
              Edit Draft
            </button>
          </div>
        </div>
      </div>
    ),
  },
];

function DemoSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const interval = setInterval(() => {
      setActiveStep((s) => (s + 1) % DEMO_STEPS.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [auto]);

  const handleStep = (i: number) => {
    setAuto(false);
    setActiveStep(i);
  };

  return (
    <section className="py-24 px-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none" />
      <div className="container mx-auto max-w-6xl relative z-10">
        <motion.div
          className="text-center mb-14"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-foreground/5 border border-foreground/10 text-xs font-medium text-muted-foreground mb-6">
            Live demo
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Watch a reply get handled</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">From inbox to Slack in under 3 seconds. No manual writing, no context switching.</p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-[280px_1fr] gap-6"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          {/* Step tabs */}
          <div className="flex flex-col gap-2">
            {DEMO_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = activeStep === i;
              return (
                <button
                  key={step.id}
                  onClick={() => handleStep(i)}
                  className={`flex items-center gap-3 px-4 py-4 rounded-xl border text-left transition-all duration-300 w-full ${
                    isActive
                      ? "bg-foreground/5 border-foreground/20 text-foreground"
                      : "border-foreground/5 text-muted-foreground hover:border-foreground/10 hover:text-foreground/70"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-all ${isActive ? step.bg : "bg-foreground/5 border-foreground/10"}`}>
                    <Icon className={`w-4 h-4 ${isActive ? step.color : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Step {i + 1}</div>
                    <div className="text-sm font-medium">{step.label}</div>
                  </div>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground shrink-0" />}
                </button>
              );
            })}

            {/* Auto-play indicator */}
            <div className="hidden md:flex items-center gap-2 px-4 pt-2">
              <button
                onClick={() => setAuto((a) => !a)}
                className={`flex items-center gap-2 text-xs transition-colors ${auto ? "text-primary" : "text-muted-foreground"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${auto ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                {auto ? "Auto-playing" : "Paused — click steps"}
              </button>
            </div>
          </div>

          {/* Content panel */}
          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center px-4 py-3 border-b border-foreground/10 bg-foreground/[0.02]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/30 border border-red-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/30 border border-yellow-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/30 border border-green-500/50" />
              </div>
              <div className="mx-auto text-xs text-muted-foreground font-mono">
                draftfly — {DEMO_STEPS[activeStep].label.toLowerCase()}
              </div>
              {/* Progress bar */}
              <div className="w-20 h-0.5 bg-foreground/10 rounded-full overflow-hidden ml-auto">
                <motion.div
                  key={activeStep}
                  className="h-full bg-primary rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: auto ? 3.2 : 0 }}
                />
              </div>
            </div>

            <div className="p-6 md:p-8 min-h-[300px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeStep}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {DEMO_STEPS[activeStep].content}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** The mailbox published on the legal pages — the one place people can reach a person. */
const CONTACT_EMAIL = "outreach@draftfly.app";

export default function Home() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { theme, setTheme } = useTheme();

  // The landing page and the API share an origin in production (one server
  // serves both), so a relative path reaches /api on every deployment.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name.trim()) {
      toast({
        title: "Missing fields",
        description: "Please enter your name and email.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Could not send your request",
          description: body.error ?? `Please try again, or email ${CONTACT_EMAIL}.`,
          variant: "destructive",
        });
        return;
      }
      setSubmitted(true);
    } catch {
      toast({
        title: "Could not reach the server",
        description: `Please try again, or email ${CONTACT_EMAIL}.`,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 font-sans overflow-x-hidden">

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-foreground/5 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-mark.svg" alt="" className="h-9 w-auto" />
            <span className={`text-2xl font-bold ${theme === "dark" ? "text-foreground" : "text-black"}`}>DraftFly</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <div className="hidden sm:flex items-center bg-foreground/5 border border-foreground/10 rounded-lg p-0.5">
              <button
                onClick={() => setTheme("light")}
                title="Light"
                className={`p-1.5 rounded transition-all ${theme === "light" ? "bg-foreground/20 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTheme("dark")}
                title="Dark"
                className={`p-1.5 rounded transition-all ${theme === "dark" ? "bg-foreground/20 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
            >
              Pricing
            </button>
            <a
              href={DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </a>
            <Button size="sm" onClick={startTrial}>
              Start free trial
            </Button>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="pt-40 pb-20 md:pt-52 md:pb-32 px-6 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <motion.div initial="hidden" animate="visible" variants={stagger}>
              <motion.h1
                variants={fadeIn}
                className="text-5xl md:text-7xl font-bold tracking-tight text-foreground leading-[1.1] mb-6"
              >
                The inbox is chaos. <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-indigo-400">
                  We make it a pipeline.
                </span>
              </motion.h1>

              <motion.p
                variants={fadeIn}
                className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
              >
                Get on-brand replies for your campaigns drafted and waiting for you before you've even seen the prospect's email — powered by AI, approved in one click.
              </motion.p>

              <motion.div
                variants={fadeIn}
                className="flex flex-col sm:flex-row items-center justify-center gap-4"
              >
                <Button
                  size="lg"
                  className="h-12 px-8 text-base w-full sm:w-auto group"
                  onClick={startTrial}
                >
                  Start free trial
                  <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 px-8 text-base w-full sm:w-auto bg-transparent border-foreground/10 hover:bg-foreground/5"
                  onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}
                >
                  See how it works
                </Button>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Operator log visual */}
        <section className="py-10 px-6 relative z-10">
          <div className="container mx-auto max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="rounded-xl border border-white/10 bg-[#0A0A0F]/80 backdrop-blur-xl overflow-hidden shadow-2xl shadow-primary/5"
            >
              <div className="flex items-center px-4 py-3 border-b border-white/10 bg-white/5">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                  <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                </div>
                <div className="mx-auto text-xs text-muted-foreground font-mono">draftfly-operator-log</div>
              </div>
              <div className="p-6 md:p-8 font-mono text-sm md:text-base leading-relaxed text-muted-foreground">
                <div className="flex items-start gap-4 mb-4">
                  <span className="text-blue-400 shrink-0">14:02:11</span>
                  <span className="text-white/80">Incoming reply detected: <span className="text-primary">"Tell me more about pricing"</span> from j.smith@acme.co</span>
                </div>
                <div className="flex items-start gap-4 mb-4">
                  <span className="text-blue-400 shrink-0">14:02:12</span>
                  <span className="text-white/80">AI drafting response based on <span className="text-yellow-400">Acme_Corp_Persona</span> context...</span>
                </div>
                <div className="flex items-start gap-4 mb-4">
                  <span className="text-blue-400 shrink-0">14:02:14</span>
                  <span className="text-green-400">Draft completed. Routing to #sales-approvals in Slack.</span>
                </div>
                <div className="mt-8 pt-6 border-t border-white/10 relative">
                  <div className="absolute top-[-10px] left-8 bg-[#0A0A0F] px-2 text-xs text-muted-foreground">Slack Notification</div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-white font-sans font-medium mb-1">DraftFly Bot <span className="text-xs font-normal text-muted-foreground ml-2">2:02 PM</span></p>
                      <p className="text-white/80 font-sans text-sm mb-3">New draft ready for <strong>John Smith (Acme Corp)</strong>.</p>
                      <div className="bg-white/5 border border-white/10 rounded-md p-4 font-sans text-sm text-white/70 mb-3">
                        "Hi John, happy to share pricing details. For a team your size, our Enterprise tier makes the most sense..."
                      </div>
                      <div className="flex gap-2 font-sans">
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white border-0">Approve &amp; Send</Button>
                        <Button size="sm" variant="outline" className="h-8 border-white/10 hover:bg-white/5">Edit Draft</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24 px-6 relative">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">A system built for scale</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Stop digging through shared inboxes. DraftFly creates a deterministic, highly-visible workflow for handling replies.</p>
            </div>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { icon: MessageSquare, title: "1. Intercept", desc: "Monitors your sending domains and pulls positive or interrogative replies instantly." },
                { icon: Zap, title: "2. Draft", desc: "Uses AI to generate highly contextual, persona-matched responses in seconds." },
                { icon: Slack, title: "3. Route", desc: "Pushes the draft, context, and original thread into a dedicated Slack channel." },
                { icon: CheckCircle, title: "4. Approve", desc: "One click in Slack to approve and send, or drop into the web app to edit." },
              ].map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="relative"
                >
                  <div className="w-12 h-12 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center mb-6 relative z-10">
                    <step.icon className="w-5 h-5 text-primary" />
                  </div>
                  {i < 3 && <div className="hidden md:block absolute top-6 left-12 right-0 h-[1px] bg-gradient-to-r from-white/10 to-transparent" />}
                  <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive demo */}
        <div id="demo">
          <DemoSection />
        </div>

        {/* Features */}
        <section className="py-24 px-6 bg-foreground/[0.02] border-y border-foreground/5">
          <div className="container mx-auto max-w-6xl">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-6">
                  Operator Grade
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Precision context mapping.</h2>
                <p className="text-lg text-muted-foreground mb-6">Generic AI replies destroy trust. DraftFly uses Persona mapping to ensure every drafted response aligns with the specific campaign context, pricing tier, and pain points the prospect was initially pitched.</p>
                <ul className="space-y-3">
                  {["Campaign-specific instructions", "Historical context retention", "Tone and style matching"].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-foreground/80">
                      <Shield className="w-4 h-4 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="relative aspect-square md:aspect-auto md:h-[400px] rounded-xl bg-card border border-foreground/10 overflow-hidden p-6"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                <div className="space-y-4">
                  <div className="bg-background border border-foreground/5 p-4 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-2">Persona: Enterprise CTO</div>
                    <div className="font-mono text-sm text-foreground/80">"Emphasize SOC2 compliance and SSO availability. Keep tone technical but concise."</div>
                  </div>
                  <div className="bg-background border border-foreground/5 p-4 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-2">Persona: VP Sales</div>
                    <div className="font-mono text-sm text-foreground/80">"Focus on ROI and ramp time. Mention the recent case study with Acme Corp."</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="py-24 px-6 relative">
          <div className="container mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <GitMerge className="w-10 h-10 text-primary mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Plugs into your stack.</h2>
              <p className="text-lg text-muted-foreground mb-12">No need to replace your sending infrastructure. DraftFly sits on top of your existing tools and acts as a routing layer. Lemlist and Slack are live today; the rest are on the way.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { name: "Lemlist", status: "live" },
                  { name: "Slack", status: "live" },
                  { name: "Smartlead", status: "soon" },
                  { name: "Instantly", status: "soon" },
                  { name: "Gmail Workspace", status: "soon" },
                  { name: "Outlook", status: "soon" },
                  { name: "HubSpot", status: "soon" },
                  { name: "Salesforce", status: "soon" },
                ].map((tool, i) => (
                  <div
                    key={i}
                    className={`relative flex flex-col items-center justify-center h-20 rounded-xl border text-sm font-medium ${
                      tool.status === "live"
                        ? "bg-foreground/5 border-foreground/10 text-foreground/80"
                        : "bg-foreground/[0.02] border-dashed border-foreground/10 text-foreground/40"
                    }`}
                  >
                    {tool.name}
                    {tool.status === "soon" && (
                      <span className="mt-1 text-[10px] uppercase tracking-wider text-foreground/30">Coming soon</span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ROI */}
        <section className="py-24 px-6 bg-foreground/[0.02] border-y border-foreground/5">
          <div className="container mx-auto max-w-6xl">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { metric: "4x", label: "Faster response times", desc: "SDRs approve drafts in seconds instead of writing from scratch." },
                { metric: "100%", label: "Visibility", desc: "No more black-box inboxes. Every reply is tracked in Slack." },
                { metric: "0", label: "Context lost", desc: "AI retains full thread history and persona data for every reply." },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="bg-card border border-foreground/10 rounded-2xl p-8"
                >
                  <BarChart className="w-6 h-6 text-primary mb-6" />
                  <div className="text-5xl font-bold text-foreground mb-4">{stat.metric}</div>
                  <div className="text-lg font-semibold text-foreground/90 mb-2">{stat.label}</div>
                  <p className="text-muted-foreground text-sm leading-relaxed">{stat.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 relative">
          <div className="container mx-auto max-w-6xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-foreground/5 border border-foreground/10 text-xs font-medium text-muted-foreground mb-6">
                Pricing
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Simple, transparent pricing</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Every plan starts with a 3-day free trial — no card needed. Pay monthly, cancel anytime. Running outreach for several clients?{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=DraftFly%20for%20agencies`} className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">Talk to us.</a>
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {[
                {
                  name: "Starter",
                  price: "$49",
                  desc: "For running DraftFly on a campaign or two before rolling it out further.",
                  features: ["2 campaigns", "100 replies / mo", "AI drafting in your voice", "Approve in the dashboard", "Slack approvals (optional)", "Email support"],
                  cta: "Start free trial",
                  highlight: false,
                },
                {
                  name: "Growth",
                  price: "$149",
                  desc: "For teams running real outreach across several campaigns at once.",
                  features: ["10 campaigns", "500 replies / mo", "AI drafting in your voice", "Learns from your approved replies", "Slack approvals (optional)", "Priority support"],
                  cta: "Start free trial",
                  highlight: true,
                },
              ].map((plan, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className={`relative rounded-2xl border p-8 flex flex-col ${plan.highlight ? "border-primary bg-primary/5" : "border-foreground/10 bg-card"}`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-white text-xs font-semibold">
                      Most popular
                    </div>
                  )}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-foreground mb-1">{plan.name}</h3>
                    <div className="flex items-end gap-1 mb-3">
                      <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-muted-foreground mb-1">/month</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{plan.desc}</p>
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-center gap-3 text-sm text-foreground/80">
                        <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="lg"
                    variant={plan.highlight ? "default" : "outline"}
                    className={`w-full ${!plan.highlight ? "border-foreground/10 hover:bg-foreground/5 bg-transparent" : ""}`}
                    onClick={startTrial}
                  >
                    {plan.cta}
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-24 px-6 relative">
          <div className="container mx-auto max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-14"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-foreground/5 border border-foreground/10 text-xs font-medium text-muted-foreground mb-6">
                FAQ
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Common questions</h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">Everything you need to know before you request access.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  {
                    q: "How does the free trial work?",
                    a: "Sign up with your email — no card — and you get three days on Starter's limits: two active campaigns, a hundred replies. Connect Lemlist, add a persona, switch a campaign on, and the next reply becomes a draft. When the three days are up, pick a plan to carry on; nothing you set up is lost in the meantime.",
                  },
                  {
                    q: "What does DraftFly actually do?",
                    a: "DraftFly connects your inbox, AI drafting engine, and Slack approvals into one deterministic workflow. When a reply comes in, our backend detects it, generates a contextual draft using AI, and routes it to the right Slack channel for human approval — before anything is sent.",
                  },
                  {
                    q: "Does it replace my SDRs?",
                    a: "No. DraftFly is a precision tool for your reps, not a replacement. Every draft requires human approval before it leaves your domain. We eliminate the time spent writing, not the judgment call on whether to send.",
                  },
                  {
                    q: "What sending tools does it work with?",
                    a: "Lemlist, today: replies to your Lemlist campaigns reach DraftFly by webhook the moment they arrive, and approved replies go back out through Lemlist from the same mailbox that sent the campaign. Smartlead, Instantly, Gmail Workspace, Outlook, HubSpot and Salesforce are on the roadmap but not live yet. DraftFly sits on top of your sending tool — there is nothing to migrate.",
                  },
                  {
                    q: "How does the AI know what to write?",
                    a: "DraftFly uses Persona profiles — per-campaign instructions that tell the AI the prospect's role, pain points, tone expectations, and deal context. The model also loads the full email thread before drafting, so replies are always contextually grounded.",
                  },
                  {
                    q: "What is DraftFly's API?",
                    a: "The API is the internal operating layer that connects reply detection, AI drafting, Slack routing, and email sending. Think of it as the nervous system of the product — it's not a public developer API, but the backbone that lets every part of the service talk to each other in real time.",
                  },
                  {
                    q: "Is my email data secure?",
                    a: "DraftFly stores what it needs to draft and to keep an approval record: the prospect's name, email address and the text of their reply, plus the draft and who approved it. That data is deleted automatically after 12 months. Everything travels over TLS, each client's users see only that client's drafts, and deleting a client removes its drafts and configuration with it.",
                  },
                ].map((item, i) => (
                  <AccordionItem
                    key={i}
                    value={`item-${i}`}
                    className="bg-card border border-foreground/10 rounded-xl px-6 data-[state=open]:border-foreground/20 transition-colors"
                  >
                    <AccordionTrigger className="text-left text-sm font-medium text-foreground/90 hover:no-underline py-5">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-5">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </motion.div>
          </div>
        </section>

        {/* Early access form */}
        <section id="early-access" className="py-32 px-6 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
          <div className="container mx-auto max-w-2xl text-center relative z-10">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Ready to regain control?</h2>
            <p className="text-lg text-muted-foreground mb-8">Three days free, no card, nothing to install. Your first drafted reply is about ten minutes away.</p>
            <Button size="lg" className="h-12 px-8 text-base group mb-14" onClick={startTrial}>
              Start free trial
              <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>

            <h3 className="text-xl font-semibold mb-2">Prefer a walkthrough first?</h3>
            <p className="text-sm text-muted-foreground mb-6">Leave your details and we'll reply by email — usually within a day.</p>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-green-500/10 border border-green-500/20 text-green-400 p-6 rounded-xl flex flex-col items-center gap-4"
              >
                <CheckCircle className="w-8 h-8" />
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-1">Got it</h3>
                  <p className="text-sm">We've got your request and will reply by email.</p>
                </div>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-card border border-foreground/10 p-8 rounded-2xl shadow-xl text-left">
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Full Name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      name="name"
                      autoComplete="name"
                      required
                      placeholder="John Doe"
                      className="bg-background border-foreground/10 focus-visible:ring-primary h-12"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Work Email</label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      name="email"
                      autoComplete="email"
                      required
                      type="email"
                      placeholder="john@company.com"
                      className="bg-background border-foreground/10 focus-visible:ring-primary h-12"
                    />
                  </div>
                </div>
                <Button type="submit" size="lg" className="w-full h-12 text-base" disabled={submitting}>
                  {submitting ? "Sending…" : "Request a walkthrough"}
                </Button>
              </form>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/10 py-12 px-6 bg-background">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center">
            <div className="flex items-center gap-1.5 opacity-70">
              <img src="/logo-mark.svg" alt="" className="h-5 w-auto" />
              <span className={`text-sm font-bold ${theme === "dark" ? "text-foreground" : "text-black"}`}>DraftFly</span>
            </div>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground transition-colors">{CONTACT_EMAIL}</a>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
