-- Run with: npx supabase db query --linked --file supabase/verify_rls.sql
-- All test rows are rolled back, including the two synthetic Auth users.
begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select public.save_budget_document(0, jsonb_build_object(
  'version', 1,
  'transactions', jsonb_build_array(
    jsonb_build_object('id','payday:2026-10-14','date','2026-10-14','paydayCycle','2026-10-14','type','Income',
      'status','Received','amountCents',250000,'category','Food','description','Test paycheck'),
    jsonb_build_object('id','expense-1','date','2026-10-11','type','Expense',
      'status','Paid','amountCents',1250,'category','Food','description','Test expense')
  ),
  'bills', jsonb_build_array(
    jsonb_build_object('id','bill-1','nextDue','2026-11-11','amountCents',9500,
      'frequency','Monthly','category','Bills','name','Test bill','sinkingPaychecks',4)
  ),
  'goals', jsonb_build_array(
    jsonb_build_object('id','goal-1','targetCents',100000,'name','Test goal',
      'movements',jsonb_build_array(jsonb_build_object('id','movement-1',
        'date','2026-10-11','amountCents',5000)))
  ),
  'categories', jsonb_build_array('Food'),
  'allocations', jsonb_build_object(),
  'payPlans', jsonb_build_object(),
  'payday', jsonb_build_object('weekday',3,'time','18:00','timeZone','America/New_York',
    'autoPrompt',true,'rules',jsonb_build_array(jsonb_build_object(
      'category','Food','mode','percent','value',12.5,'priority',1)),
    'checkins',jsonb_build_object('2026-10-14',jsonb_build_object(
      'status','completed','transactionId','payday:2026-10-14'))),
  'settings', jsonb_build_object('currency', 'USD', 'weekStarts', 1, 'startingBalanceCents', 0),
  'createdAt', '2026-10-11'
));

do $$
begin
  if (select count(*) from public.budget_documents) <> 1 then
    raise exception 'owner cannot read own budget';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'owner cannot read own profile';
  end if;
  if has_table_privilege('authenticated', 'public.budget_documents', 'INSERT')
    or has_table_privilege('authenticated', 'public.budget_documents', 'UPDATE')
    or has_table_privilege('authenticated', 'public.budget_documents', 'DELETE') then
    raise exception 'direct budget writes are permitted';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);

do $$
begin
  if (select count(*) from public.budget_documents) <> 0 then
    raise exception 'second user can read the first budget';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'second user can read another profile';
  end if;
end;
$$;

rollback;

select count(*) as test_users_remaining from auth.users
where id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
