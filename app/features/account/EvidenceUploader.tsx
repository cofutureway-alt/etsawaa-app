import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadCustomerImage } from "./client";
import { DocumentImage } from "~/components/account/DocumentImage";

/**
 * Refund evidence picker (US-11): native device file input straight to the
 * documents bucket — customers have no media library (owner rule).
 */
export function EvidenceUploader({ onChange }: { onChange: (paths: string[]) => void }) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const picked = Array.from(files).slice(0, 5);
      const valid = picked.filter((file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024);
      if (valid.length < picked.length) setError(t("returns.evidenceInvalid"));
      if (valid.length === 0) return;
      // independent uploads run in parallel (the route resolves the user)
      const results = await Promise.all(valid.map((file) => uploadCustomerImage(file, "documents")));
      const next = [...paths, ...results.map((r) => r.path)];
      setPaths(next);
      onChange(next);
    } catch {
      setError(t("returns.evidenceFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,.avif"
          multiple
          className="sr-only"
          onChange={(e) => void pick(e.target.files)}
        />
        {busy ? t("returns.evidenceUploading") : t("returns.evidenceButton")}
      </label>
      <p className="mt-1 text-xs text-text-faint">{t("returns.evidenceHint")}</p>
      {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      {paths.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {paths.map((p) => (
            <li key={p}>
              <DocumentImage path={p} className="size-14" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
