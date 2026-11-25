import type { EmailContent, EmailTranslation } from "./content";

export interface EmailDefinition { key: string; name_ar: string; name_en: string; audience: "customer" | "vendor" | "admin" | "all"; variables: string[]; content: EmailTranslation }
const c = (subject: string, heading: string, body: string, extra: Partial<EmailContent> = {}): EmailContent => ({ subject, preheader: heading, heading, body, details: [], buttonLabel: "", buttonUrl: "", note: "", code: "", ...extra });
const orderVars = ["customer_name", "order_number", "order_total", "payment_method", "order_url", "track_url", "retry_url", "review_url", "reason", "review_days", "return_days"];
const orderDetails = {
  ar: [{ label: "رقم الطلب", value: "{{order_number}}" }, { label: "الإجمالي", value: "{{order_total}}" }, { label: "طريقة الدفع", value: "{{payment_method}}" }],
  en: [{ label: "Order number", value: "{{order_number}}" }, { label: "Total", value: "{{order_total}}" }, { label: "Payment method", value: "{{payment_method}}" }],
};
const order = (key: string, nameAr: string, nameEn: string, ar: EmailContent, en: EmailContent): EmailDefinition => ({ key, name_ar: nameAr, name_en: nameEn, audience: "customer", variables: orderVars, content: { ar: { ...ar, details: orderDetails.ar }, en: { ...en, details: orderDetails.en } } });
const events: Array<[string, "customer" | "vendor" | "admin", string, string, string, string]> = [
  ["badge", "vendor", "شارة جديدة تستحقها", "A new badge for your store", "خطوة جديدة تستحق التقدير. شاهد الشارة التي حصل عليها متجرك وتفاصيلها.", "Another milestone for your store. Take a look at your new badge and what it means."],
  ["level", "vendor", "تحديث مستوى متجرك", "Your store level has changed", "تابع مستوى متجرك وتفاصيل التحديث من لوحة البائع.", "See your store’s current level and the details of this update in your seller dashboard."],
  ["order_cancelled", "customer", "تحديث بشأن إلغاء طلبك", "An update on your cancelled order", "راجع تفاصيل الإلغاء، وتواصل معنا إذا احتجت مساعدة في الخطوة التالية.", "Review the cancellation details. If you need help with your next step, our team is here."],
  ["order_completed", "customer", "اكتمل طلبك", "Your order is complete", "شكرًا لاختيارك إتسوء. تفاصيل طلبك محفوظة في حسابك متى احتجت إليها.", "Thank you for choosing Etsawaa. Your order details are available in your account whenever you need them."],
  ["order_delivered", "customer", "طلبك وصل", "Your order has arrived", "نتمنى أن يكون اختيارك على قدر توقعاتك. يمكنك مراجعة الطلب أو التواصل معنا من حسابك.", "We hope you enjoy your order. You can review its details or reach our team from your account."],
  ["payment_failed", "customer", "الدفع لم يكتمل", "Your payment didn’t complete", "راجع حالة الدفع وتفاصيل الطلب قبل إعادة المحاولة، خاصة إذا ظهر خصم في حسابك.", "Check your payment and order status before trying again, especially if a charge appears on your account."],
  ["payment_success", "customer", "تم تأكيد الدفع", "Your payment is confirmed", "يمكنك مراجعة حالة الدفع وتفاصيل العملية من حسابك.", "Your payment update is ready. View the transaction details in your account."],
  ["refund_submitted", "customer", "استلمنا طلب الاسترجاع", "We received your return request", "طلبك وصل للفريق. تابع حالته وأي تحديثات مطلوبة من صفحة التفاصيل.", "Your request is with our team. Follow its status and any required next steps on the details page."],
  ["refund_decided", "customer", "تحديث مهم لطلب الاسترجاع", "An update on your return request", "راجع القرار وتفاصيله لمعرفة الخطوة التالية الخاصة بطلبك.", "Review the decision and its details to see the next step for your request."],
  ["exchange_approved", "customer", "تمت الموافقة على الاستبدال", "Your exchange was approved", "أنشأنا طلب الاستبدال. افتح الطلب لمعرفة المبلغ المتبقي إن وجد وطريقة دفعه.", "We created your exchange order. Open it to see any amount left to pay and how to pay it."],
  ["refund_executed", "customer", "تم تنفيذ الاسترجاع المالي", "Your refund has been processed", "تفاصيل الاسترجاع المالي متاحة في حسابك. ظهور المبلغ يخضع لطريقة الدفع والجهة المستقبلة.", "Your refund details are available in your account. When the funds appear depends on the payment method and receiving provider."],
  ["wallet_credited", "customer", "أضيف رصيد إلى محفظتك", "Money added to your wallet", "راجع رصيد محفظتك من حسابك واستخدمه عند الشراء.", "Review your wallet balance in your account and use it at checkout."],
  ["wallet_debited_admin", "customer", "تحديث رصيد محفظتك", "Your wallet balance changed", "راجع تفاصيل الرصيد والسبب من صفحة المحفظة.", "Review the balance details and the reason on your wallet page."],
  ["wallet_gift", "customer", "هدية في محفظتك", "A gift for your wallet", "أضافت الإدارة هدية إلى رصيدك. راجع تاريخ انتهائها من صفحة المحفظة.", "The team added a gift to your balance. Check its expiry date on your wallet page."],
  ["wallet_gift_expiring", "customer", "هديتك تقترب من الانتهاء", "Your gift balance expires soon", "استخدم رصيد الهدية قبل تاريخ الانتهاء من حسابك.", "Use your gift balance before its expiry date from your account."],
  ["refund_submitted_admin", "admin", "طلب استرجاع يحتاج مراجعة", "A return request needs review", "افتح الطلب لمراجعة التفاصيل والمرفقات واتخاذ الإجراء المناسب.", "Open the request to review its details and attachments, then take the appropriate action."],
  ["refund_settled_vendor", "vendor", "تحديث تسوية استرجاع", "A refund settlement update", "راجع أثر التسوية على الطلب ورصيد متجرك من لوحة البائع.", "Review how this settlement affects the order and your store balance in your dashboard."],
  ["penalty", "vendor", "تحديث مالي يخص متجرك", "A financial update for your store", "راجع سبب الإجراء وتفاصيله، وتواصل مع الدعم إذا احتجت توضيحًا.", "Review the reason and details of this action. Contact support if you need clarification."],
  ["store_visibility", "vendor", "تحديث ظهور متجرك", "Your store visibility has changed", "راجع حالة ظهور متجرك وأي خطوات مطلوبة من لوحة البائع.", "Check your store’s visibility status and any required next steps in your dashboard."],
  ["product.approved", "vendor", "منتجك جاهز للظهور", "Your product has been approved", "خطوة جديدة لمنتجك على إتسوء. افتح لوحة المنتجات لمراجعة حالته وتفاصيله.", "A new step for your product on Etsawaa. Open your products dashboard to review its status and details."],
  ["product.pending", "admin", "منتج جديد ينتظر المراجعة", "A product is ready for review", "راجع بيانات المنتج وصوره قبل اتخاذ قرار النشر.", "Review the product information and images before making a publishing decision."],
  ["product.rejected", "vendor", "تحديث مراجعة منتجك", "An update on your product review", "راجع نتيجة المراجعة والأسباب الموضحة لمعرفة ما يمكن عمله بعد ذلك.", "Review the outcome and the reasons provided to see what you can do next."],
  ["vendor.submitted", "admin", "متجر جديد ينتظر المراجعة", "A store application needs review", "راجع بيانات المتجر والمستندات المتاحة قبل اتخاذ القرار.", "Review the store information and available documents before making a decision."],
  ["vendor.approved", "vendor", "متجرك اتفعل على إتسوء", "Your store is active on Etsawaa", "مرحبًا بمتجرك. افتح لوحة البائع لمراجعة بياناته وتجهيز خطوات البيع التالية.", "Welcome aboard. Open your seller dashboard to review your store and prepare your next selling steps."],
  ["vendor.rejected", "vendor", "تحديث طلب الانضمام كبائع", "An update on your seller application", "راجع قرار المراجعة والأسباب الموضحة في طلب متجرك.", "Review the decision and the reasons provided in your store application."],
  ["vendor.suspended", "vendor", "تنبيه مهم بشأن حالة متجرك", "An important update about your store", "يرجى مراجعة سبب الإيقاف وأي خطوات متاحة لمعالجة الحالة.", "Please review the suspension reason and the available steps to address it."],
  ["vendor.reinstated", "vendor", "تمت إعادة تفعيل متجرك", "Your store has been reactivated", "يمكنك العودة إلى لوحة البائع ومراجعة حالة المتجر والمنتجات.", "You can return to your seller dashboard to review your store and products."],
  ["vendor.grace_expired", "admin", "انتهت مهلة توثيق متجر", "A store verification deadline has passed", "راجع ملف المتجر وحالة المستندات قبل متابعة الإجراء.", "Review the store profile and document status before taking further action."],
  ["vendor.change_request", "admin", "تعديل بيانات متجر يحتاج مراجعة", "A store change needs review", "راجع التعديلات المطلوبة وقارنها ببيانات المتجر الحالية.", "Review the requested changes against the store’s current information."],
  ["vendor.change_approved", "vendor", "تمت الموافقة على تعديل متجرك", "Your store changes were approved", "راجع بيانات متجرك بعد التحديث للتأكد من ظهورها بالشكل المطلوب.", "Review your updated store information to make sure everything looks right."],
  ["vendor.change_rejected", "vendor", "تحديث طلب تعديل بيانات متجرك", "An update on your store changes", "راجع سبب القرار قبل تقديم أي تعديل جديد.", "Review the reason for the decision before submitting further changes."],
  ["verification.approved", "vendor", "تم قبول توثيق متجرك", "Your store verification was approved", "شكرًا لاستكمال بياناتك. يمكنك مراجعة حالة التوثيق من لوحة البائع.", "Thank you for completing your details. View your verification status in your seller dashboard."],
  ["verification.rejected", "vendor", "تحديث مراجعة التوثيق", "An update on your verification review", "راجع نتيجة التوثيق والأسباب الموضحة لمعرفة الخطوة التالية.", "Review the verification outcome and the reasons provided to see your next step."],
  ["verification.needs_changes", "vendor", "توثيق متجرك يحتاج استكمالًا", "Your verification needs an update", "راجع المطلوب بعناية، ثم حدّث البيانات أو المستندات المحددة.", "Review the requested changes, then update the relevant information or documents."],
  ["verification.document_rejected", "vendor", "مستند التوثيق يحتاج مراجعتك", "A verification document needs your attention", "راجع ملاحظة الفريق على المستند قبل رفع بديل مناسب.", "Read the team’s feedback on your document before uploading a suitable replacement."],
  ["verification.grace_expired", "vendor", "انتهت مهلة استكمال التوثيق", "Your verification deadline has passed", "راجع حالة متجرك والمتطلبات المتبقية من صفحة التوثيق.", "Check your store status and remaining requirements on the verification page."],
  ["vendor_shipping_request", "admin", "طلب شحن ذاتي يحتاج مراجعة", "A seller shipping request needs review", "راجع الطلب وبيانات البائع قبل اتخاذ القرار.", "Review the request and seller information before making a decision."],
  ["vendor_shipping_decision", "vendor", "تحديث طلب الشحن الذاتي", "An update on your shipping request", "راجع نتيجة الطلب وما تعنيه لإعدادات شحن متجرك.", "Review the outcome and what it means for your store’s shipping settings."],
  ["packaging_order_admin", "admin", "طلب تغليف جديد", "A new packaging order", "راجع الأصناف والكميات وحالة الدفع لمتابعة تجهيز الطلب.", "Review the items, quantities and payment status to follow up on fulfilment."],
  ["packaging_paid", "vendor", "تم تأكيد دفع طلب التغليف", "Your packaging payment is confirmed", "تفاصيل الدفع والطلب متاحة في لوحة البائع.", "Your payment and order details are available in your seller dashboard."],
  ["packaging_status", "vendor", "تحديث طلب التغليف", "Your packaging order has an update", "تابع حالة الطلب وتفاصيل المرحلة الحالية من لوحة البائع.", "Follow your order status and the current stage in your seller dashboard."],
  ["packaging_return", "vendor", "تحديث مرتجع التغليف", "An update on your packaging return", "راجع تفاصيل المرتجع وأي أثر على رصيد متجرك.", "Review the return details and any effect on your store balance."],
  ["packaging_balance_collected", "vendor", "تم تحديث رصيد التغليف", "Your packaging balance has an update", "راجع تفاصيل التحصيل والرصيد من لوحة البائع.", "Review the collection details and balance in your seller dashboard."],
  ["order_shipped", "customer", "طلبك في الطريق إليك", "Your order is on its way", "تابع حالة الشحن من صفحة الطلب.", "Follow your delivery from the order page."],
  ["vendor.new_order", "vendor", "طلب جديد لمتجرك", "A new order for your store", "افتح صفحة الطلبات لتجهيز الطلب في أسرع وقت.", "Open your orders page to prepare the order as soon as you can."],
  ["product.admin_edited", "vendor", "الإدارة عدّلت أحد منتجاتك", "Our team edited one of your products", "راجع التعديل وسببه من صفحة تعديل المنتج.", "Review the change and its reason on the product edit page."],
  ["brand.approved", "vendor", "تم قبول البراند الذي اقترحته", "The brand you proposed was accepted", "البراند أصبح متاحًا لمنتجاتك.", "The brand is now available for your products."],
  ["brand.rejected", "vendor", "لم يتم قبول البراند الذي اقترحته", "The brand you proposed was declined", "راجع السبب والبراند البديل من صفحة المنتج.", "Review the reason and the replacement on the product page."],
  ["brand.proposed", "admin", "براند مقترح ينتظر المراجعة", "A proposed brand needs review", "راجع البراند المقترح قبل قبوله أو رفضه.", "Review the proposed brand before accepting or declining it."],
  ["ad_order_review", "admin", "طلب إعلان ينتظر المراجعة", "An ad order needs review", "راجع تفاصيل الإعلان والدفع قبل اتخاذ القرار.", "Review the ad details and payment before deciding."],
  ["ad_order_approved", "vendor", "تم قبول طلب الإعلان", "Your ad order was approved", "تابع حالة إعلانك من لوحة البائع.", "Follow your ad from your seller dashboard."],
  ["ad_order_rejected", "vendor", "لم يتم قبول طلب الإعلان", "Your ad order was declined", "راجع سبب القرار من لوحة البائع.", "Review the reason in your seller dashboard."],
  ["ad_order_paid", "vendor", "تم تأكيد دفع الإعلان", "Your ad payment is confirmed", "تفاصيل الدفع متاحة في لوحة البائع.", "The payment details are in your seller dashboard."],
  ["service_order", "admin", "طلب خدمة جديد", "A new service order", "راجع الطلب وتفاصيله لمتابعة التنفيذ.", "Review the order and its details to follow up."],
  ["messaging.low_balance", "admin", "رصيد الرسائل قليل", "Your message balance is low", "اشحن رصيد Rasvio حتى لا تتوقف رسائل SMS.", "Top up your Rasvio balance so SMS keeps sending."],
];

