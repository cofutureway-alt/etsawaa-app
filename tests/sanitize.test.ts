import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeBlogHtml, sanitizeProductHtml, isRichHtml, htmlToText, escapeHtml } from "../app/lib/sanitize.ts";

test("sanitizeBlogHtml keeps YouTube embeds and video tags, drops other iframes", () => {
  const out = sanitizeBlogHtml(
    '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>' +
    '<iframe src="https://evil.example/x"></iframe>' +
    '<video controls src="https://cdn.example/v.mp4"></video>',
  );
  assert.ok(out.includes("youtube.com/embed/abc"), "YouTube embed survives");
  assert.equal(out.includes("evil.example"), false, "other hosts are dropped");
  assert.ok(out.includes("<video"), "video tag survives");
});

test("sanitizeBlogHtml keeps editor buttons and alignment, strips unsafe styles", () => {
  const out = sanitizeBlogHtml(
    '<p style="text-align: center; position: fixed; background: url(x)">' +
    '<a class="ets-btn" href="https://etsawaa.com/sell" target="_blank">Start</a></p>',
  );
  assert.ok(out.includes('class="ets-btn"'), "button class survives");
  assert.ok(out.includes("text-align: center"), "alignment survives");
  assert.equal(out.includes("position"), false, "positioning is removed");
  assert.equal(out.includes("url("), false, "url() is removed");
  assert.ok(/rel="[^"]*noopener/.test(out), "new-tab links get noopener");
});

test("sanitizeProductHtml allows formatting only and marks links nofollow ugc", () => {
  const out = sanitizeProductHtml(
    '<p><strong>Cotton</strong></p><ul><li>Size M</li></ul><img src="x.png">' +
    '<iframe src="https://www.youtube.com/embed/abc"></iframe><a href="https://shop.example">shop</a>',
  );
  assert.ok(out.includes("<strong>Cotton</strong>") && out.includes("<li>Size M</li>"));
  assert.equal(out.includes("<img"), false, "no images in descriptions");
  assert.equal(out.includes("<iframe"), false, "no embeds in descriptions");
  assert.ok(/rel="[^"]*nofollow/.test(out) && /rel="[^"]*ugc/.test(out));
});

test("htmlToText and isRichHtml handle old plain-text and new HTML descriptions", () => {
  assert.equal(isRichHtml("plain line\nsecond"), false);
  assert.equal(htmlToText("plain line\nsecond"), "plain line\nsecond");
  assert.equal(htmlToText("<p>One &amp; two</p><p>Three</p>"), "One & two\nThree");
});

test("sanitizeBlogHtml strips <script> tags and their content", () => {
  const out = sanitizeBlogHtml("<p>ok</p><script>alert(1)</script>");
  assert.equal(out.includes("<script"), false, "script tag must not survive");
  assert.equal(out.includes("alert(1)"), false, "script body must not survive");
  assert.ok(out.includes("ok"), "safe content survives");
});

test("sanitizeBlogHtml strips event handlers like onerror", () => {
  const out = sanitizeBlogHtml('<img src="cover.png" onerror="alert(1)">');
  assert.equal(out.includes("onerror"), false, "on* attribute must be stripped");
  assert.equal(out.includes("alert(1)"), false);
  assert.ok(out.includes("cover.png"), "safe src attribute survives");
});

test("sanitizeBlogHtml neutralizes javascript: hrefs", () => {
  const out = sanitizeBlogHtml('<a href="javascript:alert(1)">click</a>');
  assert.equal(out.toLowerCase().includes("javascript:"), false, "javascript: URI must be rejected");
  assert.ok(out.includes("click"), "link text survives");
});

test("sanitizeBlogHtml keeps safe article HTML with heading ids and classes", () => {
  const article = [
    '<h2 id="sec-0">Intro</h2>',
    '<p class="lead">Hello <strong>world</strong></p>',
    "<ul><li>one</li><li>two</li></ul>",
    '<a href="https://example.com" target="_blank" rel="noreferrer">src</a>',
  ].join("");
  const out = sanitizeBlogHtml(article);
  assert.ok(out.includes('id="sec-0"'), "withHeadingIds-injected id must survive");
  assert.ok(out.includes('class="lead"'), "styling class must survive");
  assert.ok(out.includes("<strong>world</strong>"));
  assert.ok(out.includes('href="https://example.com"'));
});

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml("plain text 123"), "plain text 123");
});

test("pasted no-break spaces become normal spaces so long descriptions wrap", async () => {
  const { sanitizeProductHtml } = await import("../app/lib/sanitize.ts");
  const out = sanitizeProductHtml("<p> </p><p dir=\"rtl\">دع دفقة جسم&nbsp;المرأة</p><p> </p>");
  assert.ok(!out.includes(" ") && !out.includes("&nbsp;"));
  assert.ok(out.includes("دع دفقة جسم المرأة"));
  assert.equal((out.match(/<p/g) ?? []).length, 1);
});
