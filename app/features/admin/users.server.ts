import { data } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";

/** fn_admin_set_role raises; map its messages to users.err.* keys */
function roleError(message: string): string {
  if (/last admin/i.test(message)) return "last_admin";
  if (/not allowed/i.test(message)) return "forbidden";
  if (/invalid role/i.test(message)) return "bad_role";
  if (/not found/i.test(message)) return "not_found";
  return "failed";
}

/** Shared with the profile page: ban/unban, hide/show products, role change. */
export async function handleUserAction(client: SupabaseClient, form: FormData) {
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const done = (res: { data: unknown; error: { message: string } | null }) => {
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
  };
  if (intent === "ban" || intent === "unban") {
    return done(await client.rpc("fn_admin_set_user_status", {
      p_user: String(form.get("id") ?? ""), p_status: intent === "ban" ? "blocked" : "active", p_reason: reason || null,
    }));
  }
  if (intent === "hide_products" || intent === "show_products") {
    return done(await client.rpc("fn_admin_set_vendor_hidden", {
      p_vendor: String(form.get("vendor_id") ?? ""), p_hidden: intent === "hide_products", p_reason: reason || null,
    }));
  }
  if (intent === "delete") {
    return done(await client.rpc("fn_admin_delete_user", { p_user: String(form.get("id") ?? ""), p_reason: reason || null }));
  }
  if (intent === "bulk") {
    // multi-select on the users list: ban / unban / delete, each validated by the DB
    const op = String(form.get("op") ?? "");
    const ids = form.getAll("ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v)).slice(0, 100);
    const newRole = String(form.get("role") ?? "");
    if (!["ban", "unban", "delete", "role"].includes(op) || ids.length === 0) return data({ ok: false, reason: "bad_intent" }, { status: 400 });
    const failed: Array<{ id: string; reason: string }> = [];
    let done_ = 0;
    for (const id of ids) {
      if (op === "role") {
        const { error } = await client.rpc("fn_admin_set_role", { p_user_id: id, p_new_role: newRole });
        if (error) failed.push({ id, reason: roleError(error.message) }); else done_ += 1;
        continue;
      }
      const res = op === "delete"
        ? await client.rpc("fn_admin_delete_user", { p_user: id, p_reason: reason || null })
        : await client.rpc("fn_admin_set_user_status", { p_user: id, p_status: op === "ban" ? "blocked" : "active", p_reason: reason || null });
      const r = res.data as { ok: boolean; reason?: string } | null;
      if (res.error || !r?.ok) failed.push({ id, reason: res.error?.message ?? r?.reason ?? "failed" });
      else done_ += 1;
    }
    return { ok: true as const, intent: "bulk" as const, op, done: done_, failed };
  }
  if (intent === "role") {
    const { error } = await client.rpc("fn_admin_set_role", { p_user_id: String(form.get("id") ?? ""), p_new_role: String(form.get("role") ?? "") });
    if (error) return data({ ok: false, reason: roleError(error.message) }, { status: 400 });
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

