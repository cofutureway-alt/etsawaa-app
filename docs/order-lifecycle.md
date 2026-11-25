# Etsawaa — the complete order lifecycle

How an order moves through the platform from the **buyer**, **seller** and **administrator** side, including returns, pickup fees, commission, wallets, packaging and the legal documents. Each step names the screen and the database function that enforces it, so missing steps can be spotted.

Money is always stored in **piastres** (1 EGP = 100 piastres). Every money movement for a seller is one row in the **wallet ledger** (`wallet_transactions`), with:
- a type;
- a reason;
- links to the order, the shipment or the packaging order;
- structured details (`meta`), such as pickup units, rate and billing mode;
- a **unique reference**.

The unique reference is what makes retries harmless: posting the same reference twice is a no-op.

---

## 0. Before anything: accounts and legal documents

| Who | What happens | Where |
|---|---|---|
| Every new user | Signs up and must tick "I accept the Terms & Conditions". The server sends the exact version shown on the page. The sign-up trigger records it in `legal_acceptances` with the version, time, IP and browser. A sign-up whose page showed an outdated version is refused ("the Terms were just updated"). | `/auth/register` → `handle_new_user` |
| Google sign-up | Same, on the "complete your profile" step. | `/auth/complete` → `fn_accept_legal` |
| Any signed-in user without the **current** Terms version (old account, Google, newly published version) | Every account, seller and admin page sends them to the acceptance page, then back to where they were. Checkout refuses to place an order until they accept. | `/legal/accept`, `requireLegalAccepted`, `checkoutAction` |
| Seller | Signs the **seller agreement** (checkbox + typed full-name signature) in the onboarding wizard. A trigger records the acceptance with the store, version, time and signature. **A store cannot be approved without it** (`seller_agreement_not_accepted`). A store past onboarding that has not signed the current version is sent to the acceptance page. | wizard step 4, `trg_vendor_terms_acceptance`, `fn_admin_review_vendor` |
| Everyone, any time | Reads the current version, or the exact version they accepted (`?v=`). | `/legal/terms`, `/legal/seller-agreement`, Account → Profile → "Legal documents you accepted", Seller → "Seller agreement" |
| Admin | Publishes a new version: users must accept it on their next visit, and earlier acceptances stay on record. Searches the acceptance register by name, email or store, showing version, time, how it was accepted, signature and IP. | `/admin/legal` → `fn_admin_publish_legal` |

The Terms (v2.0) were imported from the two uploaded `.docx` files: 22 sections and 95 clauses, matched Arabic ↔ English clause by clause. Both files say the Arabic version prevails.

---

## 1. Buyer perspective

1. **Browse** the catalog, search, filters and product pages. Products are child products (colour) with sizes, each size with its own stock.
2. **Cart.** Lines are per size. The cart is re-priced against the live price and stock at checkout.
3. **Checkout** (address → shipping → payment → confirm), via `fn_create_order`, which is the only authority on prices:
   - **Shipping fee:** the fee of the buyer's governorate. A free-shipping coupon sets it to 0.
   - **Coupon:** one per order. Its discount is spread over the lines (`order_items.coupon_discount_piastres`), so each product knows exactly what the buyer paid for it.
   - **Commission:** fixed per line at order time (`commission_piastres`, `commission_rate_bps`) from the category, seller or level rules.
   - **Shipments:** the order is split into one **shipment per seller** (`order_vendor_groups`). A multi-seller order has several shipments, each with its own status.
   - **Stock:** reserved for every size.
   - **Payment method:** card (Kashier) or cash on delivery. COD is limited to the configured maximum (5,000 EGP), and some seller-shipped items cannot be paid COD.
4. **Payment.**
   - **Card:** the order waits as `pending_payment`, and the buyer is sent to Kashier's hosted page.
     - Only the signed **webhook** changes payment state (`fn_confirm_payment`). It is idempotent on the transaction reference and checks the amount.
     - A failure is recorded and the buyer can retry.
     - Success moves the order to `processing`, or to `on_hold` while a seller-shipping request awaits approval.
   - **COD:** the order goes straight to `processing`. The admin marks the cash collected after delivery (`fn_set_cod_collected`).
