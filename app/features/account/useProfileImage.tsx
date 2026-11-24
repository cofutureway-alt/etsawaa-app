import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";
import { uploadCustomerImage } from "./client";
import { CropDialog, type CropSpec } from "./CropDialog";
import { useToast } from "~/components/ui/Toast";

/** Square, round-masked, exported at 512 — avatars render as circles everywhere. */
export const AVATAR_CROP: CropSpec = { aspect: 1, outWidth: 512, outHeight: 512, shape: "round" };
/** 3:1 at 1500 wide — matches the cover strip in the identity card. */
export const BANNER_CROP: CropSpec = { aspect: 3, outWidth: 1500, outHeight: 500 };

/**
 * Pick → crop → upload → save one profile image.
 *
 * Persisting goes through /api/profile-media (not the profile route's action)
 * so the account layout can offer these buttons on every tab; the revalidator
 * then refreshes fn_viewer_context, which is where the card's avatar_url and
 * banner_url come from.
 */
export function useProfileImage(intent: "avatar" | "banner") {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const revalidator = useRevalidator();
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      showToast("error", t("returns.evidenceInvalid"));
      onCancel();
      return;
    }
    setPicked(file);
  };

  const onCancel = () => {
    setPicked(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onConfirm = async (cropped: File) => {
    setPicked(null);
    setBusy(true);
    try {
      const { path } = await uploadCustomerImage(cropped, "media");
      const form = new FormData();
      form.append("intent", intent);
      form.append("path", path);
      const res = await fetch("/api/profile-media", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
      if (!body.ok) throw new Error("save_failed");
      showToast("success", t("profile.saved"));
      revalidator.revalidate();
    } catch {
      showToast("error", t("profile.failed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return {
    inputRef,
    onChange,
    busy,
    dialog: (
      <CropDialog
        file={picked}
        spec={intent === "avatar" ? AVATAR_CROP : BANNER_CROP}
        title={t("profile.crop.title")}
        busy={busy}
        onCancel={onCancel}
        onConfirm={(cropped) => void onConfirm(cropped)}
      />
    ),
  };
}
