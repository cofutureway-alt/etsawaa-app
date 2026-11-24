/**
 * Browser half of /api/upload. The session cookie is httpOnly, so uploads go
 * through our own route (which holds the session) instead of straight to
 * Storage — a direct call would reach Storage as `anon` and be refused.
 */

type UploadResult = { ok: true; path: string } | { ok: false; reason: string; max?: number };

/**
 * Customer upload (owner rule: customers have NO media library) — an image
 * goes to storage and the path lands in the target field. Used by the
 * profile avatar and the refund evidence picker.
 */
export async function uploadCustomerImage(
  file: File,
  bucket: "media" | "documents" = "media",
): Promise<{ path: string }> {
  const form = new FormData();
  form.append("op", "image");
  form.append("bucket", bucket);
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({ ok: false, reason: "network" }))) as UploadResult;
  if (!body.ok) throw new Error(body.reason);
  return { path: body.path };
}

/**
 * Vendor KYC document (private documents bucket + vendor_documents row).
 * XHR rather than fetch: fetch cannot report upload progress.
 */
export function uploadVendorDocument(
  file: File,
  docType: string,
  onProgress: (pct: number) => void,
  /** a rejected/pending image of this store this upload replaces */
  replaceId?: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("op", "vendorDocument");
  form.append("docType", docType);
  form.append("file", file);
  if (replaceId) form.append("replaceId", replaceId);
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResult);
      } catch {
        resolve({ ok: false, reason: "network" });
      }
    };
    xhr.onerror = () => resolve({ ok: false, reason: "network" });
    xhr.send(form);
  });
}

/** Remove one not-yet-verified verification image of the signed-in store. */
export async function deleteVendorDocument(id: string): Promise<{ ok: boolean; reason?: string }> {
  const form = new FormData();
  form.append("op", "vendorDocumentDelete");
  form.append("id", id);
  const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" }).catch(() => null);
  if (!res) return { ok: false, reason: "network" };
  return (await res.json().catch(() => ({ ok: false, reason: "network" }))) as { ok: boolean; reason?: string };
}