5. **Confirmation.** The buyer gets the order page, a notification and an email.
6. **Shipping and tracking.** Each shipment moves through its own steps: `pending → preparing → handed_to_carrier → out_for_delivery → delivered`. The buyer sees each step on the order and tracking page and is notified on delivery.
7. **Delivery.** When every shipment is delivered, the order becomes `completed`.
8. **Returns and refunds.**
   - **The buyer starts a return:** within 14 days (or 30 days for a warranty claim) of delivery, from the order page, choosing **which products and how many units**, with a reason and photo or video evidence (`fn_request_refund`). The administration decides.
   - **The administration starts a return:** see §3.4. It covers products that are only partly coming back.
   - **Refund amount:**
     - Each product refunds what the buyer actually paid for those units: the line price minus that line's share of the coupon, never the original list price. Promotional discounts are not refunded in cash, as the Terms require.
     - Shipping is refunded only when the admin decides it was the platform's or the seller's fault.
     - For a change of mind, the return shipping cost can be deducted.
   - **Timing:** the refund is paid after the goods are received back, unless nothing needs to come back. The order then shows `partially_refunded` or `refunded`, and the buyer is notified at every step.

---

## 1a. Customer wallet (phase A)

The site keeps money for a customer in two separate balances (`customer_wallets`). The ledger (`customer_wallet_transactions`) is the source of truth: the two balance columns move only from the trigger that applies each ledger row, and a `>= 0` check makes overspending impossible. Every movement is a security-definer function that locks the rows it reads and carries a unique reference, so a retry is harmless.

- **Refund balance (your own money).** Refunds credited to the wallet land here, and it never expires.
- **Gift balance.** An admin grants each gift with its own expiry date. There is no global setting. A gift can also be cancelled by the admin, which removes what is left of it right away.
- **No withdrawal.** The balance is spent on the site only.

**At checkout** (`/checkout`):
- The "use wallet balance" block appears only when the balance is above zero. It shows the available amount, split into the refund part and the gift part with the nearest expiry.
- The customer takes the whole balance or types a smaller amount. `fn_create_order` re-caps it server-side to `least(requested, available, order total)`, so a forged request cannot overspend.
- **Spending order:** the gift lots first, earliest expiry first, then the refund balance (`fn_wallet_spend`). The lot split is kept in the payment row's `meta.lots`.
- **If the wallet covers the whole total:** the payment method becomes `wallet`, the order is paid at once, and it takes the same status a confirmed card payment gives it. No card or cash step is needed.
- **Otherwise** the customer pays the remainder by card (Kashier) or cash on delivery. The Kashier session amount and `fn_confirm_payment` both compare against `total − wallet_paid_piastres`, and the COD cap applies to the remainder as well. Order documents and the admin/vendor order pages show "paid from wallet" and the amount still due.

**Expiry.** A daily job (`fn_wallet_expire_gifts`, pg_cron) warns the customer three days before a gift expires, then posts `gift_expiry` for whatever is left once the date passes.

**Cancellation.** When an order is cancelled by the customer (`fn_cancel_order`) or by an admin (`fn_cancel_order_admin`):
- **The wallet part always goes straight back to the wallet** (`fn_wallet_restore`): each `order_payment` row is reversed once, the gift money returns to the same lots, and a lot already past its date expires again at once.
- **The card part already paid** opens a `refund_requests` row with `source = 'cancel'`, status `approved`, logistics `not_required`, and the card amount as `refund_total_piastres`. It shows in `/admin/refunds` under "approved" with the «طلب ملغى» badge, and the admin then chooses:
  - **store wallet balance** (`store_wallet`): the amount is credited to the refund balance as `refund_credit`, or `cancel_credit` for a cancelled order, with reference `refund:<request id>`; or
  - any other method, recorded as today.

**Screens.** `/account/wallet` (added to the account nav) shows the balances, the active gift lots and the ledger with a link to each order. `/admin/customer-wallets` (next to refunds, gated by `refunds.view`) shows the totals the platform owes customers and a searchable list; each customer page has the balances, the gift lots and the ledger plus the adjust, grant-gift and cancel-gift dialogs. Notifications and emails go out for `wallet_credited`, `wallet_debited_admin`, `wallet_gift` and `wallet_gift_expiring`.

Test-mode orders never move wallet money: `fn_wallet_post` skips them, the same rule the seller wallet follows.

---

## 1b. Returns and exchanges (phase B)

When the buyer returns products (`/account/orders/:number/return`), they choose what they want:
- **Money back** (`refund`), as before.
- **The same product** (`same_product`): a new unit of a returned product. Another size or colour is allowed.
- **Other products** (`other_products`): one or more products from the site.

The picker shows only sellable options at **today's site price**. Coupons are never applied to an exchange.

`fn_request_refund` checks everything before it saves anything, so a failing line can no longer leave a partial request. A rejected or closed request frees its units again.

