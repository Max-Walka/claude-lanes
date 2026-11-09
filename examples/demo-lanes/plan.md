# Acme storefront: checkout on the new API

Goal: checkout, search and order history run on the new API by **30 Jan**. Anything that slips stays on the old pages, linked from the new shell.

Repo: `~/code/acme-storefront` (the coordinator's folder, kept on `main`).
Lanes work in their own worktrees.

## Lanes and queues (top item = now)

### Lane A: checkout
1. Payment step on the new API (#212, #215).
2. Order confirmation page.
3. Saved cards.

### Lane B: search
1. Search results on the new index (#209).
2. Filters and sorting.
3. Typo tolerance.

### Lane C: API
1. Orders endpoint (#214).
2. Rate limits on the public routes.
3. Remove the old cart service.

## Shared files (claim on your status file and tell the other lanes first)
`src/app/nav.ts`, `src/api/routes.ts`, `package.json`.

## Merge order
Shared-file PRs first, then the largest, then the rest rebased onto main.

## Decisions log (newest first, one line each)
- 14 Jan: card payments go through the new API only; the old form stays for wallets until February.
- 12 Jan: plan set up.
