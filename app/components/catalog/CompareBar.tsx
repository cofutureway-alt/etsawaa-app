import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ScaleIcon, XIcon } from "~/components/ui/icons";
import { clearCompare, readCompare, toggleCompare } from "~/features/discovery/compare";

/**
 * Floating compare bar (S-21 / US-13): shows the staged products; enabled
 * at two, links to /compare?ids=a,b. Listens for the card-level toggles.
 */
export function CompareBar() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const lang = params.lang === "en" ? "en" : "ar";
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setIds(readCompare());
    sync();
    window.addEventListener("etsawaa:compare", sync);
    return () => window.removeEventListener("etsawaa:compare", sync);
  }, []);

  if (ids.length === 0) return null;

  return (
    <>
      {/* in-flow spacer: reserves the bar height so the footer's last line is
          never covered by the fixed bar. Rendered AFTER the footer and colored
          like it, so the reserved space reads as footer continuation — never
          white (owner report). */}
      <div aria-hidden="true" className="h-[61px] bg-footer" />
      <div
        role="region"
        aria-label={t("store.compare.bar")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 shadow-2 backdrop-blur-sm"
      >
      <div className="mx-auto flex max-w-page items-center gap-3 px-4 py-2.5">
        <ScaleIcon aria-hidden="true" className="shrink-0 text-action" />
        <span className="num min-w-0 flex-1 truncate text-sm font-bold text-text">
          {t("store.compare.staged", { count: ids.length })}
        </span>
        <button
          type="button"
          onClick={() => {
            clearCompare();
            window.dispatchEvent(new CustomEvent("etsawaa:compare"));
          }}
          aria-label={t("store.compare.clear")}
          className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-danger"
        >
          <XIcon className="size-4" />
        </button>
        <button
          type="button"
          disabled={ids.length < 2}
          onClick={() => void navigate(`/${lang}/compare?ids=${ids.join(",")}`)}
          className="flex min-h-10 cursor-pointer items-center rounded-md bg-action px-4 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ids.length < 2 ? t("store.compare.pickSecond") : t("store.compare.go")}
        </button>
      </div>
    </div>
    </>
  );
}

/** Card-level compare toggle already lives in ProductCard; this re-export
 * keeps the staging contract in one place. */
export { toggleCompare };
