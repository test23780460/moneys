-- Resolve the jsonb_each value column separately from the PL/pgSQL value variable.
create or replace function public.valid_budget_document(doc jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  item jsonb;
  movement jsonb;
  value jsonb;
  entry record;
  allocation record;
begin
  if doc is null or octet_length(doc::text) > 5000000
    or jsonb_typeof(doc->'version') is distinct from 'number' or doc->>'version' is distinct from '1'
    or jsonb_typeof(doc->'transactions') is distinct from 'array'
    or jsonb_typeof(doc->'bills') is distinct from 'array'
    or jsonb_typeof(doc->'goals') is distinct from 'array'
    or jsonb_typeof(doc->'categories') is distinct from 'array'
    or jsonb_typeof(doc->'allocations') is distinct from 'object'
    or jsonb_typeof(doc->'payPlans') is distinct from 'object'
    or jsonb_typeof(doc->'settings') is distinct from 'object' then
    return false;
  end if;
  if jsonb_array_length(doc->'transactions') > 50000
    or jsonb_array_length(doc->'bills') > 5000
    or jsonb_array_length(doc->'goals') > 5000 then return false; end if;
  if jsonb_typeof(doc->'settings'->'weekStarts') is distinct from 'number'
    or jsonb_typeof(doc->'settings'->'startingBalanceCents') is distinct from 'number'
    or coalesce(doc->'settings'->>'weekStarts', '') !~ '^[0-6]$'
    or coalesce(doc->'settings'->>'startingBalanceCents', '') !~ '^-?[0-9]{1,15}$'
    or coalesce(doc->'settings'->>'currency', '') !~ '^[A-Z]{3}$' then return false; end if;
  for item in select * from jsonb_array_elements(doc->'transactions') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'id'), 0) not between 1 and 120
      or coalesce(item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((item->>'date')::date, 'YYYY-MM-DD') <> item->>'date'
      or coalesce(item->>'type', '') not in ('Income','Expense','Transfer','Savings')
      or jsonb_typeof(item->'amountCents') is distinct from 'number'
      or coalesce(item->>'amountCents', '') !~ '^[0-9]{1,15}$'
      or length(coalesce(item->>'category','')) > 80
      or (coalesce(item->>'type','') = 'Income' and coalesce(item->>'status','') not in ('Received','Expected'))
      or (coalesce(item->>'type','') = 'Expense' and coalesce(item->>'status','') not in ('Paid','Upcoming'))
      or (coalesce(item->>'type','') in ('Transfer','Savings') and coalesce(item->>'status','') not in ('Cleared','Planned'))
      or length(coalesce(item->>'description','')) > 500
      or length(coalesce(item->>'notes','')) > 5000
      or (item ? 'direction' and coalesce(item->>'direction', '') not in ('in','out')) then return false; end if;
  end loop;
  for item in select * from jsonb_array_elements(doc->'bills') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'id'), 0) not between 1 and 120
      or coalesce(item->>'nextDue', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((item->>'nextDue')::date, 'YYYY-MM-DD') <> item->>'nextDue'
      or jsonb_typeof(item->'amountCents') is distinct from 'number'
      or coalesce(item->>'amountCents', '') !~ '^[0-9]{1,15}$'
      or coalesce(item->>'frequency', '') not in ('Weekly','Biweekly','Monthly','Quarterly','Yearly')
      or length(coalesce(item->>'category','')) > 80
      or length(coalesce(item->>'notes','')) > 5000
      or length(coalesce(item->>'name','')) > 500 then return false; end if;
  end loop;
  for item in select * from jsonb_array_elements(doc->'goals') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'id'), 0) not between 1 and 120
      or jsonb_typeof(item->'targetCents') is distinct from 'number'
      or coalesce(item->>'targetCents', '') !~ '^[0-9]{1,15}$'
      or jsonb_typeof(item->'movements') is distinct from 'array' then return false; end if;
    for movement in select * from jsonb_array_elements(item->'movements') loop
      if jsonb_typeof(movement) is distinct from 'object'
        or coalesce(length(movement->>'id'), 0) not between 1 and 120
        or jsonb_typeof(movement->'amountCents') is distinct from 'number'
        or coalesce(movement->>'amountCents', '') !~ '^-?[0-9]{1,15}$'
        or coalesce(movement->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or to_char((movement->>'date')::date, 'YYYY-MM-DD') <> movement->>'date' then return false; end if;
    end loop;
  end loop;
  for value in select * from jsonb_array_elements(doc->'categories') loop
    if jsonb_typeof(value) is distinct from 'string' or length(trim(both '"' from value::text)) > 80 then return false; end if;
  end loop;
  for entry in select key, value from jsonb_each(doc->'payPlans') loop
    if entry.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(entry.value) is distinct from 'number'
      or entry.value::text !~ '^[0-9]{1,15}$' then return false; end if;
  end loop;
  for entry in select key, value from jsonb_each(doc->'allocations') loop
    if entry.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(entry.value) is distinct from 'object' then return false; end if;
    for allocation in select key, value from jsonb_each(entry.value) loop
      if length(allocation.key) > 80
        or jsonb_typeof(allocation.value) is distinct from 'number'
        or allocation.value::text !~ '^[0-9]{1,15}$' then return false; end if;
    end loop;
  end loop;
  if (select count(*) from jsonb_array_elements(doc->'transactions')) <>
     (select count(distinct value->>'id') from jsonb_array_elements(doc->'transactions'))
    or (select count(*) from jsonb_array_elements(doc->'bills')) <>
       (select count(distinct value->>'id') from jsonb_array_elements(doc->'bills'))
    or (select count(*) from jsonb_array_elements(doc->'goals')) <>
       (select count(distinct value->>'id') from jsonb_array_elements(doc->'goals')) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;
