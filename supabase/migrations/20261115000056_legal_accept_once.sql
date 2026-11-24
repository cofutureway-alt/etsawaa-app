-- Owner request: a vendor (and any user) agrees once, including future
-- amendments, so a newly published version no longer forces re-acceptance.
-- "accepted" = any version of that document kind was accepted.
create or replace function public.fn_legal_status()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_terms public.legal_documents%rowtype;
  v_seller public.legal_documents%rowtype;
  v_vendor public.vendors%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into v_terms from public.legal_documents where kind = 'terms' and is_current;
  select * into v_seller from public.legal_documents where kind = 'seller_agreement' and is_current;
  select * into v_vendor from public.vendors where owner_id = v_uid;
  return jsonb_build_object(
    'terms', jsonb_build_object('version', v_terms.version,
      'accepted', v_terms.id is null or exists (select 1 from public.legal_acceptances where user_id = v_uid and kind = 'terms'),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and kind = 'terms')),
    'seller_agreement', jsonb_build_object(
      'required', v_vendor.id is not null and v_vendor.status in ('pending', 'active', 'suspended'),
      'version', v_seller.version,
      'accepted', v_vendor.id is null or v_seller.id is null
                  or exists (select 1 from public.legal_acceptances where user_id = v_uid and kind = 'seller_agreement'),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and kind = 'seller_agreement')));
end $function$;
