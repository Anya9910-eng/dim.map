import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  MessageCircle,
  CheckCircle,
  Shield,
  GitMerge,
  BarChart,
  Mail,
  Bot,
  Send,
  ChevronRight,
  Flame,
  Megaphone,
  Filter,
  Inbox,
  MapPin,
} from "lucide-react";
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
import { Wordmark, CONTACT_EMAIL } from "@/components/brand";

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

/** The brand's highlight: forest green on light, salad green on dark. */
const HIGHLIGHT = "text-forest dark:text-sage";

const DEMO_STEPS = [
  {
    id: 0,
    label: "Lead arrives",
    icon: MessageCircle,
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground mb-4">New WhatsApp message — +971 50 111 2222</div>
        <div className="bg-background/60 border border-foreground/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">From</span>
            <span className="text-xs text-foreground/80">Sara Khan</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Campaign</span>
            <span className={`text-xs ${HIGHLIGHT}`}>Marina Tower launch — Meta ad</span>
          </div>
          <div className="border-t border-foreground/10 mt-3 pt-3">
            <p className="text-sm text-foreground/80 leading-relaxed">"Hi, is the 3-bed with sea view still available? Budget around 2.5M, looking to buy in the next 3 months."</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-forest dark:text-sage mt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-sage" />
          Buying intent detected — qualifying
        </div>
      </div>
    ),
  },
  {
    id: 1,
    label: "AI qualifies",
    icon: Filter,
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground mb-4">Qualification — reading buying signals</div>
        <div className="space-y-2">
          {[
            { label: "Budget", value: "AED 2.5M — matches 3-bed range", done: true },
            { label: "Timeline", value: "Buying within 3 months", done: true },
            { label: "Unit", value: "3-bed, sea view", done: true },
            { label: "Grade", value: "HOT — call today", done: false },
          ].map((row, i) => (
            <div key={i} className="flex items-center justify-between bg-background/60 border border-foreground/10 rounded-lg px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/70">{row.value}</span>
                {row.done ? (
                  <CheckCircle className="w-3 h-3 text-forest dark:text-sage shrink-0" />
                ) : (
                  <Flame className="w-3.5 h-3.5 text-forest dark:text-sage shrink-0" />
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
    label: "Reply drafted",
    icon: Bot,
    content: (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground mb-4">Draft ready — waiting for your approval</div>
        <div className="bg-background/60 border border-foreground/10 rounded-lg p-4">
          <div className="flex items-start gap-3 mb-3">
            <img src="/logo-mark.svg" alt="" className="w-8 h-8 rounded-md shrink-0" />
            <div>
              <span className="text-sm font-semibold text-foreground">DIM Convert</span>
              <span className="text-xs text-muted-foreground ml-2">2:04 PM</span>
            </div>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mist text-forest dark:bg-sage/15 dark:text-sage">Hot lead</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Reply to <strong className="text-foreground/80">Sara Khan</strong> on WhatsApp</p>
          <div className="bg-foreground/5 border border-foreground/10 rounded p-3 text-xs text-foreground/70 leading-relaxed mb-3">
            "Hi Sara! Yes — we still have two 3-beds with full sea view on the upper floors, both within your budget. Would Thursday or Saturday suit you for a private viewing?"
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-forest hover:bg-forest-soft text-white dark:bg-sage dark:text-forest dark:hover:bg-sage/90 text-xs font-medium transition-colors">
              <Send className="w-3 h-3" /> Approve & Send
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground/10 hover:bg-foreground/15 text-foreground/80 text-xs font-medium transition-colors">
              Edit Reply
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
          <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-4">Watch a buyer get qualified</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">From a WhatsApp message to a graded lead and a ready reply in seconds. No copy-pasting between apps.</p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-[280px_1fr] gap-6"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
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
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-all ${isActive ? "bg-mist border-sage/60 dark:bg-sage/10" : "bg-foreground/5 border-foreground/10"}`}>
                    <Icon className={`w-4 h-4 ${isActive ? HIGHLIGHT : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Step {i + 1}</div>
                    <div className="text-sm font-medium">{step.label}</div>
                  </div>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground shrink-0" />}
                </button>
              );
            })}

            <div className="hidden md:flex items-center gap-2 px-4 pt-2">
              <button
                onClick={() => setAuto((a) => !a)}
                className={`flex items-center gap-2 text-xs transition-colors ${auto ? HIGHLIGHT : "text-muted-foreground"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${auto ? "bg-sage" : "bg-muted-foreground"}`} />
                {auto ? "Auto-playing" : "Paused — click steps"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center px-4 py-3 border-b border-foreground/10 bg-foreground/[0.02]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
              </div>
              <div className="mx-auto text-xs text-muted-foreground">
                DIM Convert · {DEMO_STEPS[activeStep].label}
              </div>
              <div className="w-20 h-0.5 bg-foreground/10 rounded-full overflow-hidden ml-auto">
                <motion.div
                  key={activeStep}
                  className="h-full bg-sage rounded-full"
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
    <div className="min-h-screen bg-background text-foreground selection:bg-sage/40 font-sans overflow-x-hidden">

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-foreground/5 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-3">
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
                    <div className="container mx-auto text-center max-w-4xl relative z-10">
            <motion.div initial="hidden" animate="visible" variants={stagger}>
              <motion.div
                variants={fadeIn}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mist border border-sage/50 text-xs font-medium text-forest dark:bg-sage/10 dark:text-sage mb-8"
              >
                <MapPin className="w-3.5 h-3.5" /> For property developers &amp; brokers
              </motion.div>
              <motion.h1
                variants={fadeIn}
                className="font-display text-5xl md:text-7xl font-medium tracking-tight text-foreground leading-[1.08] mb-6 [text-wrap:balance]"
              >
                Every lead. Every channel. <br />
                <span className="text-forest dark:text-sage italic">
                  One place to convert them.
                </span>
              </motion.h1>

              <motion.p
                variants={fadeIn}
                className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
              >
                DIM Convert pulls in the leads from your cold email, Meta, Google and YouTube ads and WhatsApp, qualifies each buyer as hot, warm or cold, and drafts the reply — so your agents spend their day on viewings, not inboxes.
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

        {/* Lead feed visual — a calm glimpse of the Lead Inbox. */}
        <section className="py-10 px-6 relative z-10">
          <div className="container mx-auto max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="rounded-2xl border border-foreground/10 bg-card overflow-hidden shadow-[0_20px_60px_-30px_rgba(31,74,58,0.35)]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-foreground/10">
                <span className="text-sm font-semibold">Lead Inbox</span>
                <span className="text-xs text-muted-foreground">3 new today</span>
              </div>
              <div className="divide-y divide-foreground/5">
                {[
                  { name: "Sara K.", src: "WhatsApp", text: "3-bed with sea view, budget 2.5M, buying in 3 months", grade: "Hot", time: "9:15" },
                  { name: "Priya N.", src: "YouTube ad", text: "Saw the tour video. What yields on the Q4 units?", grade: "Warm", time: "9:14" },
                  { name: "Omar H.", src: "Meta ad", text: "2-bed off-plan, is there a payment plan?", grade: "Warm", time: "9:12" },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-9 h-9 rounded-full bg-mist dark:bg-sage/10 text-forest dark:text-sage flex items-center justify-center text-sm font-semibold shrink-0">
                      {row.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{row.name}</span>
                        <span className="text-xs text-muted-foreground">via {row.src}</span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">"{row.text}"</p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${row.grade === "Hot" ? "bg-forest text-white dark:bg-sage dark:text-forest" : "bg-mist text-forest dark:bg-sage/10 dark:text-sage"}`}>{row.grade}</span>
                    <span className="hidden sm:block shrink-0 text-xs text-muted-foreground w-10 text-right">{row.time}</span>
                  </div>
                ))}
              </div>
              <div className="bg-mist/60 dark:bg-sage/5 border-t border-foreground/10 px-6 py-5">
                <div className="text-xs font-medium text-muted-foreground mb-3">Suggested reply to Sara · WhatsApp</div>
                <p className="text-sm leading-relaxed text-foreground/85 mb-4 max-w-3xl">
                  "Hi Sara! Yes, two 3-beds with full sea view are still available, both within your budget. Would Thursday or Saturday suit you for a private viewing?"
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-8">Approve &amp; send</Button>
                  <Button size="sm" variant="outline" className="h-8 bg-transparent">Edit</Button>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24 px-6 relative">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-4">From ad spend to site visit</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">You pay for every lead. DIM Convert makes sure none of them go cold waiting for a reply.</p>
            </div>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { icon: Inbox, title: "1. Capture", desc: "Cold email replies, lead forms from Meta, Google Ads and YouTube, and WhatsApp chats land in one inbox." },
                { icon: Filter, title: "2. Qualify", desc: "AI reads budget, timeline, financing and unit type, and grades every buyer hot, warm, cold or unqualified." },
                { icon: Bot, title: "3. Draft", desc: "A reply in your project's voice — right channel, right length, never an invented price or handover date." },
                { icon: CheckCircle, title: "4. Approve", desc: "One click sends it back on WhatsApp or email. Your agents follow up with the hot ones first." },
              ].map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="relative"
                >
                  <div className="w-12 h-12 rounded-full bg-mist dark:bg-sage/10 flex items-center justify-center mb-6 relative z-10">
                    <step.icon className={`w-5 h-5 ${HIGHLIGHT}`} />
                  </div>
                  {i < 3 && <div className="hidden md:block absolute top-6 left-12 right-0 h-[1px] bg-sage/40" />}
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

        {/* Features — ad campaigns */}
        <section className="py-24 px-6 bg-foreground/[0.02] border-y border-foreground/5">
          <div className="container mx-auto max-w-6xl">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mist text-forest dark:bg-sage/10 dark:text-sage text-xs font-medium mb-6">
                  <Megaphone className="w-3.5 h-3.5" /> Meta, Google &amp; YouTube ads
                </div>
                <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-6">Your ad leads, answered in minutes.</h2>
                <p className="text-lg text-muted-foreground mb-6">A lead from Facebook, Instagram, Google or YouTube that waits a day is a lead your competitor already called. DIM Convert picks up every lead-form submission the moment it lands, reads the answers, and has a first message ready before your agent has finished their coffee.</p>
                <ul className="space-y-3">
                  {["Meta, Google Ads and YouTube lead forms, each mapped to its launch", "Form answers read as buying signals", "First reply sent over WhatsApp from your own number"].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-foreground/80">
                      <Shield className={`w-4 h-4 ${HIGHLIGHT}`} />
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
                                <div className="space-y-4 relative">
                  <div className="bg-background border border-foreground/5 p-4 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-2">Persona: Marina Tower sales team</div>
                    <div className="text-sm text-foreground/80">"1–3 bed apartments from AED 1.4M. 60/40 payment plan. Never quote a unit price — offer a viewing."</div>
                  </div>
                  <div className="bg-background border border-foreground/5 p-4 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-2">Qualification rule</div>
                    <div className="text-sm text-foreground/80">"Hot = budget over 1.4M and buying within 6 months. Investors asking for yield go to the investment desk."</div>
                  </div>
                  <div className="flex gap-2">
                    {["Hot", "Warm", "Cold"].map((g) => (
                      <span key={g} className={`text-xs font-medium px-3 py-1 rounded-full ${g === "Hot" ? "bg-forest text-white dark:bg-sage dark:text-forest" : "bg-foreground/5 text-muted-foreground border border-foreground/10"}`}>{g}</span>
                    ))}
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
              <GitMerge className={`w-10 h-10 mx-auto mb-6 ${HIGHLIGHT}`} />
              <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-6">Where your buyers already are.</h2>
              <p className="text-lg text-muted-foreground mb-12">Keep your ad accounts, your sequences and your WhatsApp number. DIM Convert sits on top as the layer that qualifies and answers. Lemlist, Meta, Google Ads, YouTube and WhatsApp are live today; CRM sync is on the way.</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { name: "Lemlist", status: "live" },
                  { name: "Meta Lead Ads", status: "live" },
                  { name: "Google Ads", status: "live" },
                  { name: "YouTube", status: "live" },
                  { name: "WhatsApp Business", status: "live" },
                  { name: "Slack", status: "live" },
                  { name: "HubSpot", status: "soon" },
                  { name: "Salesforce", status: "soon" },
                  { name: "Property Finder", status: "soon" },
                  { name: "Bayut", status: "soon" },
                ].map((tool, i) => (
                  <div
                    key={i}
                    className={`relative flex flex-col items-center justify-center h-20 rounded-xl border text-sm font-medium ${
                      tool.status === "live"
                        ? "bg-mist/60 border-sage/50 text-foreground/90 dark:bg-sage/5"
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
        <section className="py-24 px-6 bg-mist/70 dark:bg-card border-y border-foreground/5">
          <div className="container mx-auto max-w-6xl">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { metric: "< 5 min", label: "First response", desc: "Every lead gets a drafted reply the moment it arrives — nights and weekends included." },
                { metric: "5", label: "Lead sources, one inbox", desc: "Cold email, Meta, Google Ads, YouTube and WhatsApp side by side, each lead tagged by source." },
                { metric: "Hot first", label: "Agents' time spent right", desc: "Leads graded by budget and timeline, so the team calls buyers before browsers." },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="bg-background border border-foreground/10 rounded-2xl p-8"
                >
                  <BarChart className="w-6 h-6 text-forest dark:text-sage mb-6" />
                  <div className="font-display text-5xl font-medium text-forest dark:text-sage mb-4">{stat.metric}</div>
                  <div className="text-lg font-semibold text-foreground mb-2">{stat.label}</div>
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
              <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-4">Simple, transparent pricing</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Every plan starts with a 3-day free trial — no card needed. Pay monthly, cancel anytime. A brokerage running campaigns for several developers?{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=DIM%20map%20for%20brokerages`} className="text-foreground underline underline-offset-4 hover:text-forest dark:hover:text-sage transition-colors">Talk to us.</a>
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {[
                {
                  name: "Starter",
                  price: "$49",
                  desc: "For a single project or launch, before rolling it out across your portfolio.",
                  features: ["2 campaigns", "100 leads / mo", "All 5 lead sources", "AI lead qualification", "Replies in your project's voice", "Email support"],
                  cta: "Start free trial",
                  highlight: false,
                },
                {
                  name: "Growth",
                  price: "$149",
                  desc: "For developers and brokers running several launches and ad sets at once.",
                  features: ["10 campaigns", "500 leads / mo", "All 5 lead sources", "AI lead qualification", "Learns from your approved replies", "Priority support"],
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
                  className={`relative rounded-2xl border p-8 flex flex-col ${plan.highlight ? "border-forest/40 bg-mist/50 dark:border-sage/40 dark:bg-sage/5" : "border-foreground/10 bg-card"}`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-forest text-white dark:bg-sage dark:text-forest text-xs font-medium">
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
                        <CheckCircle className={`w-4 h-4 shrink-0 ${HIGHLIGHT}`} />
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
              <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight [text-wrap:balance] mb-4">Common questions</h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">Everything you need to know before you start.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Accordion type="single" collapsible className="space-y-3">
                {FAQ.map((item, i) => (
                  <AccordionItem
                    key={i}
                    value={`item-${i}`}
                    className="bg-card border border-foreground/10 rounded-xl px-6 data-[state=open]:border-sage/60 transition-colors"
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
                    <div className="container mx-auto max-w-2xl text-center relative z-10">
            <h2 className="font-display text-4xl md:text-5xl font-medium tracking-tight mb-6">Stop letting leads go cold.</h2>
            <p className="text-lg text-muted-foreground mb-8">Three days free, no card, nothing to install. Your first qualified lead is about ten minutes away.</p>
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
                className="bg-mist border border-sage/50 text-forest dark:bg-sage/10 dark:text-sage p-6 rounded-xl flex flex-col items-center gap-4"
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
                      placeholder="Jane Doe"
                      className="bg-background border-foreground/10 focus-visible:ring-sage h-12"
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
                      placeholder="jane@yourdevelopment.com"
                      className="bg-background border-foreground/10 focus-visible:ring-sage h-12"
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
          <div className="opacity-80">
            <Wordmark size="sm" />
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

const FAQ = [
  {
    q: "How does the free trial work?",
    a: "Sign up with your email — no card — and you get three days on Starter's limits: two active campaigns and a hundred leads. Connect Lemlist, a Meta, Google Ads or YouTube lead form, or your WhatsApp number, describe your project in a persona, switch a campaign on, and the next lead is qualified with a reply drafted. When the three days are up, pick a plan to carry on; nothing you set up is lost.",
  },
  {
    q: "Who is DIM Convert for?",
    a: "Property developers and real-estate brokers who generate leads from outbound email, Meta (Facebook and Instagram), Google Ads and YouTube lead ads, and WhatsApp — and lose buyers because nobody answers fast enough, or because agents spend their day on tyre-kickers.",
  },
  {
    q: "How does lead qualification work?",
    a: "Every incoming message or form is read for the signals that matter in property: budget, timeline to buy, financing, own-use or investment, and the unit or location they want. Each lead is graded hot, warm, cold or unqualified, with a one-line reason. You can write your own qualification rules per project, and they take priority.",
  },
  {
    q: "Which channels does it work with?",
    a: "Lemlist for cold email and LinkedIn replies; Meta Lead Ads for Facebook and Instagram forms; Google Ads lead forms, including on YouTube video campaigns; and WhatsApp Business for inbound chats — all live today. Approved replies go back through Lemlist for email leads, and from your own WhatsApp Business number for WhatsApp chats and ad leads who left a phone number. CRM sync is on the roadmap.",
  },
  {
    q: "Does it replace my sales agents?",
    a: "No. DIM Convert does the first touch and the triage; your agents do the viewings and the closing. Every reply waits for a person to approve it before it is sent, and the AI never invents prices, availability, payment plans or handover dates — if it doesn't know, it offers a call.",
  },
  {
    q: "Can I run Meta, Google and YouTube ad campaigns through it?",
    a: "Yes. Connect each lead form — Meta Instant Forms, or Google Ads lead forms on Search, Performance Max and YouTube — to a campaign in DIM Convert, and every submission arrives with the form answers attached, ready to qualify and answer. Google and YouTube forms connect directly with the webhook URL from your Settings; Meta connects directly or through n8n, Zapier or Make.",
  },
  {
    q: "Is my buyers' data secure?",
    a: "DIM Convert stores what it needs to qualify and reply and to keep an approval record: the lead's name, contact details and message, plus the draft and who approved it. That data is deleted automatically after 12 months. Everything travels over TLS, API keys and tokens are encrypted at rest, each account sees only its own leads, and deleting an account removes its leads and configuration with it.",
  },
];
