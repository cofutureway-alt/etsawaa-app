import { useRef, useState } from "react";
import { Editor } from "@tinymce/tinymce-react";
import type { Editor as TinyEditor } from "tinymce";
import { useTranslation } from "react-i18next";

/**
 * Rich-text field on TinyMCE, self-hosted from /vendor/tinymce (copied there
 * by scripts/copy-tinymce.mjs) — no Tiny Cloud key, no third-party script.
 *
 *  variant "article"  blog posts: headings, images (uploaded through
 *                     /api/upload), video embeds (YouTube / Vimeo / mp4 URL),
 *                     tables, links with rel options (follow / nofollow /
 *                     sponsored) and call-to-action buttons (`a.ets-btn`).
 *  variant "product"  seller descriptions: text formatting, lists, tables and
 *                     links only — no media.
 *
 * What is stored is HTML; every reader passes it through sanitizeBlogHtml /
 * sanitizeProductHtml (app/lib/sanitize.ts) before rendering, so the editor's
 * own limits are a convenience, not the security boundary.
 *
 * Use it uncontrolled inside a <form> (`name` + `defaultValue`: a hidden
 * input carries the HTML) or controlled (`value` + `onChange`).
 */

export interface RichTextEditorProps {
  id: string;
  label: string;
  variant: "article" | "product";
  /** content direction of this field (Arabic fields rtl, English ltr) */
  dir: "rtl" | "ltr";
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (html: string) => void;
  minHeight?: number;
  hint?: string;
  /**
   * Mount TinyMCE only when the field is clicked (default for "product").
   * A product form has two editors; loading ~1 MB of editor code and two
   * iframes up front made the form slow to open on ordinary devices.
   */
  lazy?: boolean;
}

const BUTTON_STYLES = ["ets-btn", "ets-btn ets-btn-outline"] as const;

