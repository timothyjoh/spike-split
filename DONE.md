# Split — DONE

Group expense splitter with settle-up. Real Express + better-sqlite3 backend, vanilla-JS UI, all on **port 3001**. Built and verified across 4 vertical milestones; every gate passed fail-closed (no false greens).

## What shipped
- **Domain core** (`src/domain.ts`): pure `computeBalances` (paid − owed, integer cents, balances sum to exactly 0; throws on non-integer cents), `settleUp` (greedy max-creditor/max-debtor, minimal txns ≤ n−1), `equalSplit` (remainder-cent distribution so splits sum exactly). Money is integer cents everywhere — no floats.
- **SQLite persistence** (`src/db.ts`): `openDb(path)` creates the schema on boot (`group`/`member`/`expense`/`expense_split`), WAL + foreign_keys, `split_type IN ('equal','exact')` CHECK. Data survives restart (covered by a persistence round-trip test). Tests use a temp db; `*.db` is gitignored. Server db path overridable via `DB_PATH` (default `./data/split.db`).
- **REST API** (`src/repo.ts`, `src/api.ts`): `createApp(db)` factory (port-free, supertest-injectable) with:
  - `POST /api/groups`, `POST /api/groups/:groupId/members`
  - `POST /api/groups/:groupId/expenses` — equal split (expanded via `equalSplit`) AND exact split (validated to sum to the amount, else 400)
  - `GET /api/groups/:groupId/balances`, `GET /api/groups/:groupId/settle-up`
  - Typed errors → 400 (validation) / 404 (unknown group/member).
- **Minimal UI** (`public/index.html`, `public/app.js`): served by the same Express server. Create group → add members → add expense (dollars → cents) → view balances (formatted +/-$) → view settle-up plan. Stable element ids for automation.
- **E2E** (`playwright.config.ts`, `e2e/split.spec.ts`): Playwright/Chromium drives the full Definition-of-Done flow against the real server (Playwright boots `npm start` on 3001).

## Test counts (all executed > 0, fail-closed gates)
- Unit (domain): **13 passed**.
- Integration (API via supertest, temp sqlite): **19 passed**. Combined `npm test`: **32/32**.
- E2E (`npm run e2e`, Chromium, full flow): **1/1 passed**.
- **Browser VERIFY** (cyc-tester, real Chromium): **PASS**. Created group → 3 members → 2 expenses ($90 + $30 equal split of 3) → balances **Alice +$50.00 / Bob -$10.00 / Carol -$40.00** (sum 0) → settle-up **Carol pays Alice $40.00 / Bob pays Alice $10.00** (2 txns, zeroes everyone). No console/page/network errors. Proof screenshot: `test-artifacts/03-settleup.png`.

## How to run
```
npm install
npm start            # server + UI at http://localhost:3001
npm test             # unit + integration (vitest)
npm run e2e          # Playwright e2e (auto-boots the server)
```

## Blocked
None — all 4 milestones done.

## Notes
- `dev`/`start` build via `tsc` then run `node dist/src/server.js` (Node 25's `--experimental-strip-types` can't resolve `.js` ESM imports from `.ts` source, so the compiled run is used for reliability).
- Gitignored: `node_modules/`, `dist/`, `*.db`, `test-artifacts/`, `test-results/`, `playwright-report/`, `data/`.
