import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { uploadCustomerImage } from "./client";
import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { MediaImg } from "~/components/catalog/MediaImg";

/**
 * Avatar picker (O-28) — native device input, straight to storage, then the
 * path lands in profiles.avatar_url or vendors.logo_path (route decides).
 */
export function AvatarField({ initialPath, alt }: { initialPath: string | null; alt: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean }>();
  const [path, setPath] = useState<string | null>(initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setError(t("returns.evidenceInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = getSupabaseBrowserClient();
      const uid = c ? (await c.auth.getUser()).data?.user?.id : null;
      if (!uid) throw new Error("auth");
      const { path: newPath } = await uploadCustomerImage(uid, file, "media");
      setPath(newPath);
      fetcher.submit({ intent: "avatar", path: newPath }, { method: "post", preventScrollReset: true });
    } catch {
      setError(t("returns.evidenceFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      {path ? (
        <MediaImg path={path} alt={alt} className="size-20 rounded-full border border-border object-cover" />
      ) : (
        <div aria-hidden="true" className="flex size-20 items-center justify-center rounded-full border border-border bg-surface-tint text-lg font-extrabold text-text-muted">
          {(alt || "?").trim().charAt(0)}
        </div>
      )}
      <div>
        <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void pick(e.target.files)}
          />
          {busy ? t("returns.evidenceUploading") : t("profile.changeAvatar")}
        </label>
        {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
