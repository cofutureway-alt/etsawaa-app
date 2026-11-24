CREATE OR REPLACE FUNCTION public.ar_norm(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(txt, ''),
    '[ًٌٍَُِّْٰـ]', '', 'g'),
    '[أإآٱ]', 'ا', 'g'),
    'ة', 'ه', 'g'),
    'ى', 'ي', 'g'))
$function$
;
