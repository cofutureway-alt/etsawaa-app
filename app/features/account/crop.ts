/**
 * Crop helpers shared by the avatar and banner editors.
 *
 * react-easy-crop reports the crop box in the image's own pixel space (the
 * same space the browser uses after applying EXIF orientation), so the only
 * job left here is to keep that box inside the bitmap and turn it into an
 * upright WebP file the existing /api/upload pipeline already accepts.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whole pixels inside the image — a fractional rect makes drawImage blur and
 *  can overshoot the bitmap edge (crop boxes are float-rounded by the lib). */
export function clampCropRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const width = Math.max(1, Math.min(Math.round(rect.width), imageWidth));
  const height = Math.max(1, Math.min(Math.round(rect.height), imageHeight));
  return {
    x: Math.min(Math.max(0, Math.round(rect.x)), imageWidth - width),
    y: Math.min(Math.max(0, Math.round(rect.y)), imageHeight - height),
    width,
    height,
  };
}

/** Output size: never upscale (a 200px crop blown up to 512 is just blur —
 *  the server keeps the smaller file and the CSS scales it down anyway). */
export function outputSize(rect: CropRect, targetWidth: number, targetHeight: number): { width: number; height: number } {
  const scale = Math.min(targetWidth / rect.width, targetHeight / rect.height, 1);
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

const QUALITY = 0.92;

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Draw the chosen box onto a canvas and return it as a File.
 * createImageBitmap with imageOrientation "from-image" bakes the EXIF rotation
 * in, which is what react-easy-crop measured against — drawing the raw `img`
 * element instead rotates the result on Android portrait photos.
 * Safari before 16.4 rejects the options bag, so fall back to the plain call
 * (those versions apply EXIF orientation by default anyway).
 */
export async function cropToFile(
  source: File,
  rect: CropRect,
  targetWidth: number,
  targetHeight: number,
): Promise<File> {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" })
    .catch(() => createImageBitmap(source));
  try {
    const box = clampCropRect(rect, bitmap.width, bitmap.height);
    const size = outputSize(box, targetWidth, targetHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, size.width, size.height);

    // Old Safari ignores the WebP type and hands back PNG; keep whatever came
    // back — /api/upload accepts both.
    const blob = await toBlob(canvas, "image/webp", QUALITY) ?? await toBlob(canvas, "image/png");
    if (!blob) throw new Error("no_blob");

    const ext = blob.type === "image/webp" ? "webp" : "png";
    return new File([blob], `crop.${ext}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
