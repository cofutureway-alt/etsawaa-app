CREATE OR REPLACE FUNCTION public.product_owned_or_admin(p_product_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id
      and (v.owner_id = auth.uid() or public.has_permission('products.edit'))
  );
$function$
;
