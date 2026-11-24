import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/brands";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { BRANDS_PER_PAGE, getCategories, listBrandsPage, type BrandCard } from "~/features/storefront/api";
import { foldSearch } from "~/lib/search-fold";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { MediaImg } from "~/components/catalog/MediaImg";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { SearchIcon } from "~/components/ui/icons";
import { SkeletonPage } from "~/components/ui/Skeleton";

/**
 * Brands directory (S-08): ~1,500 brands — search by Arabic/English name,
 * filter by main category (brand ↔ category links), brands with products
 * first. Lazy loading: 48 at a time, the next batch loads as the visitor
 * scrolls near the end (IntersectionObserver + fetcher; a "load more"
 * button is the fallback). Logos are wide, so cards use a contain-fit 3:2 frame.
 */

const ARABIC_LETTERS = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
const LATIN_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** One folded Arabic letter, A–Z, or `#` (names starting with a digit). */
function parseLetter(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (value === "#") return "#";
  if (/^[A-Za-z]$/.test(value)) return value.toUpperCase();
  const folded = foldSearch(value);
  return ARABIC_LETTERS.includes(folded) ? folded : "";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const cat = url.searchParams.get("cat") ?? "";
  const letter = parseLetter(url.searchParams.get("letter"));
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, q, cat, letter, page, brands: [] as BrandCard[], total: 0, mains: [] };
  const [res, cats] = await Promise.all([
    listBrandsPage(client, { q, rootCategoryId: cat || null, letter, page }).catch(() => ({ items: [] as BrandCard[], total: 0 })),
    getCategories(client, { maxDepth: 1 }).catch(() => []),
  ]);
  const mains = cats.filter((c) => c.depth === 1).map((c) => ({ id: c.id, name_ar: c.name_ar, name_en: c.name_en, icon: c.icon }));
  return { lang, q, cat, letter, page, brands: res.items, total: res.total, mains };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/brands",
    title: `${t("nav.brands")} — ${t("app.name")}`,
    description: t("brands.metaDescription"),
  });
};

