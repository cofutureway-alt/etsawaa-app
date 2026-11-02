import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "~/components/ui/Select";
import { ChevronDownIcon } from "~/components/ui/icons";

export type AreaOption = { id: number; governorate_id: number; name_ar: string; name_en: string };
export type GovOption = { id: number; name_ar: string; name_en: string };

/**
 * H-22 — governorate→area dependent selects. Behaviors (all from the plan):
 *  - area select is disabled until a governorate is picked
 *  - fetches `/:lang/api/areas?governorate_id=…` on governorate change
 *  - ABORTS the previous fetch when the governorate flips quickly
 *  - caches each governorate's areas for the SESSION (module-level Map)
 *  - stable skeleton box while loading (aria-busy; no layout shift)
 *  - "no areas" empty state + inline errors; server still rejects a bad pair
 * The SSR payload seeds the cache so the first selection needs no round-trip.
 */
const sessionCache = new Map<number, AreaOption[]>();
let cacheSeeded = false;
function seedCache(areas: AreaOption[]) {
  if (cacheSeeded) return;
  cacheSeeded = true;
  for (const a of areas) {
    const arr = sessionCache.get(a.governorate_id) ?? [];
    if (!arr.some((x) => x.id === a.id)) arr.push(a);
    sessionCache.set(a.governorate_id, arr);
  }
}

export function GovernateAreaSelects({
  lang,
  governorates,
  governorateId,
  areaId,
  onGovernorateChange,
  onAreaChange,
  initialAreas,
  govError,
  areaError,
  namePrefix = "",
}: {
  lang: string;
  governorates: GovOption[];
  governorateId: string;
  areaId: string;
  onGovernorateChange: (govId: string) => void;
  onAreaChange: (areaId: string) => void;
  /** SSR payload used to warm the session cache (no first-fetch flicker). */
  initialAreas: AreaOption[];
  govError?: string;
  areaError?: string;
  namePrefix?: string;
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");

  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<AreaOption[]>(() => {
    seedCache(initialAreas);
    return governorateId ? (sessionCache.get(Number(governorateId)) ?? []) : [];
  });
  const abortRef = useRef<AbortController | null>(null);
  // "loaded at least once for this governorate" — distinguishes "not fetched
  // yet" from "fetched, genuinely empty" (the empty state text differs).
  const [resolvedGov, setResolvedGov] = useState<number | null>(() =>
    governorateId && sessionCache.has(Number(governorateId)) ? Number(governorateId) : null,
  );

  useEffect(() => {
    const govNum = Number(governorateId);
    abortRef.current?.abort();
    if (!govNum) {
      setOptions([]);
      setResolvedGov(null);
      setLoading(false);
      return;
    }
    const cached = sessionCache.get(govNum);
    if (cached !== undefined) {
      setOptions(cached);
      setResolvedGov(govNum);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setOptions([]);
    setResolvedGov(null);
    fetch(`/${lang}/api/areas?governorate_id=${govNum}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { areas: AreaOption[] }) => {
        sessionCache.set(govNum, body.areas);
        setOptions(body.areas);
        setResolvedGov(govNum);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setOptions([]);
        setResolvedGov(govNum); // fetched, failed → show empty state, not a loader
        setLoading(false);
      });
    return () => ctl.abort();
  }, [governorateId, lang]);

  const hasGov = Boolean(governorateId);
  const resolved = resolvedGov === Number(governorateId);
  const noAreas = hasGov && resolved && !loading && options.length === 0;
  const placeholder = !hasGov
    ? t("checkout.chooseGovernorateFirst")
    : loading
      ? t("checkout.loadingAreas")
      : noAreas
        ? t("checkout.noAreas")
        : t("checkout.chooseArea");

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        id={`${namePrefix}gov`}
        name={`${namePrefix}governorate_id`}
        label={t("checkout.governorate")}
        required
        value={governorateId}
        error={govError}
        onChange={(e) => onGovernorateChange(e.target.value)}
        options={[
          { value: "", label: t("checkout.chooseGovernorate") },
          ...governorates.map((g) => ({ value: String(g.id), label: en ? g.name_en : g.name_ar })),
        ]}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${namePrefix}area`} className="text-sm font-bold text-text">
          {t("checkout.area")}
        </label>
        <div className="relative">
          {loading ? (
            /* stable skeleton over the exact select box — no layout shift, no
               flashing spinner (design skill: feedback matches expected wait) */
            <span aria-hidden="true" className="absolute inset-0 z-10 animate-pulse rounded-md border border-border bg-surface-tint motion-reduce:animate-none" />
          ) : null}
          <select
            id={`${namePrefix}area`}
            name={`${namePrefix}area_id`}
            required
            value={areaId}
            disabled={!hasGov || loading || noAreas}
            aria-busy={loading || undefined}
            aria-invalid={areaError ? true : undefined}
            aria-describedby={areaError ? `${namePrefix}area-error` : undefined}
            onChange={(e) => onAreaChange(e.target.value)}
            className={`w-full cursor-pointer appearance-none rounded-md border bg-surface px-3.5 py-2.5 pe-9 text-sm text-text outline-none transition-colors duration-150 focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-70 ${
              areaError ? "border-danger" : "border-border focus:border-primary"
            }`}
          >
            <option value="">{placeholder}</option>
            {options.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {en ? a.name_en : a.name_ar}
              </option>
            ))}
          </select>
          <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </div>
        {!hasGov ? (
          <p className="text-xs text-text-faint">{t("checkout.chooseGovernorateFirst")}</p>
        ) : null}
        {noAreas ? <p className="text-xs text-text-muted">{t("checkout.noAreasHint")}</p> : null}
        {areaError ? (
          <p id={`${namePrefix}area-error`} role="alert" className="text-xs font-bold text-danger">{areaError}</p>
        ) : null}
      </div>
    </div>
  );
}
