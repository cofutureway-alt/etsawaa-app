/**
 * Every message the site can send, grouped by who receives it. One source
 * for the admin "Messages and notifications" page, the notify worker and
 * the default SMS / WhatsApp wording. Email wording lives in the email
 * templates (`emailTemplate`); a missing template means no email channel.
 */

export type Audience = "customer" | "vendor" | "staff" | "admin" | "account";
export type Channel = "email" | "sms" | "whatsapp";

export interface MessageEvent {
  key: string;
  audience: Exclude<Audience, "staff">;
  group: string;
  name_ar: string;
  name_en: string;
  /** email template key, when this event has an email */
  emailTemplate?: string;
  /** team alerts: the permission a staff member needs to receive it */
  staffPermission?: string;
  /** channels on before the owner changes anything */
  defaults?: Partial<Record<Channel, boolean>>;
  /** variables the SMS / WhatsApp text may use */
  variables: string[];
  text: { ar: string; en: string };
}

const EVENT_VARS = ["title", "body", "link", "name"];
const ev = (
  key: string, audience: MessageEvent["audience"], group: string, ar: string, en: string,
  extra: Partial<MessageEvent> = {},
): MessageEvent => ({
  key, audience, group, name_ar: ar, name_en: en,
  emailTemplate: `event:${key}`,
  variables: EVENT_VARS,
  text: { ar: "إتسوء: {{title}}\n{{link}}", en: "Etsawaa: {{title}}\n{{link}}" },
  ...extra,
});

