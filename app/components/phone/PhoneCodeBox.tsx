import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { AlertIcon, CheckIcon } from "~/components/ui/icons";
import { maskNumber } from "~/lib/messaging/text";
import type { PhoneCodeResult } from "~/routes/api/phone-code";

/** Six digit cells; pasting a whole code fills them all. */
export function CodeCells({ value, onChange, invalid, disabled, label }: {
  value: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean; label: (i: number) => string;
}) {
  const cells = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  function put(index: number, raw: string) {
    const chars = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
    if (!chars) { onChange((value.slice(0, index) + value.slice(index + 1)).slice(0, 6)); return; }
    const next = (value.slice(0, index) + chars + value.slice(index + chars.length)).slice(0, 6);
    onChange(next);
    cells.current[Math.min(index + chars.length, 5)]?.focus();
  }
  return (
    <div className="flex justify-center gap-2" dir="ltr">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { cells.current[i] = el; }}
          value={d}
          disabled={disabled}
          onChange={(e) => put(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) cells.current[i - 1]?.focus(); }}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          aria-label={label(i + 1)}
          aria-invalid={invalid || undefined}
          className={`num size-11 rounded-md border-2 text-center text-lg font-extrabold text-text outline-none transition-colors duration-150 focus:shadow-focus disabled:opacity-60 sm:size-12 ${
            invalid ? "border-danger bg-danger-soft" : d ? "border-primary bg-surface-tint" : "border-border bg-surface"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Ask for a code on WhatsApp / SMS, then check it (POST /api/phone-code).
 * Sends once on mount; the resend button waits out the server's countdown.
 */
export function PhoneCodeBox({ phone, purpose, lang, onVerified, autoSend = true }: {
  phone: string; purpose: "verify" | "checkout"; lang: "ar" | "en"; onVerified: () => void; autoSend?: boolean;
}) {
  const { t } = useTranslation();
  const send = useFetcher<PhoneCodeResult>();
  const check = useFetcher<PhoneCodeResult>();
  const [code, setCode] = useState("");
  const [left, setLeft] = useState(0);
  const sentOnce = useRef(false);

  const request = () => send.submit({ intent: "send", purpose, phone, lang }, { method: "post", action: "/api/phone-code" });
  useEffect(() => {
    if (autoSend && !sentOnce.current) { sentOnce.current = true; request(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const d = send.data;
    if (d && "resendIn" in d && d.resendIn) setLeft(d.resendIn);
  }, [send.data]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  useEffect(() => { if (check.data?.ok) onVerified(); }, [check.data, onVerified]);
  // the sixth digit submits by itself
  useEffect(() => {
    if (code.length === 6 && check.state === "idle" && !check.data?.ok) {
      check.submit({ intent: "check", purpose, phone, code, lang }, { method: "post", action: "/api/phone-code" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const sent = send.data?.ok ? send.data : null;
  const sendError = send.data && !send.data.ok ? send.data.reason : null;
  const checkError = check.data && !check.data.ok ? check.data.reason : null;
  const verified = Boolean(check.data?.ok);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg bg-surface-tint p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-action">
          {sent?.channel === "whatsapp" ? <WhatsAppGlyph /> : <SmsGlyph />}
        </span>
        <p className="text-sm text-text">
          {send.state !== "idle" && !sent
            ? t("phoneCode.sending")
            : sent
              ? t(sent.channel === "whatsapp" ? "phoneCode.sentWhatsapp" : "phoneCode.sentSms")
              : t("phoneCode.willSend")}
          {" "}
          <span className="num whitespace-nowrap font-bold" dir="ltr">{maskNumber(phone)}</span>
        </p>
      </div>

      <fieldset disabled={verified}>
        <legend className="mb-2 text-sm font-bold text-text">{t("phoneCode.enter")}</legend>
        <CodeCells value={code} onChange={setCode} invalid={Boolean(checkError)} label={(i) => t("auth.verify.digit", { index: i })} />
      </fieldset>

      {verified ? (
        <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-bold text-success">
          <CheckIcon aria-hidden="true" /> {t("phoneCode.verified")}
        </p>
      ) : checkError || sendError ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-2.5 text-sm font-bold text-danger">
          <AlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
          {t(`phoneCode.err.${checkError ?? sendError}`, { defaultValue: t("phoneCode.err.failed") })}
        </p>
      ) : null}

      <Button type="button" size="lg" block loading={check.state !== "idle"} disabled={code.length !== 6 || verified}
        onClick={() => check.submit({ intent: "check", purpose, phone, code, lang }, { method: "post", action: "/api/phone-code" })}>
        {t("phoneCode.confirm")}
      </Button>

      <div className="text-center text-sm">
        {left > 0 ? (
          <span className="text-text-muted">{t("auth.verify.resendIn", { seconds: left })}</span>
        ) : (
          <Button type="button" variant="ghost" size="sm" loading={send.state !== "idle"} onClick={() => { setCode(""); request(); }}>
            {sent ? t("phoneCode.resend") : t("phoneCode.send")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** WhatsApp's official mark (simple-icons, CC0). */
export function WhatsAppGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export function SmsGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
  );
}
