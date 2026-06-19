# Split — build status

**Project:** group expense splitter with settle-up (Express + better-sqlite3 + vanilla TS UI, port 3001)

## Milestones
| id | title | state |
|----|-------|-------|
| m1 | Scaffold + domain core (schema, balances, settle-up algorithm, unit tests) | todo |
| m2 | REST API (group/member/expense/balances/settle-up) + integration tests | todo |
| m3 | Minimal UI (create group, members, expense, balances, settle-up plan) | todo |
| m4 | E2E Playwright flow + browser verify | todo |

## Current
Starting m1 — PLAN.

## Gates (fail-closed)
Unit AND integration AND e2e must execute>0 and pass; tester subagent must drive real Chrome through create-group→add-expense→view-settle-up and return PASS + screenshot before any milestone is "done".
