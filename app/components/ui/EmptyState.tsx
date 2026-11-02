import type { ReactNode } from "react";
import { PackageIcon } from "./icons";

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

/** Empty state explains the cause and offers an action (JOURNEYS §0). */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      <PackageIcon aria-hidden="true" className="text-text-faint" width={36} height={36} />
      <h3 className="text-sm font-extrabold text-text">{title}</h3>
      <p className="max-w-md text-sm text-text-muted">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
