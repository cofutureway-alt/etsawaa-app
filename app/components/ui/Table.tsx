import type { ReactNode } from "react";

export interface TableProps {
  columns: string[];
  caption?: string;
  children: ReactNode;
}

/** Semantic table; container scrolls on narrow screens so the page never does (G5). */
export function Table({ columns, caption, children }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full min-w-max border-collapse text-start text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-surface-alt">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 text-start text-sm font-extrabold text-text-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-surface-tint">{children}</tr>;
}

export function TCell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-text ${className}`}>{children}</td>;
}
