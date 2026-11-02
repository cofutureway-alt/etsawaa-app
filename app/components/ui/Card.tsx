import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Renders as <section> with an accessible name */
  labelledBy?: string;
}

/** Flat surface card — border + subtle shadow only, no gradients. */
export function Card({ children, className = "", labelledBy }: CardProps) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`rounded-lg border border-border bg-surface shadow-1 ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, id, action }: { title: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h3 id={id} className="text-sm font-extrabold text-text">
        {title}
      </h3>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
