-- The revisioned budget document remains authoritative for offline merge and
-- atomic ledger/entry updates. This table is a relational, read-only projection.
create table public.gambling_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('scratch','game','other')),
  activity_date date not null,
  payout_date date,
  activity_time time,
  name text not null,
  subcategory text not null default '',
  platform text not null default '',
  ticket_price_cents bigint,
  ticket_count integer,
  rounds integer,
  stake_cents bigint not null check (stake_cents >= 0),
  payout_cents bigint not null check (payout_cents >= 0),
  notes text not null default '',
  stake_transaction_id text,
  payout_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (stake_cents > 0 or payout_cents > 0),
  check (char_length(id) between 1 and 120),
  check (char_length(name) between 1 and 500),
  check (char_length(subcategory) <= 80 and char_length(platform) <= 500 and char_length(notes) <= 5000),
  check (ticket_count is null or ticket_count between 1 and 10000),
  check (rounds is null or rounds between 1 and 1000000),
  check (kind <> 'scratch' or (ticket_price_cents >= 0 and ticket_count is not null and ticket_price_cents * ticket_count = stake_cents))
);
create index gambling_entries_user_date_idx on public.gambling_entries (user_id, activity_date desc);
create unique index gambling_entries_stake_link_idx on public.gambling_entries (user_id, stake_transaction_id)
  where stake_transaction_id is not null;
create unique index gambling_entries_payout_link_idx on public.gambling_entries (user_id, payout_transaction_id)
  where payout_transaction_id is not null;
alter table public.gambling_entries enable row level security;
create policy "read own gambling entries" on public.gambling_entries for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.gambling_entries from anon, authenticated;
grant select on public.gambling_entries to authenticated;

