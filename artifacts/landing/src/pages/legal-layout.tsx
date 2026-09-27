import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Wordmark, PARENT_URL, PARENT_TAGLINE } from "@/components/brand";

/**
 * Shared chrome for the Privacy and Terms pages.
 *
 * These exist as real routes rather than a modal or an anchor because Slack's
 * app-directory review fetches the privacy policy URL directly, and so do the
 * procurement checks a B2B buyer runs before signing.
 */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="container mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <Wordmark size="sm" />
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to site
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </main>

      <footer className="border-t border-foreground/10 py-10 px-6">
        <div className="container mx-auto max-w-3xl flex flex-wrap gap-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">DIM Convert</Link>
          <a href={PARENT_URL} className="hover:text-foreground transition-colors">DIM · {PARENT_TAGLINE}</a>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
        </div>
      </footer>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  );
}

export function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {rows.map(([left, right]) => (
            <tr key={left} className="border-b border-foreground/10 last:border-0">
              <td className="py-2.5 pr-6 align-top font-medium text-foreground whitespace-nowrap">{left}</td>
              <td className="py-2.5 align-top">{right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
