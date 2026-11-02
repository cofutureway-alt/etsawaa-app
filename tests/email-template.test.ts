import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractVariables,
  tagErrors,
  validateTemplate,
  renderPreview,
  SAMPLE_VARIABLES,
} from "../app/lib/email/validate.ts";

const DECLARED = ["name", "site_name", "site_url"];

test("extractVariables finds every {{name}} once, in order", () => {
  assert.deepEqual(extractVariables("Hi {{name}} at {{ site_name }} — {{name}}"), ["name", "site_name"]);
  assert.deepEqual(extractVariables("no vars"), []);
});

test("tagErrors accepts well-formed nested html and void elements", () => {
  assert.deepEqual(tagErrors("<div><p>a <br> b</p><img src='x'></div>"), []);
  assert.deepEqual(tagErrors("<table><tr><td>1</td></tr></table>"), []);
  assert.deepEqual(tagErrors("<div><!-- comment --><hr/></div>"), []);
});

test("tagErrors rejects unclosed and crossed tags", () => {
  assert.ok(tagErrors("<div><p>x</div>").length > 0, "crossed tags");
  assert.ok(tagErrors("<div><p>x</p>").length > 0, "unclosed tag");
  assert.ok(tagErrors("</div>").length > 0, "stray closing tag");
});

test("validateTemplate blocks an empty subject or body (either locale)", () => {
  const base = { subjectAr: "أ", subjectEn: "A", htmlAr: "<p>{{name}}</p>", htmlEn: "<p>{{name}}</p>" };
  assert.deepEqual(validateTemplate(base, DECLARED), { ok: true });
  assert.equal(validateTemplate({ ...base, subjectEn: "   " }, DECLARED).ok, false);
  assert.equal(validateTemplate({ ...base, htmlAr: "" }, DECLARED).ok, false);
});

test("validateTemplate blocks unknown variables with their names", () => {
  const verdict = validateTemplate(
    { subjectAr: "أ", subjectEn: "A", htmlAr: "<p>{{name}} {{mystery}}</p>", htmlEn: "<p>x</p>" },
    DECLARED,
  );
  assert.equal(verdict.ok, false);
  assert.equal(!verdict.ok && verdict.reason, "unknown_variables");
  assert.equal(!verdict.ok && verdict.detail, "mystery");
});

test("validateTemplate blocks unclosed tags before any save", () => {
  const verdict = validateTemplate(
    { subjectAr: "أ", subjectEn: "A", htmlAr: "<div><p>{{name}}</div>", htmlEn: "<p>x</p>" },
    DECLARED,
  );
  assert.equal(verdict.ok, false);
  assert.equal(!verdict.ok && verdict.reason, "bad_tags");
});

test("renderPreview substitutes sample values and leaves unknown tokens", () => {
  assert.equal(renderPreview("Hi {{name}}", SAMPLE_VARIABLES), "Hi أحمد");
  assert.equal(renderPreview("{{unknown_x}}", SAMPLE_VARIABLES), "{{unknown_x}}");
  assert.ok((SAMPLE_VARIABLES.site_url ?? "").startsWith("https://"));
});
