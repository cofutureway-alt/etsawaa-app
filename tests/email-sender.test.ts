import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, senderFor } from "../app/lib/email/sender";

test("contact templates go from support@, everything else from notifications@", () => {
  assert.equal(senderFor("contact_ack"), "support");
  assert.equal(senderFor("contact_received"), "support");
  assert.equal(senderFor("contact_reply"), "support");
  assert.equal(senderFor("order_placed"), "notifications");
  assert.equal(senderFor("event:product_approved"), "notifications");
  assert.equal(senderFor("user_invite"), "notifications");
  assert.equal(senderFor("order_placed", "support"), "support");
});

test("plain-text part keeps the words and the link targets", () => {
  const text = htmlToText('<style>p{}</style><p>Hello &amp; welcome</p><p><a href="https://etsawaa.com/ar">Open</a></p><ul><li>One</li></ul>');
  assert.equal(text, "Hello & welcome\nOpen (https://etsawaa.com/ar)\n- One");
});
