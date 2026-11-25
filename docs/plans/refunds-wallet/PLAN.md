# Customer wallet + returns/exchanges (owner-approved 2026-11-25)

Two phases. **Phase A (customer wallet) is built first** because Phase B pays exchange credit into it.

Global rules:
- Money is integer **piastres** everywhere.
- Every money movement is a security-definer database function: atomic, row-locked, and idempotent (a unique reference, so a retry is harmless).
- Every movement writes `audit_logs` via `fn_audit`.
- Test-payment orders (`fn_is_test_order`) never move real wallet money, same as the seller wallet.
- Arabic UI text: simple standard Arabic, no colloquial words, no jargon. Add every new key to **both** `app/lib/i18n/ar.ts` and `en.ts` (the i18n-keys test checks this).
- No emoji anywhere. Icons come from `~/components/ui/icons`.
- Shell and SQL files stay LF.
- Follow the patterns of the seller wallet:
  - `wallets` / `wallet_transactions`;
  - `fn_post_transaction`;
  - the trigger `fn_wallet_apply_tx`;
  - migrations `20261101000001`, `20261104000016`, `20261104000023`.
- Read the **latest** definition of any function you change: grep every migration for `create or replace function public.<name>(` and take the newest file. Your new migration must replace that latest body, keeping everything else it does.

---

## Phase A — Customer wallet

### Owner decisions
- **No withdrawal.** The balance is spent on the site only.
- **Two kinds of balance:**
  - **Refund balance:** the customer's own money. It never expires.
  - **Gift balance:** granted by an admin, who **sets the expiry date when granting each gift**. There is no global setting. It can't be withdrawn.
- **At checkout:**
  - The customer can pay all or part of an order from the wallet; the rest is paid by card (Kashier) or cash on delivery.
  - Gift balance is spent first, earliest expiry first, then refund balance.
- **A cancelled order that was paid by card** (by the customer or the admin): the admin chooses whether the card part goes back to the wallet or is refunded the normal way. The wallet part of any cancelled order always goes straight back to the wallet.

### Database (new migration `supabase/migrations/20261125000078_customer_wallet.sql`)

1. `customer_wallets`:
   - `user_id` (PK, references `auth.users`);
   - `refund_piastres bigint not null default 0 check (>= 0)`;
   - `gift_piastres bigint not null default 0 check (>= 0)`;
   - `updated_at`.

   The balances are maintained **only** by a trigger on the ledger. The check constraints make overspending impossible.
2. `customer_wallet_gifts` (gift lots):
   - `id`, `user_id`;
   - `amount_piastres > 0`;
   - `remaining_piastres >= 0`;
   - `expires_at timestamptz not null`;
   - `reason text not null`;
   - `status in ('active','used','expired')`;
   - `created_by`, `created_at`.
3. `customer_wallet_transactions` (the ledger, source of truth):
   - `id`, `user_id`;
   - `bucket in ('refund','gift')`;
   - `type in ('refund_credit','exchange_credit','cancel_credit','order_payment','order_payment_reversal','gift_credit','gift_expiry','admin_credit','admin_debit')`;
   - `amount_piastres bigint` (signed: + credit, − debit, never 0);
   - `reference text not null`;
   - `order_id`, `refund_request_id`, `gift_id` (nullable FKs);
   - `reason`: required for debits and for admin types;
   - `meta jsonb`, `created_by`, `created_at`;
   - **unique `(user_id, type, bucket, reference)`**.
4. Trigger `after insert` on the ledger: ensures the wallet row exists, then adds the amount to the right bucket column.
5. RLS:
   - The customer selects only their own rows: wallet, ledger and gifts.
   - Admins select everything (`is_admin()`).
   - Nobody inserts, updates or deletes directly. The functions are security definer.
6. Functions:
   - `fn_wallet_post(user, bucket, type, amount, reference, reason, order_id, refund_request_id, gift_id, meta)`:
     - internal; grant it to `service_role` only;
     - idempotent: it returns `duplicate` on a repeat;
     - skips test orders.
   - `fn_wallet_spend(user, amount, order_id, reference)`:
     - internal;
     - locks the user's active gift lots (`for update`), earliest `expires_at` first, skipping any lot already past its expiry;
     - takes from them, then from the refund bucket;
     - writes one `order_payment` row per bucket and records the lot allocations in `meta.lots`;
     - raises `insufficient_balance` if the total is not available.
   - `fn_wallet_restore(order_id, reason)`:
     - internal;
     - reverses every `order_payment` of that order exactly once (`order_payment_reversal`, same buckets);
     - gives the gift amounts back to the same lots;
     - if a lot is already expired, that part is expired again at once with a `gift_expiry` row.
   - `fn_my_wallet()`: for the signed-in customer. Returns the balances, the active gifts with their expiry dates and the latest 100 ledger rows.
   - `fn_admin_wallet_adjust(user, amount, reason)`:
     - admin only, reason required, refund bucket only;
     - a positive amount is `admin_credit`, a negative one is `admin_debit`;
     - a debit can't exceed the balance;
     - audited, and notifies the customer.
   - `fn_admin_wallet_gift(user, amount, expires_at, reason)`:
     - admin only;
     - `expires_at` must be in the future;
     - creates the lot and posts `gift_credit`;
     - audited, and notifies the customer with the expiry date.
   - `fn_admin_wallet_gift_cancel(gift_id, reason)`: admin only. Expires what is left of that lot now.
   - `fn_wallet_expire_gifts()`: posts `gift_expiry` for every active lot past `expires_at` that still has a remainder. Schedule it daily with pg_cron, the same way the existing jobs are scheduled (see `20261031000002_phase03_vendor_core.sql` and `20261104000003_levels_badges_rewards.sql`).
   - `fn_admin_customer_wallets(search, page)`: admin list of customers with a balance, plus the totals the platform owes customers (refund total, active gift total).

