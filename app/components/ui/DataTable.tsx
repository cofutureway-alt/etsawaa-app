import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";
import { Input } from "./Input";
import { TCell, Table, TRow } from "./Table";
import { foldSearch } from "~/lib/search-fold";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Pre-formatted cell content */
  render: (row: Row) => ReactNode;
  /** Plain text used by the filter + mobile card layout */
  text: (row: Row) => string;
}

export interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  searchPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
  rowKey: (row: Row) => string;
  caption?: string;
  /** Mobile card title (G5: tables become cards on phones) */
  cardTitle: (row: Row) => ReactNode;
  /** A page's own phone card; replaces the generic label/value card */
  renderCard?: (row: Row) => ReactNode;
}

/**
 * Client-side DataTable: search filter, empty state, and a card layout under
 * the md breakpoint (JOURNEYS rule: tables become cards).
 */
export function DataTable<Row>({
  columns,
  rows,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  rowKey,
  caption,
  cardTitle,
  renderCard,
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const visibleRows = useMemo(() => {
    // folded (hamza, ى/ي, digits…) and word by word, so a pasted title still matches
    const words = foldSearch(query.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ""))
      .split(/[\s,.;:()[\]"'\u060c\u061b\-\u2013\u2014/|+]+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((row) => {
      const hay = foldSearch(columns.map((column) => column.text(row)).join(" ").replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ""));
      return words.every((w) => hay.includes(w));
    });
  }, [rows, columns, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full sm:max-w-xs">
          <Input
            label={<span className="sr-only">{searchPlaceholder}</span>}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
          />
        </div>
        {/* The count lives beside the filter it describes, not in a footer
            icon row a user has to scroll past the table to reach. */}
        <p className="num shrink-0 text-xs font-bold text-text-muted" aria-live="polite">
          {visibleRows.length} / {rows.length}
        </p>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState title={rows.length === 0 ? emptyTitle : t("ui.datatable.empty")} body={emptyBody} />
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <Table columns={columns.map((c) => (typeof c.header === "string" ? c.header : String(c.key)))} caption={caption}>
              {visibleRows.map((row) => (
                <TRow key={rowKey(row)}>
                  {columns.map((column) => (
                    <TCell key={column.key}>{column.render(row)}</TCell>
                  ))}
                </TRow>
              ))}
            </Table>
          </div>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visibleRows.map((row) => renderCard ? (
              <li key={rowKey(row)}>{renderCard(row)}</li>
            ) : (
              <li key={rowKey(row)} className="rounded-lg border border-border bg-surface p-3 shadow-1">
                <div className="text-sm font-extrabold text-text">{cardTitle(row)}</div>
                <dl className="mt-2 flex flex-col gap-1 text-sm">
                  {columns.map((column) => (
                    <div key={column.key} className="flex justify-between gap-3">
                      <dt className="text-text-muted">{column.header}</dt>
                      <dd className="text-end text-text">{column.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

    </div>
  );
}
