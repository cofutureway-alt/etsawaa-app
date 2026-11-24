-- fn_submit_product: build the "missing" list with array_append (2026-11-06).
-- `v_missing := v_missing || 'variants'` makes Postgres parse 'variants' as
-- an array literal → "malformed array literal" — so every INCOMPLETE product
-- crashed instead of returning "product is incomplete: …", and the seller
-- only saw a generic error. Patched in place from the live definition.

do $$
declare src text; n text;
begin
  src := pg_get_functiondef('public.fn_submit_product'::regproc);
  n := regexp_replace(src, 'v_missing := v_missing \|\| ([^;]+);', 'v_missing := array_append(v_missing, (\1)::text);', 'g');
  if n = src then raise exception 'no v_missing appends found'; end if;
  execute n;
end $$;
