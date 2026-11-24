-- ============================================================================
-- Legal documents: Terms & Conditions (all users) + Seller agreement (sellers)
--
-- • legal_documents: versioned, bilingual, structured body
--   {sections:[{title:{ar,en}, clauses:[{ar,en}]}]}, exactly one current
--   version per kind, content hash kept for evidence.
-- • legal_acceptances: who accepted which version, when, how (signup / gate
--   / vendor onboarding), typed signature, IP + user agent. One row per
--   (user, document); never updated, never deleted by users.
-- • Sign-up records the acceptance from the auth metadata the server sets
--   (version must be the current one). Users without an acceptance of the
--   current Terms are sent to the acceptance page by the app (Google sign-in,
--   older accounts, a new version).
-- • Seller agreement: onboarding signs the CURRENT version (fn_vendor_config
--   serves it); a vendors trigger records the acceptance; a store cannot be
--   approved without one.
-- Terms content: imported verbatim from the uploaded v2 .docx files.
-- Seller agreement: the existing in-app vendor contract text, version 1.0,
-- until the signed contract file is published as a new version.
-- ============================================================================
begin;

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'seller_agreement')),
  version text not null check (version ~ '^[0-9A-Za-z.\-]{1,20}$'),
  title_ar text not null,
  title_en text not null,
  body jsonb not null,
  content_hash text not null,
  is_current boolean not null default false,
  effective_at timestamptz not null default now(),
  source_file text,
  notes text,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, version),
  constraint legal_body_shape check (jsonb_typeof(body -> 'sections') = 'array' and jsonb_array_length(body -> 'sections') > 0)
);
create unique index if not exists legal_documents_one_current on public.legal_documents (kind) where is_current;

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  kind text not null check (kind in ('terms', 'seller_agreement')),
  version text not null,
  context text not null check (context in ('signup', 'gate', 'vendor_onboarding', 'backfill')),
  signature text,
  ip text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (user_id, document_id)
);
create index if not exists legal_acceptances_kind_idx on public.legal_acceptances (kind, accepted_at desc);
create index if not exists legal_acceptances_vendor_idx on public.legal_acceptances (vendor_id);

alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
drop policy if exists legal_documents_read on public.legal_documents;
create policy legal_documents_read on public.legal_documents for select using (true);
drop policy if exists legal_acceptances_read on public.legal_acceptances;
create policy legal_acceptances_read on public.legal_acceptances for select
  using (user_id = auth.uid() or public.is_admin());
grant select on public.legal_documents to anon, authenticated;
grant select on public.legal_acceptances to authenticated;

-- helpers ------------------------------------------------------------------------
create or replace function public.fn_legal_current_version(p_kind text)
returns text
language sql stable security definer set search_path = public as $$
  select version from public.legal_documents where kind = p_kind and is_current;
$$;

-- the document as plain text (title, then "• clause" lines) for older screens
create or replace function public.fn_legal_plain(p_kind text, p_lang text)
returns text
language sql stable security definer set search_path = public as $$
  select string_agg(line, E'\n' order by s_ord, c_ord)
    from (
      select s.ord as s_ord, 0 as c_ord, s.sec -> 'title' ->> p_lang as line
        from public.legal_documents d, jsonb_array_elements(d.body -> 'sections') with ordinality s(sec, ord)
       where d.kind = p_kind and d.is_current
      union all
      select s.ord, c.ord, '• ' || (c.cl ->> p_lang)
        from public.legal_documents d, jsonb_array_elements(d.body -> 'sections') with ordinality s(sec, ord),
             jsonb_array_elements(s.sec -> 'clauses') with ordinality c(cl, ord)
       where d.kind = p_kind and d.is_current
    ) x;
$$;

-- what the signed-in user still has to accept
create or replace function public.fn_legal_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_terms public.legal_documents%rowtype;
  v_seller public.legal_documents%rowtype;
  v_vendor uuid := public.own_vendor_id();
begin
  if v_uid is null then return null; end if;
  select * into v_terms from public.legal_documents where kind = 'terms' and is_current;
  select * into v_seller from public.legal_documents where kind = 'seller_agreement' and is_current;
  return jsonb_build_object(
    'terms', jsonb_build_object('version', v_terms.version,
      'accepted', v_terms.id is null or exists (select 1 from public.legal_acceptances where user_id = v_uid and document_id = v_terms.id),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and document_id = v_terms.id)),
    'seller_agreement', jsonb_build_object('required', v_vendor is not null, 'version', v_seller.version,
      'accepted', v_vendor is null or v_seller.id is null
                  or exists (select 1 from public.legal_acceptances where user_id = v_uid and document_id = v_seller.id),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and document_id = v_seller.id)));
end $$;

-- accept the CURRENT version of a document (stale pages are refused)
create or replace function public.fn_accept_legal(p_kind text, p_version text, p_context text default 'gate',
  p_signature text default null, p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.legal_documents%rowtype;
  v_vendor uuid := public.own_vendor_id();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth_required'); end if;
  select * into v_doc from public.legal_documents where kind = p_kind and is_current;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_document'); end if;
  if p_version is distinct from v_doc.version then return jsonb_build_object('ok', false, 'reason', 'version_changed'); end if;
  if p_context not in ('signup', 'gate', 'vendor_onboarding') then return jsonb_build_object('ok', false, 'reason', 'bad_context'); end if;
  if p_kind = 'seller_agreement' then
    if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'not_a_seller'); end if;
    if length(trim(coalesce(p_signature, ''))) < 3 then return jsonb_build_object('ok', false, 'reason', 'signature_required'); end if;
  end if;
  insert into public.legal_acceptances (user_id, vendor_id, document_id, kind, version, context, signature, ip, user_agent)
  values (v_uid, case when p_kind = 'seller_agreement' then v_vendor end, v_doc.id, p_kind, v_doc.version, p_context,
          nullif(trim(coalesce(p_signature, '')), ''), left(p_ip, 64), left(p_user_agent, 300))
  on conflict (user_id, document_id) do nothing;
  if p_kind = 'seller_agreement' then
    update public.vendors set terms_version = v_doc.version, terms_accepted_at = now(), terms_signature = trim(p_signature)
     where id = v_vendor;
  end if;
  perform public.fn_audit('legal.accepted', 'legal_documents', v_doc.id::text, null,
    jsonb_build_object('kind', p_kind, 'version', v_doc.version, 'context', p_context));
  return jsonb_build_object('ok', true, 'version', v_doc.version);