### Checkout
- **`fn_create_order`:**
  - Takes the latest body. Accepts `p_payload->>'wallet_piastres'`, the amount the customer wants to use.
  - The server caps it to `least(requested, available balance, order total)` and calls `fn_wallet_spend` inside the same transaction.
  - Add `orders.wallet_paid_piastres integer not null default 0`.
  - `payment_method`:
    - if the wallet covers the whole total, the method is `'wallet'` (extend the orders check constraint), the payment is `paid`, and the order goes straight to the same status a confirmed card payment gives;
    - otherwise the method stays `kashier`/`cod` for the remainder.
- **Kashier:** the payment session amount must be `total_piastres - wallet_paid_piastres`. Find where the session amount is built and where `fn_confirm_payment` compares the paid amount, and make both use the remainder.
- **Cash on delivery:**
  - The amount to collect is the remainder too: courier documents, print centre, `fn_set_cod_collected`, and the COD cap check.
  - Grep `total_piastres` in the order print, the tracking page and the admin and vendor order pages, and show «مدفوع من المحفظة» where it applies.
- **An unpaid card order that is cancelled or expires** gives its wallet part back via `fn_wallet_restore`. Find the job or function that cancels unpaid orders.
- **The checkout page** (`app/routes/checkout.tsx`):
  - A «استخدام رصيد المحفظة» block appears only when the balance is > 0.
  - It shows the available balance, with the gift part and its nearest expiry.
  - The customer can use the full amount or type a smaller one.
  - The total and remainder update live.
  - If the wallet covers everything, the payment method choice is hidden.

### Cancellation
- **Wallet part:** `fn_cancel_order` and `fn_cancel_order_admin` (latest bodies) call `fn_wallet_restore` for the wallet part.
- **Card part already paid:** create a `refund_requests` row so the admin decides on it:
  - `source = 'cancel'` (extend the check);
  - `status = 'approved'`;
  - `logistics_status = 'not_required'`;
  - `refund_total_piastres` = the card amount paid;
  - no items.

  It appears in `/admin/refunds` → «معتمد» with its own badge «إلغاء طلب».
- **`fn_admin_execute_refund`:**
  - Add the method `'store_wallet'`.
  - When chosen, it posts `refund_credit` (or `cancel_credit` for `source='cancel'`) of `refund_total_piastres` to the customer's refund bucket. Reference: `refund:<request id>`.
  - Then it marks the request refunded as today.
  - The admin refunds page and the order returns panel offer «رصيد في محفظة العميل» as the first method.

### Screens
- **Customer `/account/wallet`:** add it to the account nav.
  - Balance cards: refund balance, gift balance with the nearest expiry date.
  - A list of active gifts with their expiry dates.
  - A ledger table with date, description, amount (green for credit, red for debit) and the linked order number.
  - Empty state.
  - A short line: «الرصيد يستخدم في الشراء من الموقع فقط ولا يمكن سحبه».
- **Admin `/admin/customer-wallets`:** add it to the admin nav, next to the refunds page.
  - The total the platform owes customers.
  - A searchable list (name, phone, email).
  - A customer page with balances, gift lots and the ledger, plus two dialogs:
    - «إضافة أو خصم رصيد»: amount and required reason;
    - «منح هدية»: amount, **expiry date** (required) and reason;
  - and canceling a gift.
  - Use the existing admin permission checks. Look at how `app/lib/permissions.ts` and `app/features/admin/nav.ts` gate refunds, and gate this page the same way.
- **The customer profile in the admin**, if such a page exists: show the wallet balance with a link.
- **Notifications:** use `fn_notify`, plus the messaging and email catalogs if events are registered there (see `app/lib/messaging/catalog.ts`, `app/lib/email/catalog.ts`). Events:
  - `wallet_credited`;
  - `wallet_debited_admin`;
  - `wallet_gift`;
  - `wallet_gift_expiring`: 3 days before expiry, sent by the daily job, once per lot.

### Tests
- Add `tests/customer-wallet.test.ts` for any client-side math, such as the checkout split and the gift-first order. Register it in the `npm test` script.
- `npm run typecheck` and `npm test` must pass.

### Docs
- Update `docs/order-lifecycle.md`: a new section for the customer wallet, the checkout split, and cancellation with the admin's choice.

---

## Phase B — Returns and exchanges (after Phase A is reviewed)

### Owner decisions
1. **The customer chooses a resolution** when requesting a return:
   - `same_product`: a new unit of the same product. **Another size or color of it is allowed**;
   - `other_products`: one or more other products from the site;
   - `refund`: money back.
2. **Prices** of the new products are the site price at the time of the exchange. No coupons.
3. **The difference is paid only after the admin approves.** The admin chooses the allowed methods in the settings (`/admin/settings/sections`, new «المرتجعات والاستبدال» section): payment gateway, cash on delivery, or both. The wallet can also pay it.
4. **Exchange shipping when the reason is the customer's** (change of mind) is paid by the customer and added to the difference. When the seller is at fault, the seller pays, as today.
5. **When the customer is owed money**, the admin chooses at approval: the wallet or a normal refund. Nothing is automatic.
6. **One courier trip:** the replacement is delivered when the return is picked up.
7. **Fix:** `fn_request_refund` inserts the request before validating the items. A failing item returns `ok:false` without rolling back, so a partial request stays saved. Validate everything first, or raise so the whole request rolls back.

The detailed Phase B spec is written after Phase A is reviewed.
