import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StarIcon } from "./icons";

export interface RatingProps {
  /** 0..5, halves supported in read-only mode */
  value: number;
  count?: number;
  /** Interactive mode (radiogroup) vs read-only display */
  onChange?: (value: number) => void;
  size?: "sm" | "md" | "lg";
}

const sizePx = { sm: 14, md: 18, lg: 24 } as const;
const tapSize = { sm: "size-7", md: "size-9", lg: "size-11" } as const;

/**
 * Rating with half-star precision in read-only mode. Interactive mode is a
 * real radiogroup: five buttons, each drawing its own star, roving tabindex
 * and RTL-aware arrow keys (← / → follow the reading direction).
 */
export function Rating({ value, count, onChange, size = "md" }: RatingProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;
  const px = sizePx[size];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const stars = (
    <span className="relative inline-flex" aria-hidden="true" style={{ fontSize: px }}>
      <span className="flex text-border-strong">
        {Array.from({ length: 5 }, (_, i) => (
          <StarIcon key={i} width={px} height={px} />
        ))}
      </span>
      <span className="absolute inset-0 flex overflow-hidden text-featured" style={{ width: `${(shown / 5) * 100}%` }}>
        {Array.from({ length: 5 }, (_, i) => (
          <StarIcon key={i} width={px} height={px} />
        ))}
      </span>
    </span>
  );

  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span role="img" aria-label={`${value} / 5`}>
          {stars}
        </span>
        {typeof count === "number" ? <span className="num text-xs text-text-muted">({count})</span> : null}
      </span>
    );
  }

  const choose = (star: number) => {
    const next = Math.min(5, Math.max(1, star));
    onChange(next);
    buttons.current[next - 1]?.focus();
  };
  const tabStar = Math.min(5, Math.max(1, Math.round(value))) || 1;
  const word = Math.round(shown);

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <div
        role="radiogroup"
        aria-label={t("ui.rating.label")}
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHovered(null)}
        onKeyDown={(event) => {
          // RTL: the left arrow advances, the right arrow goes back
          const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
          const step = event.key === "ArrowRight" ? (rtl ? -1 : 1)
            : event.key === "ArrowLeft" ? (rtl ? 1 : -1)
            : event.key === "ArrowUp" ? 1
            : event.key === "ArrowDown" ? -1
            : 0;
          if (!step) return;
          event.preventDefault();
          choose((value || 0) + step);
        }}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            ref={(el) => { buttons.current[star - 1] = el; }}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} / 5`}
            tabIndex={star === tabStar ? 0 : -1}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(null)}
            onClick={() => onChange(star)}
            className={`flex cursor-pointer items-center justify-center rounded-md transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 ${tapSize[size]}`}
          >
            <StarIcon
              aria-hidden="true"
              width={px}
              height={px}
              className={star <= shown ? "text-featured" : "text-border-strong"}
            />
          </button>
        ))}
      </div>
      {size === "lg" && word > 0 ? (
        <span className="text-xs font-bold text-text-muted" aria-live="polite">
          {t(`ui.rating.word.${word}`)}
        </span>
      ) : null}
    </div>
  );
}