export default function BrandsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, q, cat, letter, page, brands, total, mains } = loaderData;
  const en = lang === "en";
  const navigate = useNavigate();
  const busy = useNavigation().state === "loading";
  const [text, setText] = useState(q);
  // the input is the source of truth while the visitor types: only an
  // external URL change (back/forward, a link) may overwrite it
  const pushed = useRef(q);
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);

  // lazy loading: start from the server page, append following pages on scroll
  const [items, setItems] = useState<BrandCard[]>(brands);
  // next page lives in a ref too: the "keep going" check runs in the same
  // commit that appends a batch, before state would have updated
  const [nextPage, setNextPage] = useState(page + 1);
  const nextPageRef = useRef(page + 1);
  const setNext = (n: number) => { nextPageRef.current = n; setNextPage(n); };
  useEffect(() => { setItems(brands); setNext(page + 1); }, [brands, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = useFetcher<typeof loader>();
  useEffect(() => {
    const d = more.data;
    if (more.state !== "idle" || !d || d.q !== q || d.cat !== cat || d.letter !== letter) return;
    setItems((cur) => {
      const seen = new Set(cur.map((b) => b.id));
      return [...cur, ...d.brands.filter((b) => !seen.has(b.id))];
    });
    setNext(Math.max(nextPageRef.current, d.page + 1));
  }, [more.state, more.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // by page number, not item count: a deep link (?page=3) starts mid-list
  const totalPages = Math.ceil(total / BRANDS_PER_PAGE);
  const hasMore = nextPage <= totalPages;
  // set synchronously so two triggers in the same tick can't request a batch twice
  const inFlight = useRef(false);
  useEffect(() => { if (more.state === "idle") inFlight.current = false; }, [more.state]);
  const loadMore = () => {
    if (inFlight.current || more.state !== "idle" || nextPageRef.current > totalPages) return;
    inFlight.current = true;
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (cat) sp.set("cat", cat);
    if (letter) sp.set("letter", letter);
    sp.set("page", String(nextPageRef.current));
    more.load(`/${lang}/brands?${sp.toString()}`);
  };
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const nearEnd = () => {
    const el = sentinel.current;
    return !!el && el.getBoundingClientRect().top < window.innerHeight + 600;
  };
  // one observer per list; fires when the end of the list comes within 600px
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreRef.current(); }, { rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, q, cat, letter]);
  // backup trigger: a throttled scroll/resize check (IntersectionObserver can be
  // throttled in embedded or background views)
  useEffect(() => {
    if (!hasMore) return;
    let timer = 0;
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => { timer = 0; if (nearEnd()) loadMoreRef.current(); }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (timer) window.clearTimeout(timer); };
  }, [hasMore]); // eslint-disable-line react-hooks/exhaustive-deps
  // after each batch: if the end is still on screen (tall screens, fast scroll), keep going
  useEffect(() => {
    if (more.state === "idle" && hasMore && nearEnd()) loadMoreRef.current();
  }, [more.state, items.length, hasMore]); // eslint-disable-line react-hooks/exhaustive-deps

  const href = (next: { q?: string; cat?: string; letter?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const nq = next.q ?? q; const nc = next.cat ?? cat; const nl = next.letter ?? letter; const np = next.page ?? 1;
    if (nq) sp.set("q", nq);
    if (nc) sp.set("cat", nc);
    if (nl) sp.set("letter", nl);
    if (np > 1) sp.set("page", String(np));
    const s = sp.toString();
    return `/${lang}/brands${s ? `?${s}` : ""}`;
  };

  // debounced search
  useEffect(() => {
    const next = text.trim().slice(0, 60);
    if (next === q) return;
    const id = window.setTimeout(() => {
      pushed.current = next;
      navigate(href({ q: next, page: 1 }), { replace: true, preventScrollReset: true });
    }, 350);
    return () => window.clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (on: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${on ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action/50 hover:text-action"}`;
  const letterChip = (on: boolean, wide = false) =>
    `inline-flex h-9 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition-colors ${wide ? "w-auto px-2" : "size-9"} ${on ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action/50 hover:text-action"}`;
  // letters of the page language only (the other alphabet stays reachable through search)
  const letters = en ? LATIN_LETTERS : [...ARABIC_LETTERS, "#"];
  const sideLink = (on: boolean) =>
    `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-bold transition-colors ${on ? "bg-danger-soft text-action" : "text-text hover:bg-surface-tint hover:text-action"}`;
  const letterCell = (on: boolean) =>
    `flex h-9 items-center justify-center rounded-md border text-sm font-bold transition-colors ${on ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action/50 hover:text-action"}`;

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.brands") }]} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-text">{t("nav.brands")}</h1>
          <p className="num mt-1 text-sm text-text-muted">{t("store.brands.count", { count: total })}</p>
        </div>
        <Form method="get" role="search" className="relative w-full sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); pushed.current = text.trim(); navigate(href({ q: text.trim(), page: 1 })); }}>
          <label htmlFor="brand-q" className="sr-only">{t("store.brands.search")}</label>
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input id="brand-q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("store.brands.search")} maxLength={60}
            className="h-11 w-full rounded-full border border-border bg-surface ps-11 pe-4 text-base text-text focus:border-action focus:outline-none sm:text-sm" />
        </Form>
      </header>

      {/* phones / tablets: one swipeable row per filter; lg+: the sidebar below */}
      <div className="flex flex-col gap-2 lg:hidden">
        {mains.length ? (
          <nav aria-label={t("store.brands.byCategory")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link to={href({ cat: "", page: 1 })} preventScrollReset aria-current={!cat ? "page" : undefined} className={chip(!cat)}>{t("store.brands.all")}</Link>
            {mains.map((m) => (
              <Link key={m.id} to={href({ cat: m.id, page: 1 })} preventScrollReset aria-current={cat === m.id ? "page" : undefined} className={chip(cat === m.id)}>
                <CategoryIcon icon={m.icon} className="size-4" />{en ? m.name_en : m.name_ar}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav aria-label={t("store.brands.byLetter")} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link to={href({ letter: "", page: 1 })} preventScrollReset aria-current={!letter ? "page" : undefined} className={letterChip(!letter, true)}>
            {t("store.brands.all")}
          </Link>
          {letters.map((value) => (
            <Link key={value} to={href({ letter: letter === value ? "" : value, page: 1 })} preventScrollReset
              aria-current={letter === value ? "page" : undefined} className={letterChip(letter === value)}>
              {value}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-24 hidden flex-col gap-4 rounded-xl border border-border bg-surface p-3 shadow-1 lg:flex">
          {mains.length ? (
            <nav aria-label={t("store.brands.byCategory")} className="flex flex-col gap-0.5">
              <p className="px-2.5 pb-1 text-xs font-extrabold text-text-muted">{t("store.brands.byCategory")}</p>
              <Link to={href({ cat: "", page: 1 })} preventScrollReset aria-current={!cat ? "page" : undefined} className={sideLink(!cat)}>{t("store.brands.all")}</Link>
              {mains.map((m) => (
                <Link key={m.id} to={href({ cat: m.id, page: 1 })} preventScrollReset aria-current={cat === m.id ? "page" : undefined} className={sideLink(cat === m.id)}>
                  <CategoryIcon icon={m.icon} className="size-4 shrink-0" /><span className="min-w-0 truncate">{en ? m.name_en : m.name_ar}</span>
                </Link>
              ))}
            </nav>
          ) : null}
          <nav aria-label={t("store.brands.byLetter")} className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-extrabold text-text-muted">{t("store.brands.byLetter")}</p>
              {letter ? <Link to={href({ letter: "", page: 1 })} preventScrollReset className="text-xs font-bold text-action hover:underline">{t("store.brands.all")}</Link> : null}
            </div>
            <div className="grid grid-cols-6 gap-1">
              {letters.map((value) => (
                <Link key={value} to={href({ letter: letter === value ? "" : value, page: 1 })} preventScrollReset
                  aria-current={letter === value ? "page" : undefined} className={letterCell(letter === value)}>
                  {value}
                </Link>
              ))}
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
      {items.length === 0 ? (
        <EmptyState
          title={q || cat || letter ? t("store.brands.noMatch") : t("store.brands.empty.title")}
          body={q || cat || letter ? t("store.brands.noMatchBody") : t("store.brands.empty.body")}
        />
      ) : (
        <ul className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 ${busy ? "opacity-60" : ""}`}>
          {items.map((brand) => {
            const slug = en ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en;
            const name = en ? brand.name_en : brand.name_ar;
            const country = en ? brand.country_en : brand.country_ar;
            return (
              <li key={brand.id}>
                <Link to={`/${lang}/brand/${encodeURIComponent(slug)}`}
                  className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-action/40 hover:shadow-2">
                  <span className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-lg bg-white p-2">
                    {brand.thumb_path ? (
                      <MediaImg path={brand.thumb_path} alt="" width={200} height={133} className="absolute inset-0 size-full p-2 object-contain" />
                    ) : (
                      <span className="text-center text-lg font-black text-action">{name}</span>
                    )}
                  </span>
                  <span className="flex flex-col gap-0.5 px-1 pb-0.5">
                    <span className="line-clamp-1 text-sm font-extrabold text-text group-hover:text-action">{name}</span>
                    <span className="num line-clamp-1 text-2xs text-text-muted">
                      {[country, brand.product_count ? t("store.brands.productCount", { count: brand.product_count }) : null].filter(Boolean).join(" · ") || " "}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <div ref={sentinel} className="flex flex-col items-center gap-2 py-4">
          {more.state !== "idle" ? (
            <ul aria-hidden="true" className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 6 }, (_, i) => <li key={i} className="h-40 animate-pulse rounded-xl bg-surface-tint" />)}
            </ul>
          ) : (
            <a href={href({ page: nextPage })} onClick={(e) => { e.preventDefault(); loadMore(); }}
              className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-bold text-text hover:border-action hover:text-action">
              {t("store.brands.loadMore")}
            </a>
          )}
          <p className="num text-xs text-text-muted" aria-live="polite">{t("store.brands.shown", { shown: items.length, total })}</p>
        </div>
      ) : items.length > BRANDS_PER_PAGE ? (
        <p className="num py-4 text-center text-xs text-text-muted">{t("store.brands.allShown", { total })}</p>
      ) : null}
        </div>
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
