# Split — build status

**Project:** group expense splitter with settle-up (Express + better-sqlite3 + vanilla TS/JS UI, port 3001)

## Milestones
| id | title | state |
|----|-------|-------|
| m1 | Scaffold + domain core (schema, balances, settle-up algorithm, unit tests) | done |
| m2 | REST API (group/member/expense/balances/settle-up) + integration tests | done |
| m3 | Minimal UI (create group, members, expense, balances, settle-up plan) | done |
| m4 | E2E Playwright flow + browser verify | done |

## Current
ALL MILESTONES DONE. See DONE.md.

## Gates (all passed, fail-closed)
- Unit (vitest domain): 13/13.
- Integration (supertest + temp sqlite): 19/19. Total `npm test` 32/32, executed>0.
- E2E (`npm run e2e`, Playwright Chromium, full DoD flow): 1/1, executed>0.
- Browser VERIFY (cyc-tester, real Chromium): PASS — balances +$50/-$10/-$40, settle-up 2 txns, screenshot at test-artifacts/03-settleup.png.

## How to run
- `npm install`
- `npm start` → server + UI at http://localhost:3001
- `npm test` → unit + integration
- `npm run e2e` → Playwright e2e (boots server automatically)
