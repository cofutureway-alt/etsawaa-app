import { useTranslation } from "react-i18next";
import type { SocialLinks as Links } from "~/features/settings/api";

/** Brand-neutral glyphs for the company's social profiles (admin settings → site.social). */
const PATHS: Record<string, string> = {
  facebook: "M14 8h3V4h-3c-2.8 0-4 1.8-4 4.4V11H7v4h3v9h4v-9h3l1-4h-4V8.6c0-.4.3-.6.6-.6z",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.5-1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  tiktok: "M16 3c.3 2.3 1.8 4 4 4.3v3.2c-1.5 0-2.9-.4-4-1.2V15a6 6 0 1 1-6-6v3.3a2.7 2.7 0 1 0 2.7 2.7V3H16z",
  x: "M4 4h4.6l3.6 5 4.1-5H19l-5.5 6.6L20 20h-4.6l-3.9-5.5L6.9 20H4.3l6-7.2L4 4z",
  youtube: "M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z",
  linkedin: "M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 9h4v12H3V9zm7 0h3.8v1.7h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.5c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21h-4V9z",
  whatsapp: "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2z",
};

export function socialHref(key: string, value: string): string {
  if (key === "whatsapp" && !/^https?:/.test(value)) return `https://wa.me/${value.replace(/[^\d]/g, "")}`;
  return value;
}

export function SocialLinks({ links, className = "", tone = "footer" }: { links: Links; className?: string; tone?: "footer" | "page" }) {
  const { t } = useTranslation();
  const entries = Object.entries(links).filter(([, v]) => Boolean(v));
  if (entries.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`} aria-label={t("social.title")}>
      {entries.map(([key, value]) => (
        <li key={key}>
          <a href={socialHref(key, value!)} target="_blank" rel="noopener noreferrer" aria-label={t(`social.${key}`)} title={t(`social.${key}`)}
            className={`flex size-10 items-center justify-center rounded-full transition-colors ${tone === "footer" ? "bg-white/10 text-white hover:bg-white hover:text-ink" : "border border-border bg-surface text-action hover:bg-action hover:text-on-action"}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={PATHS[key] ?? PATHS.x} /></svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
