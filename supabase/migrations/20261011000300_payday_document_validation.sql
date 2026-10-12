-- Payday data remains inside each user's RLS-protected budget document.
-- This constraint checks the extension without changing access grants or policies.
create or replace function public.valid_payday_extension(doc jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  p jsonb := doc->'payday';
  item jsonb;
  entry record;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(p->'weekday') is distinct from 'number'
    or coalesce(p->>'weekday', '') !~ '^[0-6]$'
    or coalesce(p->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(length(p->>'timeZone'), 0) not between 1 and 80
    or jsonb_typeof(p->'autoPrompt') is distinct from 'boolean'
    or jsonb_typeof(p->'rules') is distinct from 'array'
    or jsonb_typeof(p->'checkins') is distinct from 'object'
    or jsonb_array_length(p->'rules') > 100 then return false; end if;
  for item in select * from jsonb_array_elements(p->'rules') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'category'), 0) not between 1 and 80
      or coalesce(item->>'mode', '') not in ('fixed', 'percent')
      or jsonb_typeof(item->'value') is distinct from 'number'
      or coalesce(item->>'value', '') !~ '^[0-9]{1,15}(\.[0-9]{1,2})?$'
      or (item->>'mode' = 'fixed' and coalesce(item->>'value', '') !~ '^[0-9]{1,15}$')
      or (item->>'mode' = 'percent' and (item->>'value')::numeric > 100)
      or coalesce(item->>'priority', '') !~ '^[1-5]$' then return false; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p->'checkins')) > 10000 then return false; end if;
  for entry in select key, value from jsonb_each(p->'checkins') loop
    if entry.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char(entry.key::date, 'YYYY-MM-DD') <> entry.key
      or jsonb_typeof(entry.value) is distinct from 'object'
      or coalesce(entry.value->>'status', '') not in ('completed','skipped','dismissed','snoozed')
      or (entry.value ? 'deferUntil' and coalesce(entry.value->>'deferUntil', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')
      or length(coalesce(entry.value->>'transactionId', '')) > 120 then return false; end if;
  end loop;
  for item in select * from jsonb_array_elements(doc->'transactions') loop
    if item ? 'paydayCycle' and (
      coalesce(item->>'paydayCycle', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((item->>'paydayCycle')::date, 'YYYY-MM-DD') <> item->>'paydayCycle'
    ) then return false; end if;
  end loop;
  for item in select * from jsonb_array_elements(doc->'bills') loop
    if item ? 'sinkingPaychecks' and (
      coalesce(item->>'sinkingPaychecks', '') !~ '^[1-9][0-9]?$'
      or (item->>'sinkingPaychecks')::integer > 52
    ) then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.budget_documents
  add constraint budget_payday_extension_valid
  check (public.valid_payday_extension(data)) not valid;
alter table public.budget_documents validate constraint budget_payday_extension_valid;
