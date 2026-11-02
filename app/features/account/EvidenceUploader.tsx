import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadCustomerImage } from "./client";
import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { mediaUrl } from "~/components/catalog/MediaImg";

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
    const next: string[] = [...paths];
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
          setError(t("returns.evidenceInvalid"));
          continue;
        }
        const c = getSupabaseBrowserClient();
        const uid = c ? (await c.auth.getUser()).data?.user?.id : null;
        if (!uid) {
          setError(t("returns.evidenceInvalid"));
          break;
        }
        const { path } = await uploadCustomerImage(uid, file, "documents");
        next.push(path);
      }
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
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] font-bold text-text transition-colors duration-150 hover:bg-surface-tint">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
              <img src={mediaUrl(p)} alt="" className="size-14 rounded-md border border-border object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
