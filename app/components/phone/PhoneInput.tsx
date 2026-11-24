import { forwardRef, useId, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon } from "~/components/ui/icons";
import { DEFAULT_COUNTRY, formatLocal, localDigits, looksLikePhone } from "~/lib/phone-countries";

/**
 * Phone and "email or phone" fields.
 *
 * - `mode="phone"`: always a phone field — the country flag and dial code
 *   sit inside the field and the number groups itself as it is typed.
 * - `mode="smart"`: an ordinary field until the first character is a digit
 *   or "+", then the same input (never remounted, so focus and the caret
 *   stay put) quietly becomes a phone field; typing a letter or clearing it
 *   turns it back.
 *
 * Works with react-hook-form's `register()` (name / onChange / onBlur / ref)
 * or as a controlled input.
 */
export interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  label: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  mode?: "phone" | "smart";
  id?: string;
  /** extra classes for the <input> itself */
  inputClassName?: string;
}

/** A saved "+201012345678" shows as "010 1234 5678" next to the +20 badge. */
function asPhone(v: string, phone: boolean): string {
  return phone && v ? formatLocal(localDigits(v)) : v;
}

function reformat(input: HTMLInputElement): void {
  const before = input.value;
  const caret = input.selectionStart ?? before.length;
  const digitsBeforeCaret = localDigits(before.slice(0, caret)).length;
  const next = formatLocal(localDigits(before));
  if (next === before) return;
  input.value = next;
  // put the caret back after the same number of digits
  let seen = 0, pos = 0;
  while (pos < next.length && seen < digitsBeforeCaret) { if (/\d/.test(next[pos]!)) seen++; pos++; }
  try { input.setSelectionRange(pos, pos); } catch { /* type without selection API */ }
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { label, error, hint, mode = "phone", id: idOverride, className = "", inputClassName = "", onChange, value, defaultValue, placeholder, ...rest },
  ref,
) {
  const { i18n } = useTranslation();
  const autoId = useId();
  const id = idOverride ?? autoId;
  const [current, setCurrent] = useState(String(value ?? defaultValue ?? ""));
  const shown = value !== undefined ? String(value) : current;
  const phone = mode === "phone" || (shown !== "" && looksLikePhone(shown));
  const country = DEFAULT_COUNTRY;
  const countryName = i18n.language?.startsWith("en") ? country.name_en : country.name_ar;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (mode === "phone" || looksLikePhone(event.target.value)) reformat(event.target);
    setCurrent(event.target.value);
    onChange?.(event);
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-bold text-text">
        {label}
        {rest.required ? <span aria-hidden="true" className="ms-0.5 text-danger">*</span> : null}
      </label>
      <div className="relative" dir={phone ? "ltr" : undefined}>
        <span
          dir="ltr"
          aria-hidden={!phone}
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center gap-2 ps-3 pe-2.5 transition-all duration-200 ease-out motion-reduce:transition-none ${
            phone ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"
          }`}
        >
          <img src={country.flag} alt="" width={22} height={16} className="h-4 w-[22px] rounded-[3px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
          <span className="num text-sm font-bold text-text">{country.dial}</span>
          <span className="h-5 w-px bg-border" />
          <span className="sr-only">{countryName}</span>
        </span>
        <input
          ref={ref}
          id={id}
          type={phone ? "tel" : mode === "smart" ? "text" : "tel"}
          inputMode={phone ? "tel" : "email"}
          dir={phone ? "ltr" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          placeholder={phone ? country.placeholder : placeholder}
          value={value === undefined ? undefined : asPhone(String(value), phone)}
          defaultValue={value === undefined && defaultValue !== undefined ? asPhone(String(defaultValue), phone) : undefined}
          onChange={handleChange}
          className={`w-full rounded-md border bg-surface py-2.5 pe-3.5 text-sm text-text outline-none transition-[padding,border-color,box-shadow] duration-200 placeholder:text-text-faint focus:shadow-focus motion-reduce:transition-none ${
            error ? "border-danger" : "border-border focus:border-primary"
          } ${phone ? "num pl-[6.25rem] text-left tracking-wide" : "ps-3.5"} ${inputClassName}`}
          {...rest}
        />
      </div>
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs font-bold text-danger">
          <AlertIcon aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
});