export const EMAIL_CATALOG: EmailDefinition[] = [
  { key: "welcome", name_ar: "الترحيب بعد تأكيد الحساب", name_en: "Welcome after verification", audience: "customer", variables: ["name", "site_name", "site_url"], content: {
    ar: c("أهلًا {{name}}، اختيارك الجاي يبدأ من إتسوء", "أهلًا بك في إتسوء، {{name}}", "حسابك اتأكد وبقى جاهز. اكتشف المنتجات، قارن اختياراتك، واحتفظ بما يعجبك لوقت ما يناسبك.\n\nومن حسابك تقدر تتابع طلباتك وتتواصل معنا بسهولة.", { preheader: "حسابك جاهز. اكتشف اختياراتك وتابع كل طلب من مكان واحد.", buttonLabel: "اكتشف إتسوء", buttonUrl: "{{site_url}}" }),
    en: c("Welcome, {{name}}. Your next find starts here", "You’re in, {{name}}", "Your email is verified and your Etsawaa account is ready. Explore products, compare your options and save your favourites for later.\n\nYour account also keeps your orders and support just a click away.", { preheader: "Your account is ready. Discover your favourites and keep track of every order.", buttonLabel: "Explore Etsawaa", buttonUrl: "{{site_url}}" }),
  } },
  order("order_confirmation", "تأكيد الطلب", "Order confirmation",
    c("استلمنا طلبك {{order_number}} | إتسوء", "اختيارك وصلنا", "مرحبًا {{customer_name}}،\nاستلمنا طلبك على إتسوء. احتفظ برقم الطلب، وافتح صفحته لمراجعة التفاصيل ومتابعة حالته.", { preheader: "تفاصيل طلبك وخطوتك التالية في رسالة واحدة.", buttonLabel: "عرض تفاصيل الطلب", buttonUrl: "{{order_url}}" }),
    c("We received your order {{order_number}} | Etsawaa", "We’ve got your order", "Hi {{customer_name}},\nWe’ve received your Etsawaa order. Keep your order number handy and open the order page to review the details and follow its progress.", { preheader: "Your order details and next step, all in one place.", buttonLabel: "View your order", buttonUrl: "{{order_url}}" })),
  order("payment_success", "تأكيد الدفع", "Payment confirmed",
    c("تم تأكيد الدفع لطلبك {{order_number}}", "الدفع اتأكد بنجاح", "مرحبًا {{customer_name}}،\nتم تأكيد الدفع الخاص بطلبك. تقدر تراجع تفاصيل العملية وتتابع حالة الطلب من حسابك.", { buttonLabel: "متابعة الطلب", buttonUrl: "{{order_url}}" }),
    c("Payment confirmed for order {{order_number}}", "Your payment is confirmed", "Hi {{customer_name}},\nYour order payment is confirmed. View the details and follow your order’s progress from your account.", { buttonLabel: "View your order", buttonUrl: "{{order_url}}" })),
  order("payment_failed", "تعثر الدفع", "Payment unsuccessful",
    c("الدفع لم يكتمل لطلبك {{order_number}}", "خلّينا نساعدك تكمل طلبك", "مرحبًا {{customer_name}}،\nلم نتمكن من تأكيد الدفع لهذا الطلب. راجع حالته، ثم جرّب مجددًا إذا كان الدفع لا يزال مطلوبًا.", { buttonLabel: "مراجعة الدفع والمحاولة مجددًا", buttonUrl: "{{retry_url}}", note: "إذا ظهر خصم في حسابك، راجع حالة العملية وتواصل معنا قبل الدفع مرة أخرى." }),
    c("Payment didn’t complete for order {{order_number}}", "Let’s help you complete your order", "Hi {{customer_name}},\nWe couldn’t confirm payment for this order. Check its status, then try again if payment is still required.", { buttonLabel: "Review payment and try again", buttonUrl: "{{retry_url}}", note: "If a charge appears on your account, check the transaction status and contact us before paying again." })),
  order("order_shipped", "شحن الطلب", "Order shipped",
    c("طلبك {{order_number}} بدأ رحلة الوصول", "طلبك اتشحن", "مرحبًا {{customer_name}}،\nتم تحديث حالة طلبك إلى «تم الشحن». افتح صفحة التتبع لمتابعة آخر تحديث متاح.", { buttonLabel: "تتبع طلبي", buttonUrl: "{{track_url}}" }),
    c("Order {{order_number}} is on its way", "Your order has shipped", "Hi {{customer_name}},\nYour order is now marked as shipped. Open the tracking page for the latest available update.", { buttonLabel: "Track your order", buttonUrl: "{{track_url}}" })),
  order("order_delivered", "توصيل الطلب", "Order delivered",
    c("طلبك {{order_number}} وصل — نتمنى يعجبك اختيارك", "وصل اختيارك", "مرحبًا {{customer_name}}،\nطلبك مسجل الآن كطلب تم توصيله. نتمنى أن تستمتع باختيارك، ويسعدنا أن تشارك تجربتك من حسابك.", { buttonLabel: "عرض الطلب ومشاركة تجربتي", buttonUrl: "{{review_url}}", note: "إذا واجهت مشكلة، راجع خيارات المساعدة والاسترجاع المتاحة في تفاصيل الطلب." }),
    c("Order {{order_number}} has arrived. Enjoy your find", "Your order has arrived", "Hi {{customer_name}},\nYour order is now marked as delivered. We hope you enjoy your find, and we’d love to hear about your experience through your account.", { buttonLabel: "View order and share feedback", buttonUrl: "{{review_url}}", note: "If something needs attention, review the help and return options available in your order details." })),
  order("order_cancelled", "إلغاء الطلب", "Order cancelled",
    c("تم إلغاء الطلب {{order_number}}", "تحديث بشأن طلبك", "مرحبًا {{customer_name}}،\nتم إلغاء هذا الطلب. يمكنك مراجعة تفاصيل الإلغاء وأي تحديث متعلق بالدفع من صفحة الطلب.", { buttonLabel: "مراجعة تفاصيل الإلغاء", buttonUrl: "{{order_url}}", note: "سبب الإلغاء: {{reason}}" }),
    c("Order {{order_number}} has been cancelled", "An update on your order", "Hi {{customer_name}},\nThis order has been cancelled. Review the order page for cancellation details and any payment updates.", { buttonLabel: "Review cancellation details", buttonUrl: "{{order_url}}", note: "Cancellation reason: {{reason}}" })),
  { key: "contact_ack", name_ar: "تأكيد استلام التواصل", name_en: "Contact acknowledgement", audience: "all", variables: ["name", "subject", "site_name"], content: {
    ar: c("رسالتك وصلتنا، {{name}} | إتسوء", "سمعناك، وهنساعدك", "مرحبًا {{name}}،\nاستلمنا رسالتك بخصوص «{{subject}}». فريقنا هيراجع التفاصيل ويرد عليك على نفس البريد.\n\nشكرًا إنك تواصلت معنا.", { preheader: "رسالتك وصلت لفريق إتسوء، والرد هيكون على نفس البريد." }),
    en: c("We’ve got your message, {{name}} | Etsawaa", "We’re here to help", "Hi {{name}},\nWe’ve received your message about “{{subject}}”. Our team will review the details and reply to this email address.\n\nThank you for getting in touch.", { preheader: "Your message is with the Etsawaa team. We’ll reply to this email address." }),
  } },
  { key: "contact_received", name_ar: "رسالة تواصل للفريق", name_en: "Contact message for the team", audience: "admin", variables: ["kind", "subject", "name", "email", "phone", "message", "link"], content: {
    ar: c("رسالة تواصل جديدة: {{subject}}", "رسالة تحتاج اهتمام الفريق", "{{message}}", { details: [{ label: "الاسم", value: "{{name}}" }, { label: "البريد", value: "{{email}}" }, { label: "الهاتف", value: "{{phone}}" }, { label: "نوع التواصل", value: "{{kind}}" }], buttonLabel: "فتح المحادثة والرد", buttonUrl: "{{link}}" }),
    en: c("New contact message: {{subject}}", "A message for your team", "{{message}}", { details: [{ label: "Name", value: "{{name}}" }, { label: "Email", value: "{{email}}" }, { label: "Phone", value: "{{phone}}" }, { label: "Contact type", value: "{{kind}}" }], buttonLabel: "Open conversation and reply", buttonUrl: "{{link}}" }),
  } },
  { key: "contact_reply", name_ar: "رد فريق الدعم", name_en: "Support reply", audience: "all", variables: ["name", "subject", "body", "site_name"], content: {
    ar: c("رد فريق إتسوء: {{subject}}", "مرحبًا {{name}}، عندنا رد لرسالتك", "{{body}}", { preheader: "تابع رد فريق إتسوء على استفسارك.", note: "فريق دعم إتسوء\nإذا احتجت مساعدة إضافية، تواصل معنا من صفحة الدعم." }),
    en: c("Your reply from Etsawaa: {{subject}}", "Hi {{name}}, we have an update for you", "{{body}}", { preheader: "An update from the Etsawaa team about your enquiry.", note: "Etsawaa Support\nFor further assistance, reach us through our contact page." }),
  } },
  { key: "user_invite", name_ar: "دعوة حساب جديد", name_en: "Account invitation", audience: "all", variables: ["name", "email", "role", "invite_url", "login_url", "site_name", "site_url"], content: {
    ar: c("دعوتك للانضمام إلى إتسوء جاهزة", "أهلًا {{name}}، مكانك جاهز", "تمت دعوتك للانضمام إلى إتسوء. استخدم الرابط الآمن لتعيين كلمة مرورك والبدء.", { details: [{ label: "البريد", value: "{{email}}" }, { label: "نوع الحساب", value: "{{role}}" }], buttonLabel: "تفعيل حسابي", buttonUrl: "{{invite_url}}", note: "الرابط خاص بك. لا تشاركه مع أي شخص. إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل الرسالة." }),
    en: c("Your invitation to Etsawaa is ready", "There’s a place for you, {{name}}", "You’ve been invited to join Etsawaa. Use your secure link to set a password and get started.", { details: [{ label: "Email", value: "{{email}}" }, { label: "Account type", value: "{{role}}" }], buttonLabel: "Activate your account", buttonUrl: "{{invite_url}}", note: "This link is personal. Don’t share it. If you weren’t expecting this invitation, you can ignore this email." }),
  } },
  { key: "account_created", name_ar: "بيانات حساب أنشأته الإدارة", name_en: "Admin-created account", audience: "all", variables: ["name", "email", "role", "password", "login_url", "site_name", "site_url"], content: {
    ar: c("حسابك على إتسوء جاهز يا {{name}}", "خطوتك الأولى على إتسوء", "أنشأ الفريق حسابك. استخدم البيانات التالية لتسجيل الدخول، ثم غيّر كلمة المرور من إعدادات حسابك.", { details: [{ label: "البريد", value: "{{email}}" }, { label: "نوع الحساب", value: "{{role}}" }, { label: "كلمة المرور", value: "{{password}}" }], buttonLabel: "تسجيل الدخول", buttonUrl: "{{login_url}}", note: "احتفظ ببياناتك بأمان، ولا تشارك كلمة المرور مع أحد." }),
    en: c("Your Etsawaa account is ready, {{name}}", "Your first step on Etsawaa", "Our team has created your account. Sign in with the details below, then change your password in your account settings.", { details: [{ label: "Email", value: "{{email}}" }, { label: "Account type", value: "{{role}}" }, { label: "Password", value: "{{password}}" }], buttonLabel: "Sign in", buttonUrl: "{{login_url}}", note: "Keep these details safe and don’t share your password." }),
  } },
  ...events.map(([type, audience, ar, en, introAr, introEn]): EmailDefinition => ({ key: `event:${type}`, name_ar: ar, name_en: en, audience, variables: ["title", "body", "link", "name", "site_name"], content: {
    ar: c(`${ar} | إتسوء`, "{{title}}", `مرحبًا {{name}}،\n{{body}}\n\n${introAr}`, { preheader: ar, buttonLabel: audience === "admin" ? "فتح التفاصيل واتخاذ الإجراء" : "عرض التفاصيل", buttonUrl: "{{link}}" }),
    en: c(`${en} | Etsawaa`, "{{title}}", `Hi {{name}},\n{{body}}\n\n${introEn}`, { preheader: en, buttonLabel: audience === "admin" ? "Review details and take action" : "View details", buttonUrl: "{{link}}" }),
  } })),
];