export function RichTextEditor({ id, label, variant, dir, name, defaultValue, value, onChange, minHeight, hint, lazy }: RichTextEditorProps) {
  const { t, i18n } = useTranslation();
  const uiLang = i18n.language === "en" ? "en" : "ar";
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const [ready, setReady] = useState(false);
  // TinyMCE reads `initialValue` once; later edits flow through onEditorChange
  const initial = useRef(defaultValue ?? "");
  const html = controlled ? value : inner;
  const article = variant === "article";
  const [active, setActive] = useState(!(lazy ?? !article));
  const height = minHeight ?? (article ? 520 : 300);

  const handleChange = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const setup = (editor: TinyEditor) => {
    if (!article) return;
    editor.ui.registry.addButton("etsbutton", {
      icon: "new-tab",
      text: t("editor.button"),
      tooltip: t("editor.buttonTip"),
      onAction: () => openButtonDialog(editor, t),
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-text">{label}</label>
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
      {!active ? (
        <button
          id={id}
          type="button"
          dir={dir}
          onClick={() => setActive(true)}
          onFocus={() => setActive(true)}
          className="flex w-full flex-col items-stretch gap-2 rounded-md border border-border bg-surface p-3 text-start transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          style={{ minHeight: Math.min(height, 160) }}
        >
          <span className="line-clamp-4 whitespace-pre-line text-sm text-text">{plainText(html)}</span>
          <span className="mt-auto text-xs font-bold text-text-faint">{t("editor.clickToEdit")}</span>
        </button>
      ) : (
      <div className="relative overflow-hidden rounded-md border border-border bg-surface" style={{ minHeight: height }}>
        {!ready ? (
          <div aria-hidden="true" className="absolute inset-0 flex flex-col gap-2 p-3">
            <div className="h-9 animate-pulse rounded bg-surface-tint" />
            <div className="flex-1 animate-pulse rounded bg-surface-tint/60" />
          </div>
        ) : null}
        <Editor
          id={id}
          tinymceScriptSrc="/vendor/tinymce/tinymce.min.js"
          licenseKey="gpl"
          initialValue={controlled ? undefined : initial.current}
          value={controlled ? value : undefined}
          onEditorChange={handleChange}
          onInit={() => setReady(true)}
          init={{
            height,
            menubar: false,
            branding: false,
            promotion: false,
            statusbar: true,
            elementpath: false,
            resize: true,
            toolbar_mode: "wrap",
            language: uiLang === "ar" ? "ar" : undefined,
            language_url: uiLang === "ar" ? "/vendor/tinymce/langs/ar.js" : undefined,
            directionality: dir,
            convert_urls: false,
            entity_encoding: "raw",
            browser_spellcheck: true,
            contextmenu: false,
            plugins: article
              ? "advlist autolink lists link image media table code fullscreen preview wordcount directionality anchor"
              : "advlist autolink lists link table wordcount directionality",
            toolbar: article
              ? "undo redo | blocks | bold italic underline strikethrough forecolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent blockquote | link etsbutton anchor | image media table | ltr rtl | removeformat code preview fullscreen"
              : "undo redo | blocks | bold italic underline | bullist numlist | alignleft aligncenter alignright | link table | ltr rtl | removeformat",
            block_formats: article
              ? `${t("editor.paragraph")}=p; ${t("editor.h2")}=h2; ${t("editor.h3")}=h3; ${t("editor.h4")}=h4`
              : `${t("editor.paragraph")}=p; ${t("editor.h3")}=h3; ${t("editor.h4")}=h4`,
            invalid_elements: article ? "script,style,object,embed,form,input" : "script,style,object,embed,form,input,img,iframe,video,audio",
            // links / backlinks
            link_default_target: "_self",
            link_default_protocol: "https",
            link_assume_external_targets: "https",
            link_title: true,
            link_target_list: [
              { title: t("editor.sameTab"), value: "" },
              { title: t("editor.newTab"), value: "_blank" },
            ],
            link_rel_list: article
              ? [
                  { title: t("editor.relFollow"), value: "" },
                  { title: t("editor.relNofollow"), value: "nofollow" },
                  { title: t("editor.relSponsored"), value: "sponsored nofollow" },
                ]
              : undefined,
            link_class_list: article
              ? [
                  { title: t("editor.linkPlain"), value: "" },
                  { title: t("editor.btnPrimary"), value: BUTTON_STYLES[0] },
                  { title: t("editor.btnOutline"), value: BUTTON_STYLES[1] },
                ]
              : undefined,
            // images: uploaded to the public media bucket under the session
            image_caption: true,
            image_title: true,
            image_dimensions: true,
            automatic_uploads: true,
            paste_data_images: article,
            images_file_types: "jpeg,jpg,png,webp",
            images_upload_handler: article ? uploadImage : undefined,
            // video: YouTube / Vimeo links become responsive embeds; .mp4 URLs a <video>
            media_live_embeds: true,
            media_alt_source: false,
            media_dimensions: true,
            table_default_attributes: {},
            table_default_styles: { width: "100%", "border-collapse": "collapse" },
            setup,
            content_style: contentStyle(dir),
            auto_focus: lazy ?? !article ? id : undefined,
          }}
        />
      </div>
      )}
      {name ? <input type="hidden" name={name} value={html} /> : null}
    </div>
  );
}

/** Text-only preview of stored HTML for the not-yet-opened editor (rendered as text, never as HTML). */
function plainText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Insert or edit a call-to-action button (`a.ets-btn`). */
function openButtonDialog(editor: TinyEditor, t: (key: string) => string) {
  const existing = editor.dom.getParent(editor.selection.getNode(), "a.ets-btn") as HTMLAnchorElement | null;
  const initial = {
    text: existing?.textContent ?? editor.selection.getContent({ format: "text" }) ?? "",
    href: existing?.getAttribute("href") ?? "https://",
    style: existing?.classList.contains("ets-btn-outline") ? BUTTON_STYLES[1] : BUTTON_STYLES[0],
    rel: existing?.getAttribute("rel")?.includes("sponsored") ? "sponsored nofollow" : existing?.getAttribute("rel")?.includes("nofollow") ? "nofollow" : "",
    newTab: existing?.getAttribute("target") === "_blank",
  };
  editor.windowManager.open({
    title: t("editor.buttonTitle"),
    body: {
      type: "panel",
      items: [
        { type: "input", name: "text", label: t("editor.buttonText") },
        { type: "input", name: "href", label: t("editor.buttonUrl") },
        {
          type: "selectbox", name: "style", label: t("editor.buttonStyle"),
          items: [
            { text: t("editor.btnPrimary"), value: BUTTON_STYLES[0] },
            { text: t("editor.btnOutline"), value: BUTTON_STYLES[1] },
          ],
        },
        {
          type: "selectbox", name: "rel", label: t("editor.linkRel"),
          items: [
            { text: t("editor.relFollow"), value: "" },
            { text: t("editor.relNofollow"), value: "nofollow" },
            { text: t("editor.relSponsored"), value: "sponsored nofollow" },
          ],
        },
        { type: "checkbox", name: "newTab", label: t("editor.newTab") },
      ],
    },
    initialData: initial,
    buttons: [
      { type: "cancel", text: t("common.cancel") },
      { type: "submit", text: t("editor.insert"), primary: true },
    ],
    onSubmit: (api) => {
      const d = api.getData() as typeof initial;
      const text = d.text.trim();
      const href = d.href.trim();
      if (!text || !href || href === "https://") return;
      const attrs: Record<string, string | null> = {
        href,
        class: d.style,
        target: d.newTab ? "_blank" : null,
        rel: [d.rel, d.newTab ? "noopener" : ""].filter(Boolean).join(" ") || null,
      };
      if (existing) {
        editor.dom.setAttribs(existing, attrs);
        existing.textContent = text;
      } else {
        const a = editor.dom.createHTML("a", attrs, editor.dom.encode(text));
        editor.insertContent(`<p>${a}</p>`);
      }
      editor.undoManager.add();
      api.close();
    },
  });
}

async function uploadImage(blobInfo: { blob: () => Blob; filename: () => string }): Promise<string> {
  const form = new FormData();
  form.set("op", "image");
  form.set("bucket", "media");
  form.set("file", new File([blobInfo.blob()], blobInfo.filename(), { type: blobInfo.blob().type }));
  const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; url?: string | null; reason?: string } | null;
  if (!res.ok || !json?.ok || !json.url) {
    throw { message: json?.reason === "invalid_file" ? "JPG / PNG / WebP, 5 MB max" : "Upload failed", remove: true };
  }
  return json.url;
}

/** The editor iframe: same font, link and button look as the public article. */
function contentStyle(dir: "rtl" | "ltr"): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `
@font-face{font-family:Cairo;src:url(${origin}/fonts/cairo-var-arabic.woff2) format("woff2");font-weight:200 1000;unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF}
@font-face{font-family:Cairo;src:url(${origin}/fonts/cairo-var-latin.woff2) format("woff2");font-weight:200 1000}
body{font-family:Cairo,system-ui,sans-serif;font-size:16px;line-height:1.8;color:#1f1f1f;margin:14px;direction:${dir}}
h2{font-size:1.35em;font-weight:800;margin:1.2em 0 .4em}h3{font-size:1.15em;font-weight:800;margin:1em 0 .3em}
a{color:#be0404}
img,video,iframe{max-width:100%;height:auto;border-radius:10px}
iframe{aspect-ratio:16/9;width:100%}
blockquote{margin:0;padding:.75em 1em;border-radius:10px;background:#f6f3f1;color:#555}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 8px}
a.ets-btn{display:inline-block;padding:.65em 1.4em;border-radius:10px;background:#be0404;color:#fff;font-weight:800;text-decoration:none}
a.ets-btn.ets-btn-outline{background:transparent;color:#be0404;box-shadow:inset 0 0 0 2px #be0404}
`;
}
