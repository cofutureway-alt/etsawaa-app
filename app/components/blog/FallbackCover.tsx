/**
 * U2 — deterministic fallback cover for a post with no artwork.
 * Flat tokens only (no gradients, no images): a tinted panel carrying the
 * category label and the title's initials. The same input always renders the
 * same cover, so list/related/article agree and nobody sees an empty slot at
 * any width.
 */

const PALETTE = ["primary", "accent", "featured", "success", "warning"] as const;

/** stable 0..n-1 bucket from a string (FNV-1a — deterministic across renders) */
export function coverTone(seed: string, buckets = PALETTE.length): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % buckets;
}

/** up to 2 leading graphemes of the first two words ("دليل الشراء" → "دش") */
export function coverInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = words.map((w) => [...w][0] ?? "").join("");
  return letters.slice(0, 2) || "؟";
}

const TONE_CLASS: Record<string, string> = {
  primary: "bg-primary-soft text-primary border-primary/25",
  accent: "bg-surface-tint text-accent border-accent/25",
  featured: "bg-surface-tint text-featured border-featured/30",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-surface-tint text-warning border-warning/30",
};

export function FallbackCover({
  title,
  category,
  seed,
  className = "",
}: {
  title: string;
  category?: string;
  /** defaults to the title — stable per post */
  seed?: string;
  className?: string;
}) {
  const tone = PALETTE[coverTone(seed ?? title)] ?? "primary";
  return (
    <div
      aria-hidden="true"
      data-fallback-cover=""
      className={`flex aspect-[600/315] w-full flex-col items-center justify-center gap-1.5 border-b p-4 text-center ${TONE_CLASS[tone]} ${className}`}
    >
      <span className="text-2xl font-black leading-none tracking-tight">{coverInitials(title)}</span>
      {category ? (
        <span className="max-w-full truncate text-[11px] font-bold uppercase tracking-wide opacity-80">
          {category}
        </span>
      ) : null}
    </div>
  );
}