**Admin decision** (`/admin/refunds`, `fn_admin_decide_refund`):
1. The usual engine settles the returned lines (`fn_refund_apply`): caps, seller clawbacks, penalties and return pickup fees.
2. For an exchange, `fn_refund_make_exchange` runs next:
   - It credits the approved return value to the customer's wallet (`exchange_credit`).
   - It creates the **replacement order** through `fn_create_order` itself, as the customer and with their cart set aside, so pricing, stock, seller groups, commission and notifications are the checkout's own.
   - The order is paid from that credit (`wallet_paid_piastres`).
   - Shipping is the customer's when an approved line is their fault (change of mind). Otherwise it ships free.
   - The order is linked both ways: `orders.exchange_request_id` and `refund_requests.exchange_order_id`.
3. **If the replacements cost more**, the customer pays the difference on the new order after approval:
   - by card (Kashier), or
   - on delivery (`fn_exchange_choose_cod`),

   as `settings.returns.exchange_pay_methods` allows. The cash-on-delivery limit and the rule for store-shipped products still apply.
4. **If the return is worth more**, the admin chooses at approval where the rest goes (`credit_destination`):
   - `wallet`: it stays in the customer's wallet.
   - `original`: it is taken back out of the wallet and refunded later with a method and reference (execute step).
5. The admin can also turn an exchange request into a plain refund (`p_options.resolution = 'refund'`).

An exchange with nothing left to pay out is marked done (`refund_method = 'exchange'`) once the goods are back.

**Invoice:** the replacement order's invoice is titled "Exchange invoice". It lists the returned products it replaces, the return value and the difference.

**Settings:** `/admin/settings/sections` → Returns and exchanges. It turns exchanges on or off and sets how the difference may be paid.

## 2. Seller perspective

1. **New order.** The seller sees only their own shipment of the order (`/vendor/orders`), with their items, quantities and payout, and gets a notification.
2. **Preparing.** Mark it `preparing`. The Terms require photographing the product before packing.
3. **Packaging requirements.** Ship in platform packaging, bought in the packaging store (§2.9).
4. **Pickup request.** Mark the shipment **handed to carrier** when the courier collects it. Print the seller label and invoice from the order.
5. **Pickup fee deduction** (`fn_post_pickup_fee` → `fn_charge_pickup`), at that moment, exactly once per shipment.
   - **Rate:** the pickup rate of the seller's area (Admin → Shipping zones).
   - **Billing method** (Admin → Settings → Pickup fees):
     - **Per shipment:** 1 × rate, whatever the number of products. Example: 3 products at 10 EGP = 10 EGP.
     - **Per product:** rate × the number of product units in the shipment. Example: 3 products at 10 EGP = 30 EGP.
   - **Records:** a `pickup_charges` row (mode, units, rate, amount) plus a wallet debit with the reason "Pickup fee — order N: 3 products × 1000 piastres". The wallet shows the breakdown under the entry.
   - **Retry safe:** the shipment row is locked, and the unique keys are "one outbound pickup per shipment" and the ledger reference `pickup:<shipment>`. Pressing the button again, a network retry, or an admin and a seller acting at the same time all produce one charge.
   - **Multi-seller orders:** each seller's shipment is charged separately, on that seller's own wallet.
   - **Seller-shipped orders** (seller delivers it themselves) are not charged a pickup fee.
6. **Shipping and delivery.** `out_for_delivery → delivered`, set by the seller (when allowed) or the admin.
7. **Order completion and earnings** (`fn_post_earnings`, when the shipment is delivered):
   - `earning` = the seller's items total. The coupon is deducted unless it was a platform-funded (commission) coupon.
   - `commission` = −the platform commission for that shipment.
   - **Both are *pending*** for the hold period of the seller's level (14 days by default). Then `fn_release_earnings` moves the **net** (earning − commission) to *available* (daily job, 03:40).
   - Withdrawals (`fn_request_withdrawal`) can only take from *available*, above the minimum, with one pending withdrawal at a time.
8. **Wallet.** `/vendor/wallet` shows available and pending balances and every entry, with its type, reason, order link and details:
   - earning, commission, pickup fee, return clawback, penalty;
   - packaging balance and packaging refund;
   - withdrawal, adjustment.
