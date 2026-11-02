import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { buildObjectPath, detectKind, type MediaKind } from "~/lib/media.shared";

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

function client() {
  const c = getSupabaseBrowserClient();
  if (!c) throw new Error("db_unavailable");
  return c;
}

export async function listFolders(): Promise<MediaFolderRow[]> {
  const { data, error } = await client()
    .from("media_folders")
    .select("id,parent_id,name,depth")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
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

/** Server-side pagination — 20 rows/page + exact count (M-02 pagination). */
export async function listFilesPage(opts: ListFilesOpts): Promise<{ rows: MediaFileRow[]; count: number }> {
  const from = opts.page * MEDIA_PAGE_SIZE;
  let q = client()
    .from("media_files")
    .select("id,folder_id,bucket,path,original_name,mime,size_bytes,kind,width,height", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, from + MEDIA_PAGE_SIZE - 1);
  if (opts.search) q = q.ilike("original_name", `%${opts.search}%`);
  if (opts.selfId === null) {
    if (opts.search && opts.folderIds.length > 0) {
      q = q.or(`folder_id.is.null,folder_id.in.(${opts.folderIds.join(",")})`);
    } else {
      q = q.is("folder_id", null);
    }
  } else {
    if (opts.search && opts.folderIds.length > 0) {
      q = q.or(`folder_id.eq.${opts.selfId},folder_id.in.(${opts.folderIds.join(",")})`);
    } else {
      q = q.eq("folder_id", opts.selfId);
    }
  }
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map((row) => ({ ...row, kind: row.kind as MediaKind })), count: count ?? 0 };
}

export async function createFolder(name: string, parentId: string | null): Promise<MediaFolderRow> {
  const { data, error } = await client()
    .from("media_folders")
    .insert({ name, parent_id: parentId })
    .select("id,parent_id,name,depth")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const { error } = await client().from("media_folders").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await client().from("media_folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function renameFile(id: string, originalName: string): Promise<void> {
  const { error } = await client().from("media_files").update({ original_name: originalName }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function moveFile(id: string, folderId: string | null): Promise<void> {
  const { error } = await client().from("media_files").update({ folder_id: folderId }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Soft delete the row; physical object removal happens only when unused. */
export async function softDeleteFile(id: string): Promise<void> {
  const { error } = await client().from("media_files").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export interface MediaUsageRef {
  ref_type: string;
  ref_label: string;
}

/** Usage check before physical delete (fn_media_usage, security definer). */
export async function fileUsage(path: string): Promise<MediaUsageRef[]> {
  const { data, error } = await client().rpc("fn_media_usage", { p_path: path });
  if (error) throw new Error(error.message);
  return (data ?? []) as MediaUsageRef[];
}

/** Physical delete — only after the usage check passes (M-07). */
export async function physicalDelete(row: MediaFileRow): Promise<void> {
  const usage = await fileUsage(row.path);
  if (usage.length > 0) {
    const err = new Error("in_use") as Error & { usage?: MediaUsageRef[] };
    err.usage = usage;
    throw err;
  }
  const c = client();
  const { error: objErr } = await c.storage.from(row.bucket).remove([row.path]);
  if (objErr) throw new Error(objErr.message);
  const { error: rowErr } = await c.from("media_files").delete().eq("id", row.id);
  if (rowErr) throw new Error(rowErr.message);
}

export interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  errorKey?: string;
  row?: MediaFileRow;
}

/** XHR upload — per-file progress + abort support (supabase-js has no progress). */
export function uploadFile(
  uid: string,
  bucket: string,
  file: File,
  folderId: string | null,
  onProgress: (pct: number) => void,
  signal: { aborted: boolean; abort?: () => void },
): Promise<MediaFileRow> {
  return new Promise((resolve, reject) => {
    const c = client();
    void c.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return reject(new Error("not_signed_in"));
      const path = buildObjectPath(uid, file.name);
      const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (!base) return reject(new Error("db_unavailable"));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${base}/storage/v1/object/${bucket}/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = async () => {
        if (signal.aborted) return reject(new Error("cancelled"));
        if (xhr.status >= 200 && xhr.status < 300) {
          const { data: row, error } = await c
            .from("media_files")
            .insert({
              bucket,
              path,
              folder_id: folderId,
              original_name: file.name,
              mime: file.type || "application/octet-stream",
              size_bytes: file.size,
              kind: detectKind(file.type),
            })
            .select("id,folder_id,bucket,path,original_name,mime,size_bytes,kind,width,height")
            .single();
          if (error) return reject(new Error(error.message));
          resolve(row as MediaFileRow);
        } else {
          reject(new Error(`upload_${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.onabort = () => reject(new Error("cancelled"));
      signal.abort = () => xhr.abort();
      xhr.send(file);
    });
  });
}
