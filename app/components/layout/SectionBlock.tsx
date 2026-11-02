import type { ReactNode } from "react";
import { Badge } from "~/components/ui";

/**
 * Section shell for storefront content blocks — the reference "section-head"
 * pattern: a 4px brand bar, the title, and an optional action link.
 */
export function SectionBlock({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-action" />
        <h2 id={id} className="text-lg font-extrabold text-text">
          {title}
        </h2>
        {action ? <div className="ms-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Honest placeholder for a storefront section whose data ships in a later
 * phase. It states the phase number instead of rendering mock products.
 */
export function PhaseSection({
  title,
  phase,
  note,
  action,
  id,
}: {
  title: string;
  phase: string;
  note: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <SectionBlock title={title} action={action} id={id}>
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
        <Badge tone="warning">{`Phase ${phase}`}</Badge>
        <p className="max-w-md text-sm leading-relaxed text-text-muted">{note}</p>
      </div>
    </SectionBlock>
  );
}