export const MESSAGE_EVENTS: MessageEvent[] = [
  // ── customers
  { key: "order_confirmation", audience: "customer", group: "orders", name_ar: "تأكيد الطلب", name_en: "Order confirmation",
    emailTemplate: "order_confirmation", defaults: { email: true, sms: true, whatsapp: true },
    variables: ["customer_name", "order_number", "order_total", "payment_method", "order_url"],
    text: {
      ar: "إتسوء: استلمنا طلبك رقم {{order_number}} بإجمالي {{order_total}}. تابعه من: {{order_url}}",
      en: "Etsawaa: we received your order {{order_number}} ({{order_total}}). Follow it: {{order_url}}",
    } },
  ev("order_shipped", "customer", "orders", "تم شحن الطلب", "Order shipped", { emailTemplate: "event:order_shipped" }),
  ev("order_delivered", "customer", "orders", "توصيل الطلب", "Order delivered"),
  ev("order_completed", "customer", "orders", "اكتمال الطلب", "Order completed"),
  ev("order_cancelled", "customer", "orders", "إلغاء الطلب", "Order cancelled"),
  ev("payment_success", "customer", "payments", "تأكيد الدفع", "Payment confirmed"),
  ev("payment_failed", "customer", "payments", "الدفع لم يكتمل", "Payment unsuccessful"),
  ev("refund_submitted", "customer", "refunds", "استلام طلب الاسترجاع", "Return request received"),
  ev("refund_decided", "customer", "refunds", "قرار طلب الاسترجاع", "Return request decision"),
  ev("refund_executed", "customer", "refunds", "تنفيذ الاسترجاع المالي", "Refund processed"),
  ev("wallet_credited", "customer", "money", "إضافة رصيد إلى المحفظة", "Wallet balance credited"),
  ev("wallet_debited_admin", "customer", "money", "خصم رصيد من المحفظة", "Wallet balance deducted"),
  ev("wallet_gift", "customer", "money", "هدية في المحفظة", "Gift added to the wallet"),
  ev("wallet_gift_expiring", "customer", "money", "هدية تقترب من الانتهاء", "Gift balance is expiring"),

  // ── sellers
  ev("vendor.new_order", "vendor", "orders", "طلب جديد للمتجر", "New order for the store", { defaults: { email: true, whatsapp: true } }),
  ev("refund_settled_vendor", "vendor", "orders", "تسوية استرجاع", "Refund settlement"),
  ev("product.approved", "vendor", "products", "قبول المنتج", "Product approved"),
  ev("product.rejected", "vendor", "products", "رفض المنتج أو طلب تعديله", "Product rejected or returned"),
  ev("product.admin_edited", "vendor", "products", "الإدارة عدّلت منتجًا", "Product edited by the team"),
  ev("brand.approved", "vendor", "products", "قبول البراند المقترح", "Proposed brand accepted"),
  ev("brand.rejected", "vendor", "products", "رفض البراند المقترح", "Proposed brand declined"),
  ev("vendor.approved", "vendor", "store", "تفعيل المتجر", "Store approved"),
  ev("vendor.rejected", "vendor", "store", "رفض طلب المتجر", "Store application declined"),
  ev("vendor.suspended", "vendor", "store", "إيقاف المتجر", "Store suspended"),
  ev("vendor.reinstated", "vendor", "store", "إعادة تفعيل المتجر", "Store reactivated"),
  ev("vendor.change_approved", "vendor", "store", "قبول تعديل بيانات المتجر", "Store changes approved"),
  ev("vendor.change_rejected", "vendor", "store", "رفض تعديل بيانات المتجر", "Store changes declined"),
  ev("store_visibility", "vendor", "store", "تغيّر ظهور المتجر", "Store visibility changed"),
  ev("verification.approved", "vendor", "verification", "قبول التوثيق", "Verification approved"),
  ev("verification.rejected", "vendor", "verification", "رفض التوثيق", "Verification declined"),
  ev("verification.needs_changes", "vendor", "verification", "التوثيق يحتاج استكمالًا", "Verification needs changes"),
  ev("verification.document_rejected", "vendor", "verification", "رفض مستند التوثيق", "Verification document declined"),
  ev("verification.grace_expired", "vendor", "verification", "انتهاء مهلة التوثيق", "Verification deadline passed"),
  ev("level", "vendor", "growth", "تغيّر مستوى المتجر", "Store level changed"),
  ev("badge", "vendor", "growth", "شارة جديدة", "New badge"),
  ev("penalty", "vendor", "money", "إجراء مالي على المتجر", "Store penalty"),
  ev("vendor_shipping_decision", "vendor", "money", "قرار الشحن الذاتي", "Self-shipping decision"),
  ev("packaging_paid", "vendor", "packaging", "تأكيد دفع التغليف", "Packaging payment confirmed"),
  ev("packaging_status", "vendor", "packaging", "تحديث طلب التغليف", "Packaging order update"),
  ev("packaging_return", "vendor", "packaging", "مرتجع التغليف", "Packaging return"),
  ev("packaging_balance_collected", "vendor", "packaging", "تحصيل رصيد التغليف", "Packaging balance collected"),
  ev("ad_order_approved", "vendor", "ads", "قبول طلب الإعلان", "Ad order approved"),
  ev("ad_order_rejected", "vendor", "ads", "رفض طلب الإعلان", "Ad order declined"),
  ev("ad_order_paid", "vendor", "ads", "تأكيد دفع الإعلان", "Ad payment confirmed"),

  // ── team alerts (admins always; staff by permission, from the staff tab)
  ev("product.pending", "admin", "review", "منتج ينتظر المراجعة", "Product awaiting review", { staffPermission: "products.review" }),
  ev("brand.proposed", "admin", "review", "براند مقترح جديد", "New brand proposal", { staffPermission: "catalog.brands" }),
  ev("vendor.submitted", "admin", "review", "طلب متجر جديد", "New store application", { staffPermission: "vendors.review" }),
  ev("vendor.change_request", "admin", "review", "طلب تعديل بيانات متجر", "Store change request", { staffPermission: "store_changes.review" }),
  ev("vendor.grace_expired", "admin", "review", "انتهاء مهلة توثيق متجر", "Store verification deadline passed", { staffPermission: "vendors.verify" }),
  ev("refund_submitted_admin", "admin", "operations", "طلب استرجاع جديد", "New return request", { staffPermission: "refunds.manage" }),
  ev("vendor_shipping_request", "admin", "operations", "طلب شحن ذاتي", "Self-shipping request", { staffPermission: "shipping.manage" }),
  ev("packaging_order_admin", "admin", "operations", "طلب تغليف جديد", "New packaging order", { staffPermission: "packaging.manage" }),
  ev("ad_order_review", "admin", "operations", "طلب إعلان ينتظر المراجعة", "Ad order awaiting review", { staffPermission: "ads.manage" }),
  ev("service_order", "admin", "operations", "طلب خدمة جديد", "New service order", { staffPermission: "services.manage" }),
  { key: "messaging.low_balance", audience: "admin", group: "operations", name_ar: "رصيد الرسائل قليل", name_en: "Message balance is low",
    defaults: { email: true }, emailTemplate: "event:messaging.low_balance", variables: EVENT_VARS,
    text: { ar: "إتسوء: {{title}}", en: "Etsawaa: {{title}}" } },

  // ── account codes (SMS / WhatsApp only)
  { key: "otp.verify", audience: "account", group: "codes", name_ar: "رمز تأكيد رقم الهاتف", name_en: "Phone verification code",
    emailTemplate: undefined, defaults: { sms: true, whatsapp: true }, variables: ["code"],
    text: { ar: "رمز التأكيد من إتسوء: {{code}}\nلا تشاركه مع أحد.", en: "Your Etsawaa code: {{code}}. Do not share it." } },
  { key: "otp.checkout", audience: "account", group: "codes", name_ar: "رمز تأكيد الهاتف عند الطلب", name_en: "Checkout phone code",
    emailTemplate: undefined, defaults: { sms: true, whatsapp: true }, variables: ["code"],
    text: { ar: "رمز تأكيد طلبك من إتسوء: {{code}}\nلا تشاركه مع أحد.", en: "Your Etsawaa order code: {{code}}. Do not share it." } },
  { key: "otp.reset", audience: "account", group: "codes", name_ar: "رمز استرجاع كلمة المرور", name_en: "Password reset code",
    emailTemplate: undefined, defaults: { sms: true, whatsapp: true }, variables: ["code"],
    text: { ar: "رمز استرجاع كلمة المرور من إتسوء: {{code}}\nلا تشاركه مع أحد.", en: "Your Etsawaa reset code: {{code}}. Do not share it." } },
];

