/**
 * No-leaf-selected landing view: one server-side page (30) of live product
 * types, each showing how many attributes it already has (owned + linked).
 * Search and paging live in the URL (`?q=`, `?page=`) and run in the database
 * (`fn_admin_leaf_page`), so the catalog size never reaches the browser.
 * Picking a leaf sets `?cat=<id>`.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/layout/PageHeader";
import { ChevronRightIcon, SearchIcon } from "~/components/ui/icons";
import { Pagination } from "~/components/ui/Pagination";
import type { LeafCategory } from "./attributes.shared";

export function LeafPicker({ leaves, total, page, perPage, query }: {
  leaves: Array<Omit<LeafCategory, "depth"> & { attr_count: number }>;
  total: number;
  page: number;
  perPage: number;
  query: string;
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const navigate = useNavigate();
  const [text, setText] = useState(query);

  // search as you type (debounced); a new search starts at page 1
  useEffect(() => {
    if (text.trim() === query) return;
    const timer = window.setTimeout(() => {
      const q = text.trim();
      navigate(q ? `?q=${encodeURIComponent(q)}` : "?", { replace: true, preventScrollReset: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [text, query, navigate]);

  const hrefFor = (p: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (p > 1) sp.set("page", String(p));
    return `?${sp.toString()}`;
  };
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("catalog.attributes")} subtitle={t("catalog.pickLeaf")} count={t("catalog.typeCount", { count: total })} />
      <label className="relative block">
        <span className="sr-only">{t("common.search")}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("catalog.searchTypes")}
          className="w-full rounded-md border border-border bg-surface py-2.5 ps-9 pe-3 text-sm text-text focus:border-action focus:outline-none"
        />
      </label>
      {total > 0 ? (
        <p className="text-xs text-text-muted">{t("catalog.showingRange", { first, last, total })}</p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {leaves.map((leaf) => {
          // showing the count tells the admin which types are still empty
          const count = leaf.attr_count;
          const name = en ? leaf.name_en || leaf.name_ar : leaf.name_ar || leaf.name_en;
          const other = en ? leaf.name_ar : leaf.name_en;
          const parent = en ? leaf.parent_en || leaf.parent_ar : leaf.parent_ar || leaf.parent_en;
          return (
            <li key={leaf.id}>
              <Link
                to={`?cat=${leaf.id}`}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-start transition-colors duration-150 hover:bg-surface-tint"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-text">{name}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {other}
                    {parent ? ` · ${parent}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${count > 0 ? "bg-surface-tint text-action" : "bg-surface-alt text-text-faint"}`}>
                    {count > 0 ? t("catalog.attrCount", { count }) : t("catalog.attrNone")}
                  </span>
                  <ChevronRightIcon className="size-4 text-text-muted mirr" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-sm text-text-muted">
          {query ? t("catalog.noTypeMatch") : t("catalog.noLeaves")}
        </p>
      ) : null}
      <Pagination page={page} total={total} perPage={perPage} hrefFor={hrefFor} />
    </div>
  );
}
