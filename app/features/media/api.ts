import type { MediaKind } from "~/lib/media.shared";

/**
 * Browser-side media library client.
 *
 * Every call is a request to /api/media-library, which runs it under the
 * request's httpOnly session cookie. Nothing here queries PostgREST or
 * Storage directly: the browser cannot see the session token, so a direct
 * call would reach RLS as `anon` (401) — that is what made the picker show
 * "تعذر تحميل البيانات" and swallow uploads.
 */

export interface MediaFolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
}

export interface MediaFileRow {
  id: string;
  folder_id: string | null;
  bucket: string;
  path: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  kind: MediaKind;
  width: number | null;
  height: number | null;
}

export interface MediaUsageRef {
  ref_type: string;
  ref_label: string;
}

export const MEDIA_PAGE_SIZE = 20;

export interface ListFilesOpts {
  /** null = root view (direct root files) */
  selfId: string | null;
  /** descendant folder ids (search spans them) */
  folderIds: string[];
  search: string;
  page: number;
}

type Envelope<T> = ({ ok: true } & T) | { ok: false; reason: string };

async function request<T>(init: RequestInit, url: string): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({ ok: false, reason: "network" }))) as Envelope<T>;
  if (!body.ok) throw new Error(body.reason);
  return body as T & { ok: true };
}

const get = <T>(query: string) => request<T>({ credentials: "same-origin" }, `/api/media-library?${query}`);

async function post<T>(fields: Record<string, string | File>): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return request<T>({ method: "POST", body: form, credentials: "same-origin" }, "/api/media-library");
}

export async function listFolders(): Promise<MediaFolderRow[]> {
  const res = await get<{ folders: MediaFolderRow[] }>("op=folders");
  return res.folders;
}

export async function listFilesPage(opts: ListFilesOpts): Promise<{ rows: MediaFileRow[]; count: number }> {
  const params = new URLSearchParams({
    op: "files",
    self: opts.selfId ?? "",
    search: opts.search,
    page: String(opts.page),
  });
  const res = await get<{ rows: MediaFileRow[]; count: number }>(params.toString());
  return { rows: res.rows, count: res.count };
}

export async function createFolder(name: string, parentId: string | null): Promise<MediaFolderRow> {
  const res = await post<{ folder: MediaFolderRow }>({ op: "createFolder", name, parentId: parentId ?? "" });
  return res.folder;
}

export const renameFolder = (id: string, name: string) => post<object>({ op: "renameFolder", id, name });
export const deleteFolder = (id: string) => post<object>({ op: "deleteFolder", id });
export const renameFile = (id: string, name: string) => post<object>({ op: "renameFile", id, name });
export const moveFile = (id: string, folderId: string | null) =>
  post<object>({ op: "moveFile", id, folderId: folderId ?? "" });

/** Soft delete the row; physical object removal happens only when unused. */
export const softDeleteFile = (id: string) => post<object>({ op: "softDeleteFile", id });

/** Usage check before physical delete (fn_media_usage, security definer). */
export async function fileUsage(path: string): Promise<MediaUsageRef[]> {
  const res = await post<{ usage: MediaUsageRef[] }>({ op: "fileUsage", path });
  return res.usage;
}

/** Physical delete — only after the usage check passes (M-07). */
export async function physicalDelete(row: MediaFileRow): Promise<void> {
  const form = new FormData();
  form.append("op", "physicalDelete");
  form.append("id", row.id);
  const res = await fetch("/api/media-library", { method: "POST", body: form, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({ ok: false, reason: "network" }))) as
    | Envelope<object>
    | { ok: false; reason: "in_use"; usage: MediaUsageRef[] };
  if (!body.ok) {
    // keep the usage list on the error — the library's toast names the places
    const err = new Error(body.reason) as Error & { usage?: MediaUsageRef[] };
    if ("usage" in body) err.usage = body.usage;
    throw err;
  }
}

export interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  errorKey?: string;
  row?: MediaFileRow;
}

/**
 * Upload with progress and abort. fetch cannot report upload progress, so
 * this stays on XHR — against our own route, which holds the session.
 */
export function uploadFile(
  file: File,
  folderId: string | null,
  bucket: string,
  onProgress: (pct: number) => void,
  signal: { aborted: boolean; abort?: () => void },
): Promise<MediaFileRow> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("op", "upload");
    form.append("bucket", bucket);
    form.append("folderId", folderId ?? "");
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media-library");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (signal.aborted) return reject(new Error("cancelled"));
      try {
        const body = JSON.parse(xhr.responseText) as Envelope<{ row: MediaFileRow }>;
        if (body.ok) return resolve(body.row);
        reject(new Error(body.reason));
      } catch {
        reject(new Error(`upload_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("cancelled"));
    signal.abort = () => xhr.abort();
    xhr.send(form);
  });
}
