-- ============================================================================
-- fn_legal_status: the seller agreement gate applies to stores past
-- onboarding (pending review, active, suspended). A draft/rejected store signs
-- inside the onboarding wizard, so the panels must not bounce it elsewhere.
-- ============================================================================
begin;

create or replace function public.fn_legal_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      'accepted', v_terms.id is null or exists (select 1 from public.legal_acceptances where user_id = v_uid and document_id = v_terms.id),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and document_id = v_terms.id)),
    'seller_agreement', jsonb_build_object(
      'required', v_vendor.id is not null and v_vendor.status in ('pending', 'active', 'suspended'),
      'version', v_seller.version,
      'accepted', v_vendor.id is null or v_seller.id is null
                  or exists (select 1 from public.legal_acceptances where user_id = v_uid and document_id = v_seller.id),
      'accepted_at', (select max(accepted_at) from public.legal_acceptances where user_id = v_uid and document_id = v_seller.id)));
end $$;
revoke all on function public.fn_legal_status() from public, anon;
grant execute on function public.fn_legal_status() to authenticated;

commit;
