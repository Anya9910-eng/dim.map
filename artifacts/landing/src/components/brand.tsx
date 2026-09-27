/** The DIM map mark and wordmark: "DIM" in the text colour, "map" in the brand green. */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const img = size === "sm" ? "h-5" : "h-9";
  const text = size === "sm" ? "text-sm" : "text-2xl";
  return (
    <span className="flex items-center gap-2">
      <img src="/logo-mark.svg" alt="" className={`${img} w-auto`} />
      <span className={`${text} font-extrabold tracking-tight text-foreground`}>
        DIM <span className="text-emerald-800 dark:text-lime-400">map</span>
      </span>
    </span>
  );
}

/** The mailbox published on the site — the one place people can reach a person. */
export const CONTACT_EMAIL = "outreach@draftfly.app";
