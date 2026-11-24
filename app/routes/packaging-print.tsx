import type { Route } from "./+types/packaging-print";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { getPackagingOrder } from "~/features/packaging/api.server";
import {
  renderPackagingInvoice, renderPackagingLabel, renderPackagingReturnLabel, type PackagingDoc,
} from "~/features/packaging/documents.server";

/**
 * GET /packaging/:number/print/:doc?lang=ar|en[&return=<id>] — printable
 * invoice, shipping label and return label of a packaging order. Reads go
 * through the viewer's own client: an admin sees every order, a seller only
 * theirs; anything else is 404 (an order number's existence is not leaked).
 */
const DOCS: PackagingDoc[] = ["invoice", "label", "return_label"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "ar";
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Unavailable", { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) throw new Response("Forbidden", { status: 403 });
  const doc = (params.doc ?? "") as PackagingDoc;
  if (!DOCS.includes(doc)) throw new Response("Not found", { status: 404 });
  const order = await getPackagingOrder(client, decodeURIComponent(params.number ?? ""));
  if (!order) throw new Response("Not found", { status: 404 });
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? url.origin;

  let html: string;
  if (doc === "invoice") {
    html = renderPackagingInvoice(order, lang, siteUrl);
  } else if (doc === "label") {
    html = await renderPackagingLabel(order, lang, siteUrl);
  } else {
    const ret = order.returns.find((r) => r.id === url.searchParams.get("return"));
    if (!ret) throw new Response("Not found", { status: 404 });
    html = await renderPackagingReturnLabel(order, {
      number: ret.number,
      reason: ret.reason,
      items: ret.items.map((ri) => {
        const it = order.items.find((i) => i.id === ri.order_item_id);
        return { name_ar: it?.name_ar ?? "", name_en: it?.name_en ?? "", unit: it?.unit ?? "piece", qty: ri.qty };
      }),
    }, lang, siteUrl);
  }
  await client.rpc("fn_audit", {
    p_action: "packaging.document_printed", p_entity: "packaging_orders", p_entity_id: order.id,
    p_before: null, p_after: { doc, return: url.searchParams.get("return") },
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
