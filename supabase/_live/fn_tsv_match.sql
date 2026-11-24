CREATE OR REPLACE FUNCTION public.fn_tsv_match(p_id uuid, p_q text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.products p
    where p.id = p_id
      and p.search_tsv @@ websearch_to_tsquery('arabic', p_q)
  );
$function$
;
