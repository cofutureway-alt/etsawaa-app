# B5 — Integration gate: owner deferral request (dated)

الحالة: **BLOCKED — ينتظر قرار المالك.** لا يُوقَّع الإطلاق قبل حلّها أو تأجيلها كتابةً.

## الأدلة الفعلية (ليست تقديرات)

`node --env-file=.env scripts/p8-integration-gate.mjs` → `evidence/phase-08/integration-gate.json`

| # | البند | الحالة | السبب المُثبت في الاستدعاء الحقيقي |
|---|---|---|---|
| G1 | إرسال حي: welcome + OTP + order_confirmation عبر Resend | **BLOCKED** | `RESEND_API_KEY` غير مضبوط في `.env` — الواجهة تسجّل `not_configured` في `email_logs` بصدق |
| G1b | القوالب مزروعة AR+EN | **PASS** | 7 قوالب في `email_templates` |
| G2 | Kashier checkout + webhook | **BLOCKED** | `KASHIER_MERCHANT_ID` / `KASHIER_HMAC_SECRET` غير مضبوطة — مسار التوقيع بالكامل مُختبر في p5 63/63 بوضع `test` |
| G3 | Google OAuth round-trip | **BLOCKED** | استدعاء `signInWithOAuth` يعيد 400 `provider is not enabled` من Supabase — يحتاج تفعيل المزوّد + Client ID/Secret من Google Cloud |

ملاحظة G3 — الكود جاهز ومكتمل: `app/routes/auth/google.ts` (بدء التدفق) و
`app/routes/auth/google-callback.tsx` (تبادل الكود + قاعدة الهاتف الإلزامي
للمستخدم الجديد + redirect آمن). العائق في التهيئة فقط.

## ما يلزم لإغلاق كل بند (خطوات دقيقة للمالك)

### G1 — Resend (تقدير: 30 دقيقة)
1. حساب Resend + إضافة `etsawaa.com` كـsending domain.
2. إضافة سجلات DNS: SPF (`TXT`), DKIM (`TXT`), DMARC (`TXT`) — يوفّرها Resend.
3. انتظار التحقق (غالبًا < 30 دقيقة).
4. في `.env`: `RESEND_API_KEY=re_…` و`EMAIL_FROM="Etsawaa <no-reply@etsawaa.com>"`.
5. `node --env-file=.env scripts/p8-integration-gate.mjs` → يجب أن يتحول G1 إلى PASS
   وتسجّل `email_logs` ثلاثة صفوف `sent` مع `provider_id`.

### G2 — Kashier (تقدير: 45 دقيقة)
1. لوحة Kashier → Payment API credentials (Merchant ID + HMAC secret).
2. Merchant → Webhooks → إضافة `https://<domain>/api/webhooks/kashier`.
3. في `.env`: `KASHIER_MERCHANT_ID`, `KASHIER_HMAC_SECRET`, `KASHIER_MODE=live`.
4. إعادة تشغيل الحاجز + تنفيذ transaction حقيقي بمبلغ 1.00 EGP واسترجاعه
   → صف `payments` بحالة `paid` ثم `refunded`.

### G3 — Google (تقدير: 60 دقيقة + زمن مراجعة Google)
1. Google Cloud Console → OAuth 2.0 Client (Web application).
2. Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`.
3. Supabase Dashboard → Authentication → Providers → Google → لصق Client ID/Secret.
4. Site URL + Redirect URLs في Supabase Authentication → URL Configuration:
   `https://<domain>/ar/auth/callback/google` و`/en/auth/callback/google`.
5. إعادة تشغيل الحاجز → G3 وG2/G1 = PASS.

## طلب التأجيل المؤرخ (اختياري — بيد المالك)

إن كان الإطلاق مؤجلًا لسبب تجاري، يُملأ التالي **ويُعتبر الإطلاق محجوبًا حتى تاريخه**:

```
أُقرّ أنا [اسم المالك] بتأجيل بنود التكامل G1/G2/G3 حتى تاريخ: ____/____/____
خلال هذه الفترة:
  • البريد: يبقى not_configured (لا إرسال لعملاء حقيقيين — لن تُنشأ حسابات OTP)
  • الدفع: COD فقط (Kashier معطّل عبر KASHIER_MODE=test)
  • Google: زر تسجيل الدخول يبقى ظاهرًا ويعيد oauth_unavailable بصدق
التوقيع: ________________
```

**قيود إلزامية أثناء التأجيل:** لا تُفتح السوق للجمهور، ويُبقى `KASHIER_MODE=test`،
ولا تُدار حسابات عملاء حقيقية عبر OTP حتى يتحول G1 إلى PASS.

## القرار المطلوب
☐ **إغلاق فوري** — أرسل المفاتيح في `.env` وأعيد تشغيل الحاجز (30–60 دقيقة لكل بند).
☐ **تأجيل موقّع** حتى تاريخ محدد (تعبئة النموذج أعلاه).
☐ **رفض الإطلاق** حتى الإغلاق الكامل (الوضع الآمن الحالي).
