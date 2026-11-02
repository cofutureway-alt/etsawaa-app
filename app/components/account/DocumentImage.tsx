import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Renders an image from the PRIVATE `documents` bucket. The bucket is not
 * public, so the object is fetched through /api/document, which mints a
 * 60-second signed URL using the caller's own session (storage RLS decides
 * who may read it: the uploader, or an admin).
 *
 * Failure is a labelled placeholder, never a broken-image icon.
 */
export function DocumentImage({
  path,
  className = "size-14",
  alt,
}: {
  path: string;
  className?: string;
  alt?: string;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(`/api/document?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { url?: string };
        if (!cancelled) setUrl(body.url ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <span
        className={`${className} flex items-center justify-center rounded-md border border-border bg-surface-alt text-2xs text-text-faint`}
      >
        {t("returns.evidenceUnavailable")}
      </span>
    );
  }
  if (!url) {
    return <span className={`${className} block animate-pulse rounded-md bg-border`} aria-busy="true" />;
  }
  return <img src={url} alt={alt ?? ""} loading="lazy" className={`${className} rounded-md border border-border object-cover`} />;
}
