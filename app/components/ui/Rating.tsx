import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StarIcon } from "./icons";

export interface RatingProps {
  /** 0..5, halves supported */
  value: number;
  count?: number;
  /** Interactive mode (radiogroup) vs read-only display */
  onChange?: (value: number) => void;
  size?: "sm" | "md" | "lg";
}

const sizePx = { sm: 14, md: 18, lg: 24 } as const;

/**
 * Rating with half-star precision: an overlay layer clipped by percentage.
 * Read-only by default; interactive mode uses real buttons (keyboard-safe).
 */
export function Rating({ value, count, onChange, size = "md" }: RatingProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;
  const px = sizePx[size];

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

  return (
    <div role="radiogroup" aria-label={t("ui.rating.label")} className="inline-flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
      {stars}
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} / 5`}
          onMouseEnter={() => setHovered(star)}
          onClick={() => onChange(star)}
          className="cursor-pointer rounded-md p-0.5 transition-transform duration-150 hover:scale-110"
        >
          <span className="sr-only">{star}</span>
        </button>
      ))}
    </div>
  );
}
