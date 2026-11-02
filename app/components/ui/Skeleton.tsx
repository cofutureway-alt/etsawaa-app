export interface SkeletonProps {
  className?: string;
  /** Visible to screen readers while the block is loading */
  label?: string;
}

/**
 * H-24 — Skeleton system. Every shape is a STABLE block (its own box is the
 * final box → CLS 0), pulses with the shared `animate-pulse` tokened style,
 * and freezes to a static shimmer under prefers-reduced-motion (globals.css
 * already zeroes animation durations there). Wrap the loading region with
 * aria-busy; pass `label` when nothing else describes what is loading.
 */
export function Skeleton({ className = "h-4 w-full", label }: SkeletonProps) {
  return (
    <span className="inline-flex flex-col gap-1" aria-busy="true">
      {label ? <span className="sr-only">{label}</span> : null}
      <span aria-hidden="true" className={`block animate-pulse rounded-m bg-border motion-reduce:animate-none ${className}`} />
    </span>
  );
}

/** One text line (or several stacked). */
export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  const widths = ["w-full", "w-5/6", "w-2/3"];
  return (
    <span aria-busy="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`block h-3.5 animate-pulse rounded-m bg-border motion-reduce:animate-none ${widths[Math.min(i, widths.length - 1)]}`}
        />
      ))}
    </span>
  );
}

/** Avatar / round placeholder (same box, same radius) — CLS 0. */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-block shrink-0 animate-pulse rounded-full bg-border motion-reduce:animate-none"
    />
  );
}

/** Card (loading a product/order/address tile). */
export function SkeletonCard() {
  return (
    <div className="rounded-l border border-border bg-surface p-4" aria-busy="true">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-3">
        <SkeletonText lines={3} />
      </div>
    </div>
  );
}

/** Product-card tile: fixed aspect-ratio image + two text lines. */
export function SkeletonProductCard() {
  return (
    <div className="rounded-l border border-border bg-surface p-3" aria-busy="true">
      <div aria-hidden="true" className="aspect-square w-full animate-pulse rounded-m bg-border motion-reduce:animate-none" />
      <div className="mt-2.5">
        <SkeletonText lines={2} />
      </div>
      <Skeleton className="mt-2 h-4 w-1/3" />
    </div>
  );
}

/** Data-table skeleton: header + N rows + pagination bar (fixed heights). */
export function SkeletonTable({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-l border border-border bg-surface" aria-busy="true">
      <div className="flex items-center gap-3 border-b border-border bg-surface-tint px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={`h-3.5 ${i === 0 ? "w-24" : "w-16"}`} />
        ))}
      </div>
      <ul>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
            {Array.from({ length: cols }, (_, j) => (
              <Skeleton key={j} className={`h-3 ${j === 0 ? "w-32" : "w-20"}`} />
            ))}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

/** Labeled form field skeleton (label line + input box), grid of N fields. */
export function SkeletonFormField({ className = "" }: { className?: string }) {
  return (
    <span aria-busy="true" className={`flex flex-col gap-1.5 ${className}`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-[46px] w-full" label={undefined} />
    </span>
  );
}
export function SkeletonForm({ fields = 4, twoCols = true }: { fields?: number; twoCols?: boolean }) {
  return (
    <div aria-busy="true" className={`grid gap-3 ${twoCols ? "sm:grid-cols-2" : ""}`}>
      {Array.from({ length: fields }, (_, i) => <SkeletonFormField key={i} />)}
      <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}

/** Admin chart placeholder (axes + bars, fixed height → CLS 0). */
export function SkeletonChart({ height = 220 }: { height?: number }) {
  const bars = [38, 62, 46, 80, 58, 70, 52];
  return (
    <div className="rounded-l border border-border bg-surface p-4" aria-busy="true" style={{ minHeight: height }}>
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex items-end gap-2" style={{ height: height - 80 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{ height: `${h}%` }}
            className="flex-1 animate-pulse rounded-t-m bg-border motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {bars.map((_, i) => <Skeleton key={i} className="h-2.5 flex-1" />)}
      </div>
    </div>
  );
}

/** Whole-route fallback (HydrateFallback default): banner + content blocks. */
export function SkeletonPage() {
  return (
    <div className="mx-auto w-full max-w-page px-4 py-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <div className="rounded-l border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <SkeletonCircle size={56} />
            <div className="flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </div>
          </div>
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