const authCopy: Array<[string, string, string, string, string]> = [
  ["signup", "تأكيد بريدك الإلكتروني", "Verify your email", "خطوة واحدة ويتأكد حسابك. أدخل الرمز التالي في صفحة التحقق على إتسوء.", "You’re one step away. Enter the code below on the Etsawaa verification page to verify your account."],
  ["recovery", "استرجاع كلمة المرور", "Reset your password", "استلمنا طلبًا لاسترجاع كلمة مرور حسابك. أدخل الرمز التالي في صفحة الاسترجاع لتعيين كلمة مرور جديدة.", "We received a request to reset your password. Enter this code on the reset page to choose a new password."],
  ["magiclink", "تسجيل دخول آمن", "Your secure sign-in", "استخدم الرمز التالي أو الرابط الآمن لتسجيل الدخول إلى حسابك.", "Use this code or your secure link to sign in to your account."],
  ["email_change", "تأكيد بريدك الجديد", "Confirm your new email", "استخدم الرمز التالي لتأكيد عنوان البريد الجديد لحسابك على إتسوء.", "Use this code to confirm the new email address for your Etsawaa account."],
  ["email_change_current", "تأكيد طلب تغيير البريد", "Confirm your email change request", "وصلنا طلب لتغيير بريد حسابك. استخدم هذا الرمز لتأكيد الطلب من بريدك الحالي.", "We received a request to change your account email. Use this code to confirm the request from your current address."],
  ["reauthentication", "تأكيد هويتك", "Confirm it’s you", "للمتابعة بأمان، أدخل الرمز التالي لتأكيد هويتك على إتسوء.", "To continue securely, enter this code to confirm it’s you on Etsawaa."],
  ["invite", "دعوتك إلى إتسوء", "Your invitation to Etsawaa", "استخدم الرابط الآمن لتفعيل حسابك وتعيين كلمة مرورك.", "Use your secure link to activate your account and set your password."],
];
for (const [type, ar, en, bodyAr, bodyEn] of authCopy) {
  const invite = type === "invite";
  EMAIL_CATALOG.push({ key: `auth:${type}`, name_ar: ar, name_en: en, audience: "all", variables: ["code", "confirmation_url", "expires_minutes", "email"], content: {
    ar: c(`${ar} | إتسوء`, ar, bodyAr, { preheader: "رسالة أمان خاصة بحسابك على إتسوء.", code: invite ? "" : "{{code}}", buttonLabel: type === "reauthentication" ? "" : invite ? "تفعيل حسابي" : "المتابعة بأمان", buttonUrl: type === "reauthentication" ? "" : "{{confirmation_url}}", note: "صالح لمدة {{expires_minutes}} دقيقة من وقت الطلب. لا تشارك الرمز أو الرابط مع أحد.\nإذا لم تطلب هذا الإجراء، تجاهل الرسالة." }),
    en: c(`${en} | Etsawaa`, en, bodyEn, { preheader: "A security email for your Etsawaa account.", code: invite ? "" : "{{code}}", buttonLabel: type === "reauthentication" ? "" : invite ? "Activate your account" : "Continue securely", buttonUrl: type === "reauthentication" ? "" : "{{confirmation_url}}", note: "Valid for {{expires_minutes}} minutes from the time of your request. Never share your code or link.\nIf you didn’t request this, ignore this email." }),
  } });
}

