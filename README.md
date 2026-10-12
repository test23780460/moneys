# Northstar — Personal Budget

Northstar is a dark, spreadsheet-style budget app for paychecks, expenses, weekly plans, recurring bills, savings goals, and financial trends. The frontend stays on [GitHub Pages](https://test23780460.github.io/moneys/). It can run locally without an account or connect to Supabase for private accounts and cross-device synchronization.

## Use

Open the live site, add a paycheck or expense with **Quick add**, and use the ledger for editing, filtering, CSV import/export, and spreadsheet paste. Settings contains JSON backup/restore, category and currency preferences, and account controls when Supabase is configured.

**Weekly Payday Check-In** opens at the configured weekday and local time (Wednesday at 6:00 PM by default) for signed-in accounts. It also detects an unrecorded payday when the app opens later. The top-bar payday button and the weekly budget page open it manually; the date field can backfill an earlier payday. Enter actual take-home pay to preview upcoming bills, optional sinking fund reserves, category allocation rules, savings, and remaining money. The preview never marks a bill paid or transfers savings. **Remind me later** defers the automatic prompt for four hours; **Skip this week** suppresses that cycle. Settings can change the weekday, time, IANA time zone, automatic prompts, and fixed/percentage allocation rules with priority order. Recurring bills have an optional number of paychecks for sinking fund planning. Existing hand-entered weekly allocations remain untouched. The feature uses in-app prompts, not browser push notifications.

**Gambling Tracker** records scratch-offs, paid game sessions, and other wagers. Enter the amount spent and the **gross payout actually received**, including returned stake. Net result is gross payout minus amount spent. The tracker adds one paid expense and one received income row to the main ledger for each nonzero side, or you can link an existing confirmed row of the exact amount to avoid double-counting. The payout date can differ from the wager date. Linked rows remain in the ledger if a tracker entry is deleted; rows created by the tracker are removed with it. Edit linked amounts through the tracker. Account deposits and transfers are not wagers. The optional weekly/monthly spending limit measures stakes alone and is never offset by winnings. Tracker history supports search, sorting, date ranges, edits, deletion, and CSV export. JSON backup includes the tracker.

The published site starts with no personal financial records. Never commit real records or credentials to this repository.

## Architecture

- `src/finance.js`: integer-cent calculations and date rules.
- `src/payday.js`: time-zone-aware payday cycles, reminder eligibility, idempotent paycheck records, bill reserve and allocation recommendations, and paycheck history.
- `src/gambling.js`: integer-cent gambling results, spending limits, ledger links, and CSV export.
- `src/storage.js`: IndexedDB cache plus a write-through browser snapshot. Guest and signed-in caches have separate keys.
- `src/cloud.js`: Supabase Auth, a Realtime subscription, periodic/online retries, optimistic revision writes, and conflict handling.
- `src/merge.js`: three-way merge by transaction/bill/goal ID and by budget cell. Two devices can add different records without duplicating them. If both edit the same field or record differently, the app asks which edits to keep.
- `supabase/migrations/`: PostgreSQL tables, per-user Row Level Security, validated versioned document writes, profile creation, Realtime publication, payday validation, and a gambling-entry table mirrored atomically from each budget document.
- `supabase/functions/delete-account/index.ts`: authenticated deletion of the Auth user and cascading budget data. The privileged key stays inside Supabase Edge Functions.
- `supabase/verify_rls.sql`: rollback-only checks for owner access, cross-user isolation, document validation, and denied direct writes.

The financial document is the cloud source of truth for a signed-in account. Its JSONB schema matches the app state: transactions include income, expenses, bill payments, and savings transfers; bills store schedules; goals store movements; `allocations` and `payPlans` store weekly budgets; `payday` stores the schedule, allocation rules, and per-cycle check-in status; `gambling` stores entries and the spending limit; categories and settings are included. Paycheck records use stable `payday:YYYY-MM-DD` IDs so retrying or editing a cycle updates one transaction. Monthly views and totals are derived from dated transactions rather than stored twice. A revision number protects every write from overwriting concurrent changes. The server validates document shape, cents, statuses, dates, ID uniqueness, and size. PostgreSQL RLS limits reads to the authenticated owner; direct browser writes are revoked and go through a user-bound save function.

## Offline and migration behavior

Signed-in edits save to a user-specific browser cache first, then retry when online. **Synced** appears only after the PostgreSQL write succeeds. **Offline**, **Saving**, **Sync error**, and **Sync conflict** show other states. Realtime notifications and a periodic check pull changes from another device. The client merges independent changes and asks before resolving overlapping edits. Pending edits are retained locally when a request fails.

On first sign-in, existing guest records remain untouched. The app offers a review of their counts and sample transactions. Import adds unseen record IDs to the account, verifies the returned cloud document, then marks that import complete for the account. Repeated imports skip existing IDs. Guest records are retained until the user deletes them explicitly. Download a JSON backup before importing if you need a separate copy.

Browser caches and Supabase Auth sessions are stored in the browser profile; the cache is **not encrypted by this app**. Use a private browser profile on shared devices. Supabase cloud storage is synchronization, not an independent disaster-recovery backup. Download JSON backups regularly. This app does not connect to banks.

## Local development

Install Node.js 22 or later, then:

```sh
npm ci
npm test
npm run dev
```

Open `http://127.0.0.1:8000`. The default build has no cloud configuration and keeps the existing local mode. To test against an actual Supabase project, provide `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when running `npm run build` and then run `node scripts/serve.mjs`. The build rejects secret/service-role keys. The publishable key is intentionally browser-visible; RLS is the security boundary.

## Supabase deployment

1. Create a dedicated Supabase project. Enable Email Auth with confirmation, set its Site URL to `https://test23780460.github.io/moneys/`, and allow that exact redirect URL for email confirmation and password recovery.
2. Apply the migration in `supabase/migrations/` with Supabase CLI (`supabase link --project-ref <ref>` then `supabase db push`) or the project's SQL editor. Run migrations before enabling the cloud frontend. The migration creates no sample financial records.
3. Deploy `supabase/functions/delete-account` with the Supabase CLI or Dashboard. Keep the service-role/secret key in Supabase's function environment only.
4. Set GitHub repository **Actions variables** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the project's HTTPS URL and its publishable key. Do not use GitHub secrets for these public browser values. Never put a secret/service-role key in these variables.
5. Push to `main`. `.github/workflows/pages.yml` runs `npm ci`, tests, builds, and deploys to GitHub Pages. Future frontend pushes deploy automatically.

The NorthStar project `qywomqsrelqgqddfofoa` has the original backend migrations and the Edge Function deployed. The payday migration is already live. Apply the gambling migration before publishing its frontend. Its URL and publishable key are set as GitHub Actions variables. Supabase's default mail service only sends to members of the Supabase organization, so **configure custom SMTP before offering registration or password reset to other addresses**. Keep email confirmation enabled. Account deletion requires the Edge Function to remain deployed. The database password is never needed by the browser or GitHub Pages.

## Security checks before using real finances

Run `npx supabase db query --linked --file supabase/verify_rls.sql` to verify owner reads, cross-user isolation, valid document saves, and denied direct writes without leaving test records behind. Anonymous REST reads and unsigned account-deletion calls should also be rejected. Before using real finances, complete an end-to-end email confirmation, password reset, offline/reconnect, local import, account deletion, and second-device sign-in with a test account. Local unit tests cover financial calculations and merge behavior.