end $$;

-- publish a new version (becomes current; earlier acceptances stay on record)
create or replace function public.fn_admin_publish_legal(p_kind text, p_version text, p_title_ar text, p_title_en text,
  p_body jsonb, p_notes text default null, p_source_file text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_kind not in ('terms', 'seller_agreement') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;
  if coalesce(p_version, '') !~ '^[0-9A-Za-z.\-]{1,20}$' then return jsonb_build_object('ok', false, 'reason', 'bad_version'); end if;
  if exists (select 1 from public.legal_documents where kind = p_kind and version = p_version) then
    return jsonb_build_object('ok', false, 'reason', 'version_exists');
  end if;
  if jsonb_typeof(p_body -> 'sections') <> 'array' or jsonb_array_length(p_body -> 'sections') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_body');
  end if;
  if coalesce(trim(p_title_ar), '') = '' or coalesce(trim(p_title_en), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'title_required');
  end if;
  select version into v_prev from public.legal_documents where kind = p_kind and is_current;
  update public.legal_documents set is_current = false where kind = p_kind and is_current;
  insert into public.legal_documents (kind, version, title_ar, title_en, body, content_hash, is_current, source_file, notes, published_by)
  values (p_kind, p_version, trim(p_title_ar), trim(p_title_en), p_body, encode(sha256(convert_to(p_body::text, 'UTF8')), 'hex'),
          true, nullif(trim(coalesce(p_source_file, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  perform public.fn_audit('legal.published', 'legal_documents', v_id::text,
    jsonb_build_object('kind', p_kind, 'version', v_prev), jsonb_build_object('kind', p_kind, 'version', p_version));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- seller agreement signed in the onboarding wizard → acceptance record
create or replace function public.fn_vendor_terms_acceptance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_doc uuid;
begin
  if new.terms_accepted_at is null or new.terms_version is null then return new; end if;
  if tg_op = 'UPDATE' and new.terms_accepted_at is not distinct from old.terms_accepted_at
     and new.terms_version is not distinct from old.terms_version then
    return new;
  end if;
  select id into v_doc from public.legal_documents where kind = 'seller_agreement' and version = new.terms_version;
  if v_doc is null then return new; end if;
  insert into public.legal_acceptances (user_id, vendor_id, document_id, kind, version, context, signature, accepted_at)
  values (new.owner_id, new.id, v_doc, 'seller_agreement', new.terms_version, 'vendor_onboarding',
          new.terms_signature, new.terms_accepted_at)
  on conflict (user_id, document_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_vendor_terms_acceptance on public.vendors;
create trigger trg_vendor_terms_acceptance after insert or update of terms_accepted_at, terms_version on public.vendors
  for each row execute function public.fn_vendor_terms_acceptance();

-- sign-up: the server puts the accepted Terms version (+ IP/UA) in the metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_doc public.legal_documents%rowtype;
begin
  insert into public.profiles (id, email, full_name, phone, locale, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone_e164', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'ar'),
    'customer'
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        phone     = coalesce(public.profiles.phone, excluded.phone);
  select * into v_doc from public.legal_documents where kind = 'terms' and is_current;
  if v_doc.id is not null and new.raw_user_meta_data ->> 'terms_version' = v_doc.version then
    insert into public.legal_acceptances (user_id, document_id, kind, version, context, ip, user_agent, accepted_at)
    values (new.id, v_doc.id, 'terms', v_doc.version, 'signup',
            left(new.raw_user_meta_data ->> 'terms_ip', 64), left(new.raw_user_meta_data ->> 'terms_ua', 300),
            coalesce((new.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz, now()))
    on conflict (user_id, document_id) do nothing;
  end if;
  return new;
end $$;

-- seeds ----------------------------------------------------------------------------
insert into public.legal_documents (kind, version, title_ar, title_en, body, content_hash, is_current, effective_at, source_file, notes)
values ('terms', '2.0', 'الشروط والأحكام', 'Terms and Conditions', $terms${"sections": [{"title": {"ar": "المقدمة", "en": "Introduction"}, "clauses": [{"ar": "باستخدامك موقع إتسوء أو تطبيقه، فأنت توافق على هذه الشروط والأحكام. إذا لم توافق عليها، يرجى عدم استخدام المنصة.", "en": "By using the Etsawaa website or app, you agree to these Terms and Conditions. If you do not agree, please do not use the Platform."}, {"ar": "تسري هذه الشروط على جميع المستخدمين: المشترين والبائعين.", "en": "These Terms apply to all users: buyers and sellers."}]}, {"title": {"ar": "التعريفات", "en": "Definitions"}, "clauses": [{"ar": "الشركة / إتسوء: مشغلة المنصة.", "en": "Company / Etsawaa: the operator of the Platform."}, {"ar": "المنصة: موقع إتسوء الإلكتروني وتطبيقه للهواتف المحمولة.", "en": "Platform: the Etsawaa website and mobile app."}, {"ar": "البائع: التاجر الذي يعرض منتجاته عبر المنصة.", "en": "Seller: a merchant offering products through the Platform."}, {"ar": "المشتري: من يشتري عبر المنصة.", "en": "Buyer: anyone purchasing through the Platform."}, {"ar": "الطلب: طلب مؤكد لشراء منتج أو أكثر.", "en": "Order: a confirmed request to purchase one or more products."}]}, {"title": {"ar": "تسجيل الحساب", "en": "Account Registration"}, "clauses": [{"ar": "يجب أن تكون 18 عاماً على الأقل لاستخدام المنصة.", "en": "You must be at least 18 years old to use the Platform."}, {"ar": "قدم معلومات دقيقة وكاملة عند التسجيل، وحدّثها عند تغيرها.", "en": "Provide accurate and complete information when registering, and keep it up to date."}, {"ar": "حافظ على سرية بيانات دخولك؛ أنت مسؤول عن كل ما يتم عبر حسابك.", "en": "Keep your login details confidential; you are responsible for everything done through your account."}, {"ar": "حسابك شخصي ولا يجوز نقله إلى شخص آخر.", "en": "Your account is personal and may not be transferred to another person."}, {"ar": "أبلغنا فوراً إذا ظننت أن بياناتك انكشفت أو أن حسابك استُخدم دون إذنك.", "en": "Notify us immediately if you believe your login details have been disclosed or your account has been used without your permission."}, {"ar": "يمكنك إغلاق حسابك في أي وقت بالتواصل معنا، دون أن يؤثر ذلك على طلباتك السابقة.", "en": "You may close your account at any time by contacting us; this does not affect orders already placed."}]}, {"title": {"ar": "دورنا كمنصة", "en": "Our Marketplace Role"}, "clauses": [{"ar": "إتسوء سوق إلكتروني: البائعون يعرضون والمشترون يشترون.", "en": "Etsawaa is an online marketplace: sellers list, buyers purchase."}, {"ar": "عقد بيع المنتج ينعقد بين المشتري والبائع عند تأكيد الشراء؛ إتسوء ليست بائع المنتج، إلا إذا ذُكر أنها البائع.", "en": "The contract of sale for a product is between the buyer and the seller, formed when the purchase is confirmed; Etsawaa is not the seller of the product, unless stated to be the seller."}, {"ar": "نقبل الطلبات ونعالجها ونتولى الإرجاع والاسترداد نيابة عن البائع ولحسابه.", "en": "We accept and process orders and handle returns and refunds for and on behalf of the seller."}]}, {"title": {"ar": "قوائم المنتجات والأسعار", "en": "Product Listings and Prices"}, "clauses": [{"ar": "البائعون مسؤولون عن دقة وشرعية قوائمهم.", "en": "Sellers are responsible for the accuracy and legality of their listings."}, {"ar": "لا نضمن توفر المنتج أو جودته أو دقته، لكن المنتج يجب أن يكون بجودة مرضية ومطابقاً لإعلانه، والبائع يضمن ملكيته له.", "en": "We do not guarantee the availability, quality or accuracy of listed products, but products must be of satisfactory quality and conform to their listing, and the seller warrants ownership of them."}, {"ar": "الأسعار شاملة ضريبة القيمة المضافة ما لم يُذكر خلاف ذلك؛ ورسوم التوصيل تُدفع فقط إذا ظهرت بوضوح قبل تأكيد الطلب.", "en": "Prices include value-added tax unless stated otherwise; delivery charges are payable only if clearly shown before you confirm the order."}, {"ar": "إذا وُجد خطأ في السعر أو الوصف أو التوفر، يجوز تصحيحه، وإذا أثّر على طلبك سنبلغك ويجوز لك الإلغاء مع استرداد كامل.", "en": "If a price, description or availability is incorrect due to an error, it may be corrected; if the correction affects your order, we will inform you and you may cancel for a full refund."}, {"ar": "صور المنتجات وألوانها استرشادية وقد تختلف قليلاً عن المنتج الفعلي.", "en": "Product images and colours are indicative only and may differ slightly from the actual product."}, {"ar": "راجع وصف المنتج وسعره وتقييمات البائع بعناية قبل الشراء.", "en": "Review the product description, price and seller ratings carefully before purchasing."}]}, {"title": {"ar": "الطلبات والمدفوعات", "en": "Orders and Payments"}, "clauses": [{"ar": "طلبك إيجاب بالشراء، وينعقد العقد عند تأكيد قبول طلبك.", "en": "Your order is an offer to buy; the contract is formed when we confirm acceptance of your order."}, {"ar": "قدم معلومات شحن ودفع دقيقة.", "en": "Provide accurate shipping and payment information."}, {"ar": "وسائل الدفع المتاحة تظهر عند إتمام الشراء: بطاقات بنكية، دفع عند الاستلام، محافظ إلكترونية، وتقسيط عبر شركائنا.", "en": "Accepted payment methods are shown at checkout: bank cards, cash on delivery, mobile wallets, and instalment plans from our partners."}, {"ar": "إذا زاد إجمالي قيمة الفاتورة على 5000 جنيه مصري، يجب سدادها ببطاقة بنكية أو بأي وسيلة دفع أخرى متاحة على المنصة، ولا يجوز الدفع عند الاستلام في هذه الحالة، وذلك لأسباب أمنية ومنعاً للسرقة والاحتيال.", "en": "If the total invoice amount exceeds EGP 5,000, it must be paid by bank card or any other payment method available on the Platform; cash on delivery is not permitted in that case, for security reasons and to prevent theft and fraud."}, {"ar": "باختيارك وسيلة دفع، تفوضنا بخصم المبلغ الإجمالي الظاهر عند إتمام الشراء.", "en": "By choosing a payment method, you authorise us to charge the total amount shown at checkout."}, {"ar": "قد نُجري فحوصات تحقق من الهوية والاحتيال قبل قبول الطلب؛ وإذا فشل التحقق قد يُرفض الطلب ويُسترد ما خُصم.", "en": "We may carry out verification checks on identity and fraud before accepting an order; if verification fails, the order may be declined and any amount charged will be refunded."}, {"ar": "نستخدم معالجات دفع من أطراف ثالثة لتسهيل المعاملات.", "en": "We use third-party payment processors to facilitate transactions."}, {"ar": "تصلك فاتورة أو إيصال لكل طلب — احتفظ به لإثبات الشراء.", "en": "You will receive an invoice or receipt for each order — keep it as proof of purchase."}, {"ar": "كود خصم واحد للطلب الواحد ما لم ينص العرض على غير ذلك.", "en": "Only one discount code may be used per order unless a promotion states otherwise."}, {"ar": "حماية المشتري: إذا لم يصل المنتج، أو وصل مختلفاً جوهرياً عن إعلانه، أو تالفاً أو معيباً، ارفع شكوى عبر المنصة وسنحقق فيها ونرتب الاستبدال أو الاسترداد إذا ثبتت.", "en": "Buyer protection: if a product is not delivered, is materially different from its listing, or arrives damaged or defective, raise a complaint through the Platform and we will investigate and arrange a replacement or refund if the complaint is upheld."}]}, {"title": {"ar": "الشحن والتوصيل", "en": "Shipping and Delivery"}, "clauses": [{"ar": "تتولى المنصة ترتيب الشحن والتوصيل بالتعاون مع شركات شحن مرخصة ومعتمدة لديها، ويلتزم البائع بتسليم المنتج إلى شركة الشحن المعتمدة وفق تعليمات المنصة، ولا يجوز له شحن المنتج مباشرة إلى المشتري خارج إطار المنصة.", "en": "The Platform arranges shipping and delivery in cooperation with licensed shipping companies approved by it. The seller must hand the product over to the approved shipping company in accordance with the Platform's instructions, and may not ship the product directly to the buyer outside the Platform's framework."}, {"ar": "يلتزم البائع بتصوير المنتج قبل تغليفه، والاحتفاظ بالصور حتى إتمام التوصيل وقبول المشتري للمنتج، وتقديمها إلى المنصة عند طلبها أو عند نشوء أي نزاع بشأن الطلب.", "en": "The seller must photograph the product before packaging it, retain the photographs until delivery is completed and the buyer has accepted the product, and submit them to the Platform on request or if any dispute arises regarding the order."}, {"ar": "مواعيد التوصيل المعروضة تقديرية وليست ضمانات؛ وإذا تأخر الطلب مدة غير معقولة تواصل معنا للاستفسار عن الإلغاء والاسترداد.", "en": "Delivery times shown are estimates, not guarantees; if an order is delayed for an unreasonable time, contact us to ask about cancellation and a refund."}, {"ar": "تأكد من دقة العنوان وبيانات الاتصال ووجود من يستلم؛ فشل التوصيل بسبب خطأ في العنوان أو عدم وجود مستلم قد يترتب عليه محاولة إعادة توصيل أو رسوم إضافية.", "en": "Make sure your address and contact details are accurate and that someone is available to receive the order; failed delivery due to a wrong address or no one available may lead to a redelivery attempt or additional charges."}, {"ar": "تنتقل مخاطر المنتج إليك عند التوصيل، والملكية عند سداد الثمن كاملاً.", "en": "Risk in a product passes to you on delivery, and ownership passes when the price is paid in full."}, {"ar": "افحص المنتج عند التوصيل، وأبلغ خلال 48 ساعة إذا كان تالفاً ظاهراً أو معيباً أو غير ما طلبته، واحتفظ به وبتغليفه دون تغيير حتى نوجهك.", "en": "Inspect the product on delivery, and report within 48 hours if it is visibly damaged, defective, or not the product you ordered, keeping it and its packaging unchanged until we advise you."}, {"ar": "طلبات الدفع عند الاستلام تُدفع كاملة للمندوب عند التوصيل؛ ورفض الاستلام دون سبب وجيه قد يقيد طلباتك المستقبلية بالدفع عند الاستلام.", "en": "Cash-on-delivery orders must be paid in full to the courier on delivery; refusing delivery without a valid reason may restrict future cash-on-delivery orders."}, {"ar": "لا نتحمل مسؤولية تأخيرات الشحن أو الأضرار أو الطرود المفقودة، دون إخلال بحقك في الشكوى عبر حماية المشتري.", "en": "We are not liable for shipping delays, damage or lost parcels, without prejudice to your right to complain through buyer protection."}]}, {"title": {"ar": "الإرجاع والاسترداد والاستبدال", "en": "Returns, Refunds and Exchanges"}, "clauses": [{"ar": "يجوز إرجاع المنتج المؤهل خلال 14 يوماً من الاستلام دون إبداء سبب، وخلال 30 يوماً إذا كان به عيب صناعة، وفق قانون حماية المستهلك رقم 181 لسنة 2018.", "en": "You may return an eligible product within 14 days of receiving it, without giving a reason, and within 30 days if it has a manufacturing defect, under the Egyptian Consumer Protection Law No. 181 of 2018."}, {"ar": "قدم طلب الإرجاع عبر حسابك أو بالتواصل معنا مع ذكر السبب؛ وسنرتب الاستلام أو نبلغك بمكان الإرجاع، ولا يُعتبر الإرجاع مقبولاً حتى نؤكده.", "en": "Submit a return request through your account or by contacting us, stating the reason; we will arrange collection or tell you where to return the product, and a return is not accepted until we confirm it."}, {"ar": "عند طلب إرجاع منتج بدعوى التلف أو المخالفة أو عدم المطابقة لما طُلب، يجب على المشتري تصوير المنتج صوراً أو مقطع فيديو يثبت حالته كما استلمه، وإرفاقها بطلب الإرجاع، ويجوز للمنصة تأجيل الفصل في الطلب لحين تقديم هذا الإثبات.", "en": "When requesting the return of a product on the grounds of damage, defect or non-conformity with what was ordered, the buyer must photograph the product, by photos or video, showing its condition as received, and attach them to the return request; the Platform may defer deciding the request until such proof is provided."}, {"ar": "ويجوز للمنصة، عند الفصل في نزاع بشأن منتج مرتجع، مقارنة الصور أو الفيديو المقدم من المشتري بصور البائع قبل التغليف.", "en": "When deciding a dispute over a returned product, the Platform may compare the photos or video provided by the buyer with the seller's pre-packaging photographs."}, {"ar": "يجب أن يكون المنتج غير مستخدم، بحالته وتغليفه الأصلي، مع البطاقات والملصقات والملحقات والهدايا؛ والإلكترونيات والهواتف تُعاد مغلقة غير مفتوحة ما لم يكن بها عيب صناعة.", "en": "The product must be unused, in its original condition and packaging, with all tags, labels, accessories and free items included; electronics and mobile phones must be returned sealed and unopened unless they have a manufacturing defect."}, {"ar": "المنتجات المستخدمة أو المفتوحة أو التالفة من قبلك أو الناقصة قد تُرفض أو يُسترد ثمنها جزئياً بما يعكس انخفاض قيمتها.", "en": "Products that have been used, opened where sealing matters, damaged by you, or returned incomplete may be rejected, or refunded only in part to reflect the reduction in value."}, {"ar": "لا يجوز إرجاع ما يلي إلا إذا كان معيباً أو تالفاً أو غير مطابق: منتجات العناية الشخصية المفتوحة أو المستخدمة؛ الملابس الداخلية وملابس السباحة والنوم والرياضية؛ العطور ومستحضرات التجميل المفتوحة؛ المجوهرات؛ الأغذية والسلع القابلة للتلف؛ المنتجات الرقمية بعد التفعيل أو التنزيل؛ وأي منتج مُعلن أنه غير قابل للإرجاع.", "en": "The following cannot be returned except where defective, damaged, or not as ordered: opened or used personal-care products; underwear, swimwear, sleepwear and gym wear; opened perfumes and cosmetics; jewellery; food, groceries and other perishable goods; digital products and services once activated or downloaded; and any product marked non-returnable on its page."}, {"ar": "تُفحص المرتجعات خلال 48 ساعة من وصولها؛ وإذا رُفض الإرجاع يُعاد المنتج إليك دون استرداد.", "en": "Returned products are inspected within 48 hours of reaching us; if a return is rejected, the product is sent back to you with no refund due."}, {"ar": "شحن الإرجاع مجاني إذا كان المنتج معيباً أو تالفاً أو خطأ أو غير مطابق؛ وعلى حسابك إذا أرجعته لمجرد تغيير رأيك، وقد يُخصم من الاسترداد.", "en": "Return shipping is free if the product is defective, damaged, wrong or not as described; if you return only because you changed your mind, you bear the return shipping cost, which may be deducted from the refund."}, {"ar": "بعد قبول الإرجاع، يُصدر الاسترداد إلى وسيلة الدفع الأصلية خلال 7 إلى 14 يوم عمل؛ وطلبات الدفع عند الاستلام تُسترد بتحويل بنكي أو بوسيلة متفق عليها معك.", "en": "Once a return is accepted, the refund is issued to the original payment method within 7 to 14 business days; cash-on-delivery orders are refunded by bank transfer or another method agreed with you."}, {"ar": "رسوم الشحن المدفوعة تُسترد فقط إذا كان الإرجاع بسبب خطأ منا أو من البائع.", "en": "Shipping fees already paid are refunded only where the return is due to our or the seller's fault."}, {"ar": "إذا أُعيد جزء من طلب أو منتج ضمن عرض، يعكس الاسترداد القيمة المعدلة بعد العرض، ولا تُسترد قيمة الخصم الترويجي نقداً.", "en": "If part of an order is returned, or a product was bought under a promotion, the refund reflects the adjusted value after the promotion, and promotional discounts themselves are not refundable in cash."}, {"ar": "يمكنك اختيار الاستبدال بدلاً من الاسترداد للمنتج المعيب أو التالف أو الخطأ إذا توفر بديل؛ وإلا تحصل على استرداد.", "en": "You may choose an exchange instead of a refund for a defective, damaged or wrong product where a replacement is available; otherwise you receive a refund."}, {"ar": "لا يحد هذا القسم من حقوقك القانونية.", "en": "Nothing in this section limits your statutory rights."}]}, {"title": {"ar": "إلغاء الطلب", "en": "Order Cancellation"}, "clauses": [{"ar": "يمكنك الإلغاء مجاناً قبل الشحن؛ وبعد الشحن يخضع الأمر لقسم الإرجاع.", "en": "You may cancel an order free of charge before it has been dispatched; after dispatch, cancellation is handled through the Returns section."}, {"ar": "يجوز لنا أو للبائع إلغاء الطلب مع استرداد كامل إذا كان المنتج غير متوفر، أو وُجد خطأ في السعر أو الإعلان، أو تعذر التحقق من الدفع، أو اشتُبه في احتيال أو إساءة استخدام.", "en": "We or the seller may cancel an order, with a full refund of any amount paid, if the product is out of stock, if there is a pricing or listing error, if payment cannot be verified, or if we reasonably suspect fraud or abuse."}, {"ar": "إذا أُلغي جزء من الطلب، يُوصَّل الباقي وتُسترد قيمة الجزء الملغى وأي رسوم توصيل متعلقة به.", "en": "If only part of an order is cancelled, the remainder will be delivered and you will be refunded for the cancelled part and any delivery charge attributable to it, where applicable."}]}, {"title": {"ar": "الضمانات", "en": "Warranties"}, "clauses": [{"ar": "قد تحمل المنتجات ضمان الشركة المصنعة أو البائع كما هو مذكور في صفحة المنتج؛ وشروط الضمان ومدته ومراكز الخدمة خاصة بالضامن، ومطالبات الضمان تحتاج إثبات الشراء.", "en": "Products may carry a manufacturer or seller warranty, as stated on the product page; warranty terms, duration and service centres are those of the warrantor, and warranty claims must be supported by proof of purchase."}, {"ar": "لا يستثني أي بند أي ضمان قانوني أو حق استهلاكي لا يجوز استثناؤه بموجب القانون المصري.", "en": "Nothing in these Terms excludes or limits any statutory warranty or consumer right that cannot lawfully be excluded under Egyptian law."}]}, {"title": {"ar": "التقييمات ومحتوى المستخدم", "en": "Reviews and User Content"}, "clauses": [{"ar": "يجب أن تكون تقييماتك وتعليقاتك دقيقة وصادقة وحقيقية، وألا تكون مسيئة أو غير قانونية أو مضللة أو منتهكة لحقوق الغير.", "en": "Your reviews, ratings, comments and other content must be accurate, honest and truthful, and must not be offensive, unlawful, misleading, or infringe any person's rights."}, {"ar": "لا تقدم تقييمات مزيفة أو مدفوعة على أنها حقيقية، ولا تستخدم التقييمات للإعلان أو لتحويل المعاملات خارج المنصة.", "en": "Do not submit fake or incentivised reviews presented as genuine, and do not use reviews to advertise or to divert transactions off the Platform."}, {"ar": "بتقديمك محتوى، تمنحنا ترخيصاً عالمياً غير حصري ومجانياً لاستخدامه وعرضه وتكييفه وتوزيعه لتشغيل المنصة والترويج لها، ويجوز لنا حذف أي محتوى مخالف أو تعديله.", "en": "By submitting content, you grant Etsawaa a worldwide, non-exclusive, royalty-free licence to use, display, adapt and distribute it in connection with operating and promoting the Platform; we may remove or edit any content that breaches these Terms."}, {"ar": "إذا رأيت محتوى غير قانوني أو مخالف، أبلغنا لمراجعته.", "en": "If you believe any content on the Platform is unlawful or breaches these Terms, please report it to us."}]}, {"title": {"ar": "الاستخدام المقبول", "en": "Acceptable Use"}, "clauses": [{"ar": "لا تستخدم المنصة لغرض غير قانوني أو للاحتيال أو لإساءة استخدام العروض أو الاستردادات أو لتعطيل عملها أو لجمع محتواها بشكل منهجي أو لجمع بيانات مستخدمين آخرين.", "en": "Do not use the Platform for any unlawful purpose, to commit fraud, to abuse promotions or refunds, to interfere with the Platform's operation, to scrape or copy its content systematically, or to collect other users' personal or payment information."}, {"ar": "لا تتواصل مع مستخدم آخر لبيع أو شراء منتج معروض خارج المنصة، أو لإتمام معاملة من المنصة خارجها.", "en": "Do not contact another user to buy or sell a listed product outside the Platform, or to complete a Platform transaction off the Platform."}, {"ar": "مخالفة هذا القسم قد تؤدي إلى إيقاف حسابك أو إنهائه واتخاذ إجراءات قانونية عند الاقتضاء.", "en": "Breach of this section may lead to suspension or termination of your account, and to legal action where applicable."}]}, {"title": {"ar": "الملكية الفكرية", "en": "Intellectual Property"}, "clauses": [{"ar": "جميع المحتويات من نصوص ورسومات وشعارات وصور وبرمجيات ملك للشركة أو موردي محتواها ومحمية بقوانين حقوق النشر والملكية الفكرية.", "en": "All content of text, graphics, logos, images and software is the property of the Company or its content suppliers and is protected by copyright and other intellectual property laws."}, {"ar": "لا تستخدم اسم إتسوء أو شعارها أو علاماتها التجارية دون إذن كتابي منا، ولا تنسخ محتوى المنصة أو تعدله أو تعرضه علناً إلا لاستخدامك الشخصي غير التجاري.", "en": "Do not use the Etsawaa name, logo or trademarks without our written permission, and do not reproduce, copy, adapt or publicly display Platform content except for your own personal, non-commercial use of the Platform."}]}, {"title": {"ar": "الخصوصية", "en": "Privacy"}, "clauses": [{"ar": "تُعالج بياناتك وفق سياسة الخصوصية المنشورة على المنصة.", "en": "Your personal data is handled in accordance with our Privacy Policy published on the Platform."}, {"ar": "نستخدم بياناتك لمعالجة الطلبات وترتيب التوصيل والإرجاع ومنع الاحتيال وتشغيل حسابك، ولإرسال رسائل تسويقية حيث وافقت؛ ويمكنك سحب موافقتك التسويقية في أي وقت.", "en": "We use your data to process orders, arrange delivery and returns, prevent fraud, operate your account, and — where you have consented — send marketing communications; you may withdraw marketing consent at any time."}, {"ar": "لا نبيع بياناتك الشخصية لأطراف ثالثة.", "en": "We do not sell your personal data to third parties."}]}, {"title": {"ar": "العروض والكوبونات والقسائم", "en": "Promotions, Coupons and Vouchers"}, "clauses": [{"ar": "لكل عرض أو كود خصم أو قسيمة شروطه الخاصة الموضحة في صفحة المنتج أو الحملة، وتخضع للتوفر.", "en": "Each promotion, coupon and voucher is subject to its own terms, shown on the relevant product or campaign page, and to availability."}, {"ar": "قد تكون العروض محدودة لكل عميل أو طلب، ويجوز إلغاء الطلبات المسيئة للعرض مثل الطلبات المكررة للحصول على العرض نفسه مراراً.", "en": "Promotions may be limited per customer or per order, and we may cancel orders that abuse a promotion, for example duplicate orders created to obtain the same offer repeatedly."}, {"ar": "المزايا الترويجية بلا قيمة نقدية ولا تُستبدل بنقد؛ وإرجاع منتج ضمن عرض يحكمه بند الاسترداد الجزئي أعلاه.", "en": "Promotional benefits have no cash value and cannot be exchanged for cash; returning a product bought under a promotion is governed by the partial-refund rule above."}, {"ar": "إلغاء جزء من طلب مؤهل لعرض قد يؤدي إلى إلغاء باقي أصناف العرض إذا لم تعد شروطه مستوفاة.", "en": "Cancelling part of an order that qualified for a promotion may lead to cancellation of the remaining promotional items if the promotion's conditions are no longer met."}]}, {"title": {"ar": "تحديد المسؤولية", "en": "Limitation of Liability"}, "clauses": [{"ar": "لسنا مسؤولين عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو عقابية ناتجة عن استخدامك المنصة أو عدم قدرتك على استخدامها.", "en": "We are not liable for any indirect, incidental, special, consequential or punitive damages arising from your use of the Platform or your inability to use it."}, {"ar": "لا يحد ذلك من المسؤولية التي لا يجوز تحديدها قانوناً مثل الاحتيال أو الوفاة أو الإصابة الشخصية الناتجة عن الإهمال أو أي حق استهلاكي قانوني.", "en": "Nothing here limits liability that cannot lawfully be limited, including liability for fraud, or for death or personal injury caused by negligence, or any statutory consumer right."}, {"ar": "مع مراعاة ذلك، تقتصر مسؤوليتنا عن أي طلب واحد على إجمالي الثمن المدفوع له، ولا نتحمل خسارة أرباح أو أعمال أو بيانات.", "en": "Subject to that, our total liability for any single order is limited to the total price paid for that order, and we are not liable for any loss of profit, business or data."}, {"ar": "المنتجات نفسها مسؤولية البائع، إلا حيث تنص هذه الشروط صراحة على غير ذلك مثل حماية المشتري.", "en": "Products themselves are the seller's responsibility, except where these Terms expressly provide otherwise, for example under buyer protection."}]}, {"title": {"ar": "التعويض", "en": "Indemnification"}, "clauses": [{"ar": "توافق على تعويضنا وإبراء ذمتنا من أي خسائر أو أضرار أو مطالبات وتكاليف قانونية معقولة تنشأ عن مخالفتك هذه الشروط أو إساءة استخدامك المنصة أو أي محتوى تقدمه ينتهك حقوق الغير أو يخالف القانون.", "en": "You agree to indemnify and hold Etsawaa harmless against any losses, damages, claims and reasonable legal costs arising from your breach of these Terms, your misuse of the Platform, or any content you submit that infringes another person's rights or breaks the law."}]}, {"title": {"ar": "إيقاف الحساب وإنهاؤه", "en": "Suspension and Termination"}, "clauses": [{"ar": "يجوز إيقاف حسابك أو إنهاؤه أو تقييد استخدامك في أي وقت إذا خالفت الشروط أو اشتُبه في احتيال أو إساءة استخدام أو اقتضى القانون ذلك، وسنبلغك بالسبب حيث يكون ذلك ممكناً.", "en": "We may suspend or terminate your account, or restrict your use of the Platform, at any time if you breach these Terms, if we reasonably suspect fraud or abuse, or if required by law; where reasonably possible, we will inform you of the reason."}, {"ar": "إذا ألغينا منتجات أو خدمات دفعت ثمنها ولم تستلمها دون أن تكون قد خالفت الشروط، سنسترد لك ثمنها.", "en": "If we cancel products or services you have paid for but not received, and you have not breached these Terms, we will refund you for them."}]}, {"title": {"ar": "تغييرات الشروط", "en": "Changes to These Terms"}, "clauses": [{"ar": "يجوز تعديل هذه الشروط في أي وقت؛ واستمرار استخدامك بعد التغيير يشكل قبولاً للشروط الجديدة.", "en": "We may amend these Terms at any time; continued use of the Platform after any change constitutes acceptance of the new Terms."}, {"ar": "بالنسبة للتغييرات الجوهرية، سنقدم إشعاراً معقولاً قبل سريانها بنشر الشروط المحدثة أو إخطارك عبر حسابك.", "en": "For material changes, we will give reasonable notice before the change takes effect, for example by posting the updated Terms on the Platform or notifying you through your account."}, {"ar": "لا تسري التغييرات على الطلبات المقدمة قبل التغيير، وتظل محكومة بالشروط السارية وقت الطلب.", "en": "Changes do not affect orders already placed before the change, which remain governed by the Terms in force when the order was placed."}]}, {"title": {"ar": "القانون الحاكم والمنازعات", "en": "Governing Law and Disputes"}, "clauses": [{"ar": "تخضع هذه الشروط لقوانين جمهورية مصر العربية، بما في ذلك قانون حماية المستهلك رقم 181 لسنة 2018، ولا يحرمك أي بند من أي حماية استهلاكية إلزامية.", "en": "These Terms are governed by the laws of the Arab Republic of Egypt, including the Consumer Protection Law No. 181 of 2018; nothing here deprives you of any mandatory consumer protection under Egyptian law."}, {"ar": "إذا كانت لديك شكوى، تواصل معنا أولاً لنحاول حلها، ويمكنك أيضاً تقديم شكوى إلى جهاز حماية المستهلك.", "en": "If you have a complaint, please contact us first so we can try to resolve it; you may also complain to the Consumer Protection Agency."}, {"ar": "إذا تعذر الحل ودياً، يُعرض النزاع على المحاكم المصرية المختصة.", "en": "If a dispute cannot be resolved amicably, it shall be submitted to the competent courts of the Arab Republic of Egypt."}]}, {"title": {"ar": "أحكام عامة", "en": "General Provisions"}, "clauses": [{"ar": "إذا وُجد أي بند غير قابل للتنفيذ، تظل باقي البنود سارية.", "en": "If any provision of these Terms is found unenforceable, the remaining provisions continue in full effect."}, {"ar": "عدم تنفيذنا بنداً فوراً لا يعني تنازلنا عن تنفيذه لاحقاً.", "en": "If we do not enforce a provision immediately, that does not mean we waive our right to enforce it later."}, {"ar": "لا يجوز لك إحالة حقوقك دون موافقتنا الكتابية؛ ويجوز لنا إحالتها إلى خلف في إطار إعادة تنظيم أو بيع أعمال مع إخطارك.", "en": "You may not assign your rights under these Terms without our written consent; we may assign our rights and obligations to a successor in connection with a reorganisation or sale of the business, on notice to you."}, {"ar": "تشكل هذه الشروط مع سياسة الخصوصية وأي شروط عروض تنطبق على طلب، الاتفاق الكامل بينك وبين إتسوء لاستخدام المنصة.", "en": "These Terms, together with the Privacy Policy and any promotion terms that apply to an order, constitute the entire agreement between you and Etsawaa for use of the Platform."}, {"ar": "عند التعارض بين النسختين العربية والإنجليزية، تسود النسخة العربية.", "en": "In case of conflict between the English and Arabic versions, the Arabic version prevails."}]}, {"title": {"ar": "معلومات الاتصال", "en": "Contact Information"}, "clauses": [{"ar": "الشركة: إتسوء — الاسم القانوني الكامل ورقم السجل التجاري والعنوان والتفاصيل الضريبية: تُستكمل قبل النشر.", "en": "Company: Etsawaa — full legal name, commercial registration number, address and tax details: to be completed before publishing."}, {"ar": "دعم العملاء: البريد الإلكتروني ورقم الهاتف: يُستكملان قبل النشر — اذكر رقم طلبك في رسالتك لنخدمك أسرع.", "en": "Customer support: support email and phone number: to be completed before publishing — please include your order number in any message so we can help faster."}]}]}$terms$::jsonb,
        '9f3fb45bd770450bd82dafd3e80fe923f44f10717698bf1530b82832bb72d8ff', true, now(),
        'الشروط_والأحكام_الموقع_عربي_v2.docx + الشروط_والأحكام_الموقع_انجليزي_v2.docx',
        '22 sections / 95 clauses imported verbatim from the uploaded Arabic and English files')
on conflict (kind, version) do nothing;

-- the current in-app seller contract, kept as version 1.0 (same version the
-- onboarding wizard already signs) until the signed contract is published
insert into public.legal_documents (kind, version, title_ar, title_en, body, content_hash, is_current, source_file, notes)
select 'seller_agreement', coalesce(s.value ->> 'version', '1.0'), 'عقد البائع', 'Seller agreement',
       jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
         'title', jsonb_build_object('ar', 'عقد البائع مع منصة إتسوء', 'en', 'Seller agreement with Etsawaa'),
         'clauses', jsonb_build_array(jsonb_build_object('ar', s.value ->> 'text_ar', 'en', s.value ->> 'text_en'))))),
       encode(sha256(convert_to(coalesce(s.value ->> 'text_ar', '') || coalesce(s.value ->> 'text_en', ''), 'UTF8')), 'hex'),
       true, 'settings.vendor_terms', 'Interim text from the onboarding wizard — replace by publishing the signed contract as a new version'
  from public.settings s where s.key = 'vendor_terms'
on conflict (kind, version) do nothing;

-- sellers who already signed version 1.0 in the wizard keep that record
insert into public.legal_acceptances (user_id, vendor_id, document_id, kind, version, context, signature, accepted_at)
select v.owner_id, v.id, d.id, 'seller_agreement', d.version, 'backfill', v.terms_signature, v.terms_accepted_at
  from public.vendors v join public.legal_documents d on d.kind = 'seller_agreement' and d.version = v.terms_version
 where v.terms_accepted_at is not null
on conflict (user_id, document_id) do nothing;

-- patched live functions -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_review_vendor(p_vendor_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendor public.vendors%rowtype;
  v_grace  interval;
  v_cfg    jsonb := public.fn_vendor_config();
begin
  if not (public.is_admin() or public.has_permission('vendors.review')) then
    raise exception 'not allowed: reviewer permission required' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id;
  if v_vendor.id is null then
    raise exception 'vendor not found';
  end if;
  if v_vendor.status <> 'pending' then
    raise exception 'vendor is not awaiting review (status %)', v_vendor.status;
  end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a rejection reason is mandatory';
  end if;
  -- no store goes live without a signed seller agreement on record
  if p_decision = 'approve' and not exists (
       select 1 from public.legal_acceptances la
        where la.vendor_id = p_vendor_id and la.kind = 'seller_agreement') then
    raise exception 'seller_agreement_not_accepted';
  end if;

  update public.vendors set
    status = case when p_decision = 'approve' then 'active' else 'rejected' end,
    rejection_reason = case when p_decision = 'reject' then trim(p_reason) else null end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    -- activation starts the grace clock if still unverified
    grace_until = case
      when p_decision = 'approve' and verification_status = 'unverified' and grace_until is null then
        now() + make_interval(
          days  => case when v_cfg ->> 'grace_unit' = 'days' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end,
          hours => case when v_cfg ->> 'grace_unit' = 'hours' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end,
          years => case when v_cfg ->> 'grace_unit' = 'months' then greatest((v_cfg ->> 'grace_value')::int, 1) else 0 end
        )
      else grace_until end
  where id = p_vendor_id
  returning * into v_vendor;

  perform public.fn_notify(v_vendor.owner_id, 'vendor.' || p_decision || 'd', jsonb_build_object(
    'vendor_id', v_vendor.id,
    'store_name_ar', v_vendor.store_name_ar,
    'reason', case when p_decision = 'reject' then trim(p_reason) else null end
  ));

  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'vendor.review', 'vendors', v_vendor.id::text,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', v_vendor.status, 'reason', v_vendor.rejection_reason));

  return jsonb_build_object('status', v_vendor.status, 'grace_until', v_vendor.grace_until);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_vendor_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_verification jsonb;
  v_terms        jsonb;
  v_vendors      jsonb;
  v_general      jsonb;
begin
  select value into v_verification from public.settings where key = 'verification';
  select value into v_terms from public.settings where key = 'vendor_terms';
  select value into v_vendors from public.settings where key = 'vendors';
  select value into v_general from public.settings where key = 'site.general';
  return jsonb_build_object(
    'registration_enabled', coalesce(v_general ->> 'vendor_registration_enabled', 'true') = 'true',
    'onboarding_mode', coalesce(v_general ->> 'vendor_onboarding_mode', 'manual'),
    'force_onboarding', coalesce(v_general ->> 'force_onboarding', 'true') = 'true',
    'review_required', coalesce(v_vendors ->> 'product_review_required', 'true') = 'true',
    'allow_clone', coalesce(v_vendors ->> 'allow_clone', 'true') = 'true',
    'required_documents', coalesce(v_verification -> 'required_documents', '{}'::jsonb),
    'grace_value', coalesce((v_verification ->> 'grace_value')::int, 7),
    'grace_unit', coalesce(v_verification ->> 'grace_unit', 'days'),
    'max_document_mb', coalesce((v_verification ->> 'max_document_mb')::int, 5),
    -- the seller agreement is a versioned legal document now
    'terms_version', coalesce(public.fn_legal_current_version('seller_agreement'), v_terms ->> 'version', '1.0'),
    'terms_ar', coalesce(public.fn_legal_plain('seller_agreement', 'ar'), v_terms ->> 'text_ar', ''),
    'terms_en', coalesce(public.fn_legal_plain('seller_agreement', 'en'), v_terms ->> 'text_en', '')
  );
end $function$;


revoke all on function public.fn_vendor_terms_acceptance() from public, anon, authenticated;
revoke all on function public.fn_accept_legal(text, text, text, text, text, text) from public, anon;
grant execute on function public.fn_accept_legal(text, text, text, text, text, text) to authenticated;
revoke all on function public.fn_admin_publish_legal(text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.fn_admin_publish_legal(text, text, text, text, jsonb, text, text) to authenticated;
revoke all on function public.fn_legal_status() from public, anon;
grant execute on function public.fn_legal_status() to authenticated;
grant execute on function public.fn_legal_current_version(text) to anon, authenticated;
grant execute on function public.fn_legal_plain(text, text) to anon, authenticated;

commit;