export const MESSAGE_EVENT_MAP = new Map(MESSAGE_EVENTS.map((e) => [e.key, e]));

export const GROUP_LABELS: Record<string, { ar: string; en: string }> = {
  orders: { ar: "الطلبات", en: "Orders" },
  payments: { ar: "الدفع", en: "Payments" },
  refunds: { ar: "الاسترجاع", en: "Returns" },
  products: { ar: "المنتجات", en: "Products" },
  store: { ar: "المتجر", en: "Store" },
  verification: { ar: "التوثيق", en: "Verification" },
  growth: { ar: "المستوى والشارات", en: "Levels and badges" },
  money: { ar: "الرصيد والشحن", en: "Balance and shipping" },
  packaging: { ar: "التغليف", en: "Packaging" },
  ads: { ar: "الإعلانات", en: "Ads" },
  review: { ar: "المراجعة", en: "Reviews" },
  operations: { ar: "التشغيل", en: "Operations" },
  codes: { ar: "رموز التأكيد", en: "Codes" },
};

/** Events shown in one audience tab. Staff sees the team alerts that name a permission. */
export function eventsFor(audience: Audience): MessageEvent[] {
  if (audience === "staff") return MESSAGE_EVENTS.filter((e) => e.audience === "admin" && e.staffPermission);
  return MESSAGE_EVENTS.filter((e) => e.audience === audience);
}

/** Which tab a notification row belongs to. */
export function audienceOf(type: string, recipientRole: string | null | undefined, fanout: boolean): Audience {
  if (fanout) return "staff";
  const known = MESSAGE_EVENT_MAP.get(type);
  if (known) return known.audience;
  if (recipientRole === "admin") return "admin";
  if (recipientRole === "customer") return "customer";
  return "vendor";
}

export interface RouteRow {
  event_key: string;
  audience: Audience;
  enabled: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  wa_sender_id: string | null;
}

/** The route in force: the saved row, or the event's defaults (email follows its template switch). */
export function effectiveRoute(event: MessageEvent | undefined, audience: Audience, saved: RouteRow | undefined, emailTemplateActive: boolean | undefined): RouteRow {
  if (saved) return saved;
  const d = event?.defaults ?? {};
  const hasEmail = Boolean(event?.emailTemplate);
  return {
    event_key: event?.key ?? "",
    audience,
    // staff copies start off: the owner chooses who on the team gets what
    enabled: audience !== "staff",
    email: hasEmail && (d.email ?? (emailTemplateActive ?? audience !== "staff")),
    sms: d.sms ?? false,
    whatsapp: d.whatsapp ?? false,
    wa_sender_id: null,
  };
}