9. **Returns** (when the admin approves a return of this seller's products):
   - **Not the seller's fault** (change of mind, defect, shipping): the seller gives back their net for exactly the returned units (`refund_clawback`), and the platform returns its commission for them.
     - Example: 1 of 2 shirts returned. The buyer gets 92.50 EGP, the seller gives back 87.50 EGP, and the platform gives back 5 EGP of commission.
   - **Seller's fault:** the seller bears the whole refund. The extra over their net is recorded as a `refund_fault` penalty, which can be waived. If the setting is on, the seller also pays the **return pickup fee** for those units, under the same billing method.
   - **Stock** comes back exactly by the returned quantity when the goods are received, if "back to stock" is ticked.
   - **The original pickup fee is not reversed by a return:** the pickup really happened.
10. **Packaging purchases** (`/vendor/packaging`): see §4.

---

## 3. Administrator perspective

1. **Monitoring orders.** Use `/admin/orders`. Each order page shows:
   - each seller's shipment and its status;
   - the status history and notes;
   - the financial summary;
   - the print centre: admin invoice A4, carrier label A5 with barcode, seller labels.
2. **Managing sellers and shipments.**
   - **Sellers:** store approval requires the signed agreement and verification documents. Store changes go through review, and stores can be suspended.
   - **Shipments:** change each shipment's status, and approve or reject seller-shipping requests (`/admin/shipping`).
   - **Cancelling one shipment** restores its stock; the other shipments continue.
3. **Pickup operations and fees.**
   - **Rates:** set the per-area rate in `/admin/zones`.
   - **Billing method:** choose per shipment or per product in `/admin/settings/sections` → Pickup fees, along with whether sellers pay the return pickup on seller-fault returns.
   - **Records:** every charge is in `pickup_charges` and in the seller's ledger.
4. **Returns and partial refunds** (order page → "Returns & refunds" → **Start a return**):
   1. Tick **only the products coming back** and pick **how many units** of each. Lines from undelivered shipments are blocked (cancel the shipment instead), and so are units already returned.
   2. For each line, set the reason, who is at fault, and "back to stock". The refund prefills with what the buyer paid for those units and **can only be lowered**.
   3. For the order, set the shipping refund (up to what the order paid, minus earlier shipping refunds), the return-shipping deduction, and where the goods are: still with the buyer, already received (restock now), or nothing comes back.
   4. **Create.** The server recomputes and caps everything, adjusts each seller's wallet, records penalties and return pickup fees, and notifies the buyer and sellers (`fn_admin_create_return`).
   5. **Goods received.** Restocks, once (`fn_admin_return_received`).
   6. **Issue refund.** Record the method (original card, bank transfer, mobile wallet, cash, other) and the transaction reference. This happens once, and the order's payment status updates (`fn_admin_execute_refund`).

   Buyer-requested returns are decided in `/admin/refunds` by the same engine, with the same caps and the same settlement. Every step is in the return's history (`refund_events`) and in the audit log.
5. **Packaging inventory and orders.** Manage the catalog in `/admin/packaging` and operations in `/admin/packaging/orders` (§4).
6. **Invoices and shipping labels.**
   - **Customer orders:** the print centre.
   - **Packaging:** invoice A4, shipping label A5 (barcode) and return label A5 for each packaging return, from the packaging order page. Each print is audited.
7. **Seller wallets and financial transactions.**
   - The seller profile shows the wallet.
   - Manual adjustments (`fn_admin_adjust_wallet`) require a reason and are audited.
   - Withdrawal review is in `/admin/withdrawals`, penalties in `/admin/penalties`, and earnings release in `fn_release_earnings`.
   - The packaging *Balances* tab lists every 50% balance and the order it was collected with.

---

## 4. Packaging — the full loop

**Catalog** (admin, `/admin/packaging`):
- **Per item:** name (Arabic and English), SKU, category, spec, image, price per piece or per roll, optional price per metre for rolls, roll length, minimum and maximum per order, visibility.
- **Stock:** kept in base units: pieces, or **metres** for rolls. Buying a roll uses its length, and buying by the metre uses metres from the same stock.
- **Deleting:** an item that was ever ordered is archived instead of deleted.
- **Imported list:** 5 envelopes and 9 bubble-wrap rolls from the price sheet, with roll and metre prices. Stock starts at 0.

**Buying** (seller, `/vendor/packaging` → `fn_vendor_place_packaging_order`):
- **Who can buy:** the store must be active, not suspended.
- **Server checks:** prices, units, limits and stock are all re-checked on the server, and stock is reserved.
- **Shipping fee:** the normal fee of the seller's governorate.
- **Order numbers:** `PKG-YY000001`. Each checkout has an idempotency key, so a double click creates one order.

| Plan | Payment | What happens |
|---|---|---|
| **Full** | Card | `pending_payment`. Kashier hosted page. The webhook confirms (`fn_confirm_packaging_payment`), and the order becomes `confirmed` / `paid`. |
| **Full** | Cash on delivery | `confirmed` / `cod_pending` straight away. Marking it delivered records the cash and makes it `paid`. |
| **50% now** | Card only | Pay 50% (rounded up). The order becomes `confirmed` / `deposit_paid`, and an **open balance** for the other 50% is linked to the seller's account (`packaging_balances`, one per order). |

**Collecting the 50% balance:**
- **When:** at the seller's **first customer shipment delivered after the deposit**, `fn_post_earnings` calls `fn_collect_packaging_balances`.
- **Ledger:** a `packaging_balance` wallet debit, linked to that delivered order and shipment and to the packaging order.
- **Status updates:** the balance becomes `collected`, a "balance from wallet" payment is recorded, and the packaging order becomes `paid`. The seller is notified.
- **Never twice:** a row lock on the balance, the status check, and the unique ledger reference `pkgbal:<balance>`. Two deliveries at the same moment collect it once; the test confirmed the second delivery collected nothing.
- **Credit limit:** a seller can have at most *N* open balances (setting, default 1). A new 50% purchase is refused until the open one is collected.
- **Not enough in the wallet:** the debit can take *available* below zero, and the next earnings cover it. The wallet page explains the negative balance by its cause.

**Payment failures and retries:**
- Every attempt is a `packaging_payments` row, failures included, with the reason (declined, wrong amount).
- A failed card payment leaves the order `pending_payment`, and the seller presses **Try paying again**.
- A webhook retry is a no-op.
- A charge for an order that no longer awaits payment is recorded as an **overpayment** to refund, never applied twice.
- The admin can **record a payment** received outside the gateway, such as a bank transfer, with a reference. It confirms the order the same way.
- The seller can cancel an unpaid order, and the stock comes back.

**Fulfilment** (admin, `/admin/packaging/orders/:number`):
- Steps: start preparing → mark shipped (carrier and tracking number) → mark delivered.
- **Cancel** needs a reason:
  - the stock comes back and the open balance is cancelled;
  - what was paid is refunded to the seller's wallet or recorded against the original payment;
  - a balance already collected from the wallet always goes back to the wallet.

**Returns:**
- The seller requests a return within the window (14 days), or the admin creates one.
- Steps: approve (amount capped at the returned items' value) → items received (restock) → refund.
- **The open balance is reduced first**, so the seller never pays for what came back. The remainder goes to the wallet (`packaging_refund`) or is recorded against the original payment.
- A return label prints for each return.

**Operations page** (`/admin/packaging/orders`):
- **Counters:** awaiting payment, to prepare or ship, open returns, outstanding balances.
- **Tabs:** orders by status, returns, every payment attempt, and balances with where each was collected.

---

## 5. Cross-cutting guarantees

- **Atomic:** every money flow is a single database function, all-or-nothing, with row locks on the order, shipment, return or balance it changes.
- **No duplicates:** the unique ledger reference on (seller, type, reference), and unique pickup charges per shipment and per return, make retries harmless. So do the webhook references `(provider, ref)` and the idempotency keys on orders and packaging orders.
- **Server-side authorization:**
  - Users cannot call any ledger, posting or balance function; only the database flows can.
  - Admin actions check the admin role inside the function.
  - Sellers read only their own rows (RLS).
- **Audit:** every decision, payment, refund, print, publish and acceptance writes `audit_logs`. Returns and packaging orders also keep their own step-by-step history.

## 6. Gaps and decisions to confirm

1. **Seller agreement file.** No contract file was among the uploads; only the two Terms files and the price sheet. The seller agreement currently in force is the short in-app text, as version 1.0. Publish the real contract from `/admin/legal`: sellers will be asked to sign it, and their earlier signatures stay on record.
2. **Terms placeholders.** The Terms' last section still says the company legal name, commercial register, address, tax details, and support email and phone are "to be completed before publishing".
3. **Price sheet differences between the two language tabs.** Resolved: the extra-large envelope holds up to 12 kg (SKU `ENV-XL-12`, migration `20261104000021`).
4. **Packaging stock** starts at 0. Enter real stock in `/admin/packaging`.
5. **Card payments need the Kashier keys in `.env`.** Without them, card checkout is unavailable to buyers. Packaging card orders can still be placed, but wait until the admin records the payment.
6. **"Per product" means product units.** One line of 3 identical items counts as 3. If you meant distinct products (lines), it is a one-line change in `fn_post_pickup_fee`.
7. **Refunds to buyers are recorded, not executed.** Card refunds through Kashier's refund API are not automated; the admin issues them in Kashier and records the reference.
