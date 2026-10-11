# Northstar — Personal Budget

A private, local-first personal finance app for tracking paychecks, spending, weekly plans, bills, and savings goals. The published site starts empty: no personal transactions are included in this repository.

## Use

Open the [live site](https://test23780460.github.io/moneys/), then add a paycheck or expense with **Quick add**. The Transactions page provides an editable ledger with search, filters, sorting, CSV import and export, and spreadsheet paste. The Weekly Budget page shows received income history, optional expected-pay plans, category allocations, and a way to copy last week's plan. Schedule recurring bills and create savings goals from the sidebar.

All data is stored in **IndexedDB in your current browser profile**, with a localStorage write-through snapshot so immediate refreshes retain recent edits. It survives normal refreshes and browser restarts, but does not sync between devices. Use **Settings → Download JSON backup** regularly, especially before clearing browser data or changing devices. Restore from the same page. Browser local data is not encrypted by this app.

## Development

This is a dependency-free static app. Run the financial tests and build the publishable `dist/` folder with:

```sh
npm test
npm run build
```

Serve the repository with any static file server, for example:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. ES modules require HTTP; opening `index.html` directly from disk is not supported.

## Deployment

Pushes to `main` run `.github/workflows/pages.yml`, which uploads the site and deploys it to GitHub Pages. The workflow uses no third-party actions beyond official GitHub Actions. GitHub Pages must be configured to use **GitHub Actions** as its source.

## Privacy and calculations

- All monetary amounts are stored as integer cents.
- Only received income and paid expenses affect actual financial totals.
- Pending transactions and planned allocations are forecasts, not cash movement.
- Savings transfers are separate from expenses.
- Recording a bill payment creates one ledger expense and advances its due date.
- The app has no account or bank connection and sends no financial records to a server.

See the in-app Settings page for backup, restore, currency, and week start preferences.
