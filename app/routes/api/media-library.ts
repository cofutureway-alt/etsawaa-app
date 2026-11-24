import { data, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { validateUpload } from "~/lib/media.shared";
import { isSafeFilterValue } from "~/lib/postgrest";
import * as api from "~/features/media/server-api";
import { UploadRejected } from "~/lib/media-pipeline.server";

/**
 * /api/media-library — the authorized half of the media picker.
 *
 * Every operation runs on the server so the httpOnly session cookie reaches
 * PostgREST and RLS sees the signed-in user. The browser only ever holds the
 * request; it never holds a token.
 *
 *   GET  ?op=folders
 *   GET  ?op=files&self=&search=&page=      (self = folder id or "")
 *   POST {op, ...}                           multipart for op=upload
 *
 * Uploads are gated server-side: the bucket is allowlisted and every file is
 * re-checked with validateUpload against the media settings row — the browser
 * pre-check in media-ui is advisory and a crafted request skips it. ?self=
 * reaches a PostgREST .or() string in listFiles, so it must pass the
 * postgrest filter guard before it is used at all.
 */
async function guard(request: Request) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return { error: data({ ok: false, reason: "db_unavailable" }, { status: 503 }) };
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return { error: data({ ok: false, reason: "unauthorized" }, { status: 401 }) };
  return { client, uid: viewer.user.id };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const url = new URL(request.url);
  const op = url.searchParams.get("op");

  try {
    if (op === "folders") {
      return data({ ok: true, folders: await api.listFolders(g.client) });
    }
    if (op === "files") {
      const self = url.searchParams.get("self") || null;
      // ?self= lands inside listFiles' .or() string, which postgrest-js never
      // escapes (app/lib/postgrest.ts) — a uuid passes the guard, anything
      // carrying the filter grammar is refused here before it is used.
      if (self !== null && !isSafeFilterValue(self)) {
        return data({ ok: false, reason: "bad_self" }, { status: 400 });
      }
      const page = Number(url.searchParams.get("page") ?? 0) || 0;
      const search = url.searchParams.get("search") ?? "";
      // descendant ids let a search span the current folder's subtree
      const folders = await api.listFolders(g.client);
      const folderIds = self ? descendants(folders, self).concat([self]) : [];
      const res = await api.listFiles(g.client, { selfId: self, folderIds, search, page });
      return data({ ok: true, ...res });
    }
    return data({ ok: false, reason: "bad_op" }, { status: 400 });
  } catch (error) {
    return data({ ok: false, reason: error instanceof Error ? error.message : "error" }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const g = await guard(request);
  if ("error" in g) return g.error;

  try {
    const form = await request.formData();
    const op = String(form.get("op") ?? "");

    switch (op) {
      case "createFolder": {
        const folder = await api.createFolder(
          g.client,
          String(form.get("name") ?? "").trim(),
          (form.get("parentId") as string) || null,
        );
        return data({ ok: true, folder });
      }
      case "renameFolder":
        await api.updateFolder(g.client, String(form.get("id")), String(form.get("name") ?? "").trim());
        return data({ ok: true });
      case "deleteFolder":
        await api.deleteFolder(g.client, String(form.get("id")));
        return data({ ok: true });
      case "renameFile":
        await api.updateFile(g.client, String(form.get("id")), {
          original_name: String(form.get("name") ?? "").trim(),
        });
        return data({ ok: true });
      case "moveFile":
        await api.updateFile(g.client, String(form.get("id")), {
          folder_id: (form.get("folderId") as string) || null,
        });
        return data({ ok: true });
      case "softDeleteFile":
        await api.updateFile(g.client, String(form.get("id")), {
          deleted_at: new Date().toISOString(),
        });
        return data({ ok: true });
      case "fileUsage":
        return data({ ok: true, usage: await api.fileUsage(g.client, String(form.get("path"))) });
      case "physicalDelete": {
        // Only the id comes from the client: bucket/path are read back from
        // the caller's own row (RLS), so the usage check and the storage
        // delete always act on the object that row really points at.
        const row = await api.getFile(g.client, String(form.get("id") ?? ""));
        if (!row) return data({ ok: false, reason: "not_found" }, { status: 404 });
        const res = await api.physicalDelete(g.client, row);
        return res.inUse
          ? data({ ok: false, reason: "in_use", usage: res.usage }, { status: 409 })
          : data({ ok: true });
      }
      case "upload": {
        const file = form.get("file");
        if (!(file instanceof File)) return data({ ok: false, reason: "no_file" }, { status: 400 });
        // The bucket name is written to Storage and the media_files row
        // verbatim, so only the allowlist may pass.
        const bucket = String(form.get("bucket") ?? "media");
        if (!api.isMediaBucket(bucket)) {
          return data({ ok: false, reason: "bad_bucket" }, { status: 400 });
        }
        // The browser pre-check (media-ui) is advisory; re-validate here so
        // the mime allowlist and per-kind size cap hold even for a crafted
        // request. The 400 carries validateUpload's i18n error-code, which is
        // the `reason` shape the client's upload error mapping reads.
        const settings = await api.loadMediaSettings(g.client);
        const rejectCode = validateUpload({ type: file.type, size: file.size, name: file.name }, settings);
        if (rejectCode) return data({ ok: false, reason: rejectCode }, { status: 400 });
        const row = await api.uploadMedia(
          g.client,
          g.uid,
          bucket,
          file,
          (form.get("folderId") as string) || null,
          settings,
        );
        return data({ ok: true, row });
      }
      default:
        return data({ ok: false, reason: "bad_op" }, { status: 400 });
    }
  } catch (error) {
    // infected / scan_unavailable / bad_image: a clear 4xx/503 the uploader maps to a message
    if (error instanceof UploadRejected) {
      return data({ ok: false, reason: error.reason }, { status: error.reason === "scan_unavailable" ? 503 : 422 });
    }
    return data({ ok: false, reason: error instanceof Error ? error.message : "error" }, { status: 500 });
  }
}

function descendants(folders: api.MediaFolderRow[], id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const f of folders) {
      if (f.parent_id === parent) {
        out.push(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return out;
}
