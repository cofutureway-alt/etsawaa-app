import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog } from "~/components/ui/Overlay";
import { Button } from "~/components/ui/Button";
import { cropToFile } from "./crop";
export interface CropSpec {
  /** width / height of the visible box, e.g. 1 for the avatar, 3 for the cover */
  aspect: number;
  /** exported pixel size at 100% — the preferred size shown to the user */
  outWidth: number;
  outHeight: number;
  shape?: "rect" | "round";
}

/**
 * Pick → crop → get a File back. The image never leaves the browser until the
 * user confirms, and what gets uploaded is exactly the box they framed (the
 * server still re-encodes to WebP, but it no longer decides the composition).
 */
export function CropDialog({
  file,
  spec,
  title,
  busy = false,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  spec: CropSpec;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<Area | null>(null);

  // one blob URL per picked file; revoked as soon as it is replaced
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    areaRef.current = null;
    setError(null);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const apply = async () => {
    if (!file || !areaRef.current) return;
    setWorking(true);
    setError(null);
    try {
      onConfirm(await cropToFile(file, areaRef.current, spec.outWidth, spec.outHeight));
    } catch {
      setError(t("profile.crop.failed"));
    } finally {
      setWorking(false);
    }
  };

  const disabled = busy || working || !area;

  return (
    <Dialog open={Boolean(file)} onClose={onCancel} title={title} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold text-text-muted">
          {t("profile.crop.hint", { w: spec.outWidth, h: spec.outHeight })}
        </p>

        <div className="relative h-[min(52vh,380px)] w-full overflow-hidden rounded-md border border-border bg-ink">
          {url ? (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={spec.aspect}
              cropShape={spec.shape ?? "rect"}
              minZoom={1}
              maxZoom={4}
              zoomWithScroll
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => {
                // keep the last box even for a one-pixel drag: `area` drives
                // the disabled state, the ref drives the crop itself
                areaRef.current = pixels;
                setArea(pixels);
              }}
              // the lib ships no labels of its own: the focusable crop box is a
              // keyboard-driven application region (arrow keys move the crop)
              cropperProps={{ role: "application", "aria-label": t("profile.crop.area") }}
              style={{ containerStyle: { position: "absolute", inset: 0 }, cropAreaStyle: { border: "2px solid #ffffff" } }}
            />
          ) : null}
        </div>

        <label className="flex items-center gap-3 text-xs font-bold text-text-muted">
          <span className="shrink-0">{t("profile.crop.zoom")}</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="min-h-11 w-full accent-action"
          />
        </label>

        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void apply()} loading={working || busy} disabled={disabled}>
            {t("profile.crop.apply")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={working || busy}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