export const EMAIL_DEFINITIONS = new Map(EMAIL_CATALOG.map((t) => [t.key, t]));

export function emailSampleVariables(locale: "ar" | "en", key: string): Record<string, string> {
  const ar = locale === "ar";
  const site = "https://etsawaa.com";
  const definition = EMAIL_DEFINITIONS.get(key);
  return {
    name: ar ? "أحمد" : "Alex", customer_name: ar ? "أحمد محمود" : "Alex Morgan", site_name: ar ? "إتسوء" : "Etsawaa", site_url: `${site}/${locale}`,
    order_number: "ETS-26-1042", order_total: ar ? "1,250.00 ج.م" : "EGP 1,250.00", payment_method: ar ? "الدفع عند الاستلام" : "Cash on delivery",
    order_url: `${site}/${locale}/order/ETS-26-1042`, track_url: `${site}/${locale}/order/ETS-26-1042/track`, retry_url: `${site}/${locale}/order/ETS-26-1042`, review_url: `${site}/${locale}/account/orders/ETS-26-1042`,
    reason: ar ? "بناءً على طلبك" : "At your request", review_days: "30", return_days: "14", title: ar ? definition?.name_ar ?? "تحديث يخص حسابك" : definition?.name_en ?? "An update for your account", body: ar ? "تفاصيل التحديث متاحة في حسابك. راجعها لمعرفة الخطوة التالية." : "Your update is available in your account. Review the details for your next step.",
    link: `${site}/${locale}/${definition?.audience === "admin" ? "admin" : definition?.audience === "vendor" ? "vendor" : "account"}`, subject: ar ? "استفسار عن الطلب" : "An order enquiry", message: ar ? "مرحبًا، أريد المساعدة بشأن طلبي." : "Hello, I’d like some help with my order.", kind: ar ? "نموذج العملاء" : "Customer form", email: "customer@example.com", phone: "+201000000000", role: ar ? "عميل" : "Customer", password: "Example-only-42", login_url: `${site}/${locale}/auth/login`, invite_url: `${site}/${locale}/auth/forgot?type=invite&token_hash=example`, code: "123456", confirmation_url: `${site}/${locale}/auth/verify?token_hash=example&type=signup`, expires_minutes: "60",
  };
}
