# Split — group expense splitter with settle-up

Track shared group expenses and compute the **minimal set of payments** to settle
all debts. Real backend with **SQLite** persistence + a minimal web UI.

## Stack (required)
- Node + **Express** (or Fastify) + TypeScript.
- Persistence: **better-sqlite3** (file db; create schema on boot).
- Frontend: minimal vanilla TS + `fetch` (served by the same server or via Vite).
- Unit/integration: **vitest** (+ supertest for API). E2E: **Playwright** (Chromium).
- Server MUST listen on **port 3001**.

## Core domain
- `group`, `member`, `expense (payer, amount_cents, split_among[])`.
- **Balances**: per member, sum paid − sum owed (equal split + exact-amount split).
- **Settle-up**: greedy debt-minimization → minimal list of `{from, to, amount}`
  transactions that zero out all balances.

## Acceptance criteria
1. **REST API**: create group; add member; add expense (equal split AND exact-amount
   split); GET balances; GET settle-up suggestions.
2. **SQLite persistence** via better-sqlite3; schema created/migrated on boot; data
   survives restart. Use a separate temp db file for tests.
3. **Correctness**: balances sum to zero; settle-up transactions are minimal and zero
   out every member.
4. **Minimal UI**: create group, add members, add an expense, view balances + the
   settle-up plan.

## Required tests
- **Unit** (`npm test`): balance computation + settle-up algorithm across several
  debt graphs (incl. 3+ members, uneven splits); assert correctness + minimality.
- **Integration**: API endpoints via supertest against a temp sqlite db.
- **E2E** (`npm run e2e`): create group → add 3 members → add 2 expenses → view
  balances → view settle-up plan.

## npm scripts expected
`dev`/`start` (server on 3001), `build`, `test` (vitest run), `e2e` (playwright).

## Definition of done
App builds, unit + integration + e2e pass with `executed > 0`, and the **tester
subagent** drives real Chrome through create-group→add-expense→view-settle-up and
returns PASS with a screenshot of the settle-up plan. No false greens.
