-- Northstar keeps one versioned financial document per user so the existing
-- ledger, bill, goal, and planning model can be migrated without lossy mapping.
-- All amounts inside the document remain integer cents.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budget_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index budget_documents_updated_at_idx on public.budget_documents (updated_at);

alter table public.profiles enable row level security;
alter table public.budget_documents enable row level security;

create policy "read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "update own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "read own budget" on public.budget_documents for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.budget_documents from anon, authenticated;
grant select on public.profiles, public.budget_documents to authenticated;
grant update (display_name) on public.profiles to authenticated;

create function public.create_profile_for_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.create_profile_for_new_user();

create function public.valid_budget_document(doc jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
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

create function public.save_budget_document(expected_revision bigint, next_data jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  next_revision bigint;
begin
  if owner_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if expected_revision is null or expected_revision < 0 or expected_revision > 9223372036854775806 then
    raise exception 'invalid_revision' using errcode = '22023';
  end if;
  if not public.valid_budget_document(next_data) then
    raise exception 'invalid_budget_document' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    insert into public.budget_documents (user_id, revision, data)
      values (owner_id, 1, next_data)
      on conflict (user_id) do nothing
      returning revision into next_revision;
    if next_revision is not null then return next_revision; end if;
  end if;
  update public.budget_documents
    set revision = revision + 1, data = next_data, updated_at = now()
    where user_id = owner_id and revision = expected_revision
    returning revision into next_revision;
  if next_revision is null then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.valid_budget_document(jsonb) from public;
revoke all on function public.save_budget_document(bigint,jsonb) from public;
grant execute on function public.save_budget_document(bigint,jsonb) to authenticated;

-- Subscribe only to revision notifications; the client fetches the full row via RLS.
alter publication supabase_realtime add table public.budget_documents;