create function public.valid_gambling_extension(doc jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  g jsonb := doc->'gambling';
  item jsonb;
  tx jsonb;
  side text;
  link_id text;
  amount_text text;
  needed_type text;
  needed_status text;
  used_links text[] := array[]::text[];
begin
  if g is null then return true; end if;
  if jsonb_typeof(g) is distinct from 'object'
    or jsonb_typeof(g->'entries') is distinct from 'array'
    or jsonb_typeof(g->'limit') is distinct from 'object'
    or coalesce(g->'limit'->>'period', '') not in ('none','week','month')
    or jsonb_typeof(g->'limit'->'amountCents') is distinct from 'number'
    or coalesce(g->'limit'->>'amountCents', '') !~ '^[0-9]{1,15}$'
    or (g->'limit'->>'period' <> 'none' and (g->'limit'->>'amountCents')::bigint = 0)
    or jsonb_array_length(g->'entries') > 10000 then return false; end if;
  if (select count(*) from jsonb_array_elements(g->'entries')) <>
     (select count(distinct value->>'id') from jsonb_array_elements(g->'entries')) then return false; end if;
  for item in select * from jsonb_array_elements(g->'entries') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(length(item->>'id'),0) not between 1 and 120
      or coalesce(item->>'kind','') not in ('scratch','game','other')
      or coalesce(item->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((item->>'date')::date,'YYYY-MM-DD') <> item->>'date'
      or (item ? 'payoutDate' and (coalesce(item->>'payoutDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or to_char((item->>'payoutDate')::date,'YYYY-MM-DD') <> item->>'payoutDate'))
      or coalesce(length(trim(item->>'name')),0) not between 1 and 500
      or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'notes') is distinct from 'string'
      or jsonb_typeof(item->'platform') is distinct from 'string'
      or coalesce(length(item->>'subcategory'),0) > 80
      or coalesce(length(item->>'platform'),0) > 500
      or coalesce(length(item->>'notes'),0) > 5000
      or jsonb_typeof(item->'stakeCents') is distinct from 'number'
      or jsonb_typeof(item->'payoutCents') is distinct from 'number'
      or coalesce(item->>'stakeCents','') !~ '^[0-9]{1,15}$'
      or coalesce(item->>'payoutCents','') !~ '^[0-9]{1,15}$'
      or ((item->>'stakeCents')::bigint = 0 and (item->>'payoutCents')::bigint = 0)
      or (coalesce(item->>'time','') <> '' and coalesce(item->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      or (item->>'kind' = 'game' and coalesce(item->>'time','') = '')
      or (item->>'rounds' is not null and (jsonb_typeof(item->'rounds') is distinct from 'number' or coalesce(item->>'rounds','') !~ '^[0-9]{1,7}$' or (item->>'rounds')::integer not between 1 and 1000000))
      or (item->>'kind' = 'scratch' and (coalesce(item->>'ticketPriceCents','') !~ '^[0-9]{1,15}$'
        or coalesce(item->>'ticketCount','') !~ '^[0-9]{1,5}$'
        or jsonb_typeof(item->'ticketPriceCents') is distinct from 'number'
        or jsonb_typeof(item->'ticketCount') is distinct from 'number'
        or (item->>'ticketCount')::integer not between 1 and 10000
        or (item->>'ticketPriceCents')::bigint * (item->>'ticketCount')::integer <> (item->>'stakeCents')::bigint))
      then return false; end if;
    foreach side in array array['stake','payout'] loop
      link_id := item->>(side || 'TransactionId');
      amount_text := item->>(case when side = 'stake' then 'stakeCents' else 'payoutCents' end);
      needed_type := case when side = 'stake' then 'Expense' else 'Income' end;
      needed_status := case when side = 'stake' then 'Paid' else 'Received' end;
      if amount_text = '0' then
        if link_id is not null then return false; end if;
      else
        if coalesce(length(link_id),0) not between 1 and 120 or link_id = any(used_links) then return false; end if;
        used_links := array_append(used_links, link_id);
        select value into tx from jsonb_array_elements(doc->'transactions') where value->>'id' = link_id limit 1;
        if tx is null or tx->>'type' <> needed_type or tx->>'status' <> needed_status
          or tx->>'amountCents' <> amount_text
          or (side = 'payout' and tx ? 'paydayCycle')
          or (link_id = ('gambling:' || (item->>'id') || ':' || side)
            and (tx->>'gamblingEntryId') is distinct from (item->>'id'))
          then return false; end if;
      end if;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.budget_documents add constraint budget_gambling_extension_valid
  check (public.valid_gambling_extension(data)) not valid;
alter table public.budget_documents validate constraint budget_gambling_extension_valid;

create function public.sync_gambling_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.gambling_entries
    where user_id = new.user_id and id not in
      (select value->>'id' from jsonb_array_elements(coalesce(new.data->'gambling'->'entries', '[]'::jsonb)));
  insert into public.gambling_entries (
    user_id, id, kind, activity_date, payout_date, activity_time, name, subcategory, platform,
    ticket_price_cents, ticket_count, rounds, stake_cents, payout_cents, notes,
    stake_transaction_id, payout_transaction_id
  ) select new.user_id, value->>'id', value->>'kind', (value->>'date')::date,
    (value->>'payoutDate')::date,
    nullif(value->>'time','')::time, value->>'name', coalesce(value->>'subcategory',''),
    coalesce(value->>'platform',''), (value->>'ticketPriceCents')::bigint,
    (value->>'ticketCount')::integer, (value->>'rounds')::integer,
    (value->>'stakeCents')::bigint, (value->>'payoutCents')::bigint,
    coalesce(value->>'notes',''), value->>'stakeTransactionId', value->>'payoutTransactionId'
    from jsonb_array_elements(coalesce(new.data->'gambling'->'entries', '[]'::jsonb))
  on conflict (user_id, id) do update set
    kind = excluded.kind, activity_date = excluded.activity_date, payout_date = excluded.payout_date, activity_time = excluded.activity_time,
    name = excluded.name, subcategory = excluded.subcategory, platform = excluded.platform,
    ticket_price_cents = excluded.ticket_price_cents, ticket_count = excluded.ticket_count,
    rounds = excluded.rounds, stake_cents = excluded.stake_cents, payout_cents = excluded.payout_cents,
    notes = excluded.notes, stake_transaction_id = excluded.stake_transaction_id,
    payout_transaction_id = excluded.payout_transaction_id, updated_at = now()
  where (public.gambling_entries.kind, public.gambling_entries.activity_date, public.gambling_entries.payout_date, public.gambling_entries.activity_time,
    public.gambling_entries.name, public.gambling_entries.subcategory, public.gambling_entries.platform,
    public.gambling_entries.ticket_price_cents, public.gambling_entries.ticket_count, public.gambling_entries.rounds,
    public.gambling_entries.stake_cents, public.gambling_entries.payout_cents, public.gambling_entries.notes,
    public.gambling_entries.stake_transaction_id, public.gambling_entries.payout_transaction_id)
    is distinct from
    (excluded.kind, excluded.activity_date, excluded.payout_date, excluded.activity_time, excluded.name, excluded.subcategory,
    excluded.platform, excluded.ticket_price_cents, excluded.ticket_count, excluded.rounds,
    excluded.stake_cents, excluded.payout_cents, excluded.notes,
    excluded.stake_transaction_id, excluded.payout_transaction_id);
  return new;
end;
$$;
create trigger sync_gambling_entries_after_budget_write
  after insert or update of data on public.budget_documents
  for each row execute function public.sync_gambling_entries();

revoke all on function public.valid_gambling_extension(jsonb) from public;
revoke all on function public.sync_gambling_entries() from public;
