# MILESTONE m1 — Scaffold + Domain Core

## Scope
Project scaffold, SQLite schema, pure domain functions, unit tests. No HTTP server. No UI.

---

## Files to Create

```
spike-split/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── db.ts
│   └── domain.ts
└── tests/
    └── domain.test.ts
```

---

## 1. package.json

```json
{
  "name": "spike-split",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch --experimental-strip-types src/server.ts",
    "start": "node dist/server.js",
    "build": "tsc",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0",
    "supertest": "^7.0.0"
  }
}
```

Note: `@playwright/test` added as devDependency; `e2e` script points at `playwright.config.ts` (stub added in m3). Install all deps now so later milestones are unblocked.

---

## 2. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

---

## 3. vitest.config.ts

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

---

## 4. src/db.ts — SQLite connection factory

### Schema DDL

```sql
CREATE TABLE IF NOT EXISTS "group" (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES "group"(id),
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id         INTEGER NOT NULL REFERENCES "group"(id),
  payer_member_id  INTEGER NOT NULL REFERENCES member(id),
  amount_cents     INTEGER NOT NULL,          -- always integer cents, never float
  split_type       TEXT NOT NULL CHECK(split_type IN ('equal', 'exact')),
  description      TEXT
);

CREATE TABLE IF NOT EXISTS expense_split (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id   INTEGER NOT NULL REFERENCES expense(id),
  member_id    INTEGER NOT NULL REFERENCES member(id),
  amount_cents INTEGER NOT NULL               -- cents this member owes for this expense
);
```

### API

```ts
import Database from "better-sqlite3";

/** Returns an open DB connection with schema applied. */
export function openDb(filePath: string = "./data/split.db"): Database.Database;
```

- Runs all four `CREATE TABLE IF NOT EXISTS` statements on open.
- Tests pass a temp path (e.g. ``:memory:`` or a tmpdir file) — no global state.
- WAL mode enabled for concurrency headroom.

---

## 5. src/domain.ts — Pure domain types and functions

### TypeScript types

```ts
export type Member = {
  id: number;
  name: string;
};

export type Split = {
  memberId: number;
  amountCents: number;   // exact cents this member owes
};

export type Expense = {
  id: number;
  payerMemberId: number;
  amountCents: number;   // total, integer cents
  splitType: "equal" | "exact";
  splits: Split[];       // populated by caller from expense_split rows
};

export type Balance = {
  memberId: number;
  netCents: number;      // positive = owed money, negative = owes money
};

export type Transaction = {
  from: number;          // memberId who pays
  to: number;            // memberId who receives
  amountCents: number;   // always positive
};
```

### computeBalances

```ts
export function computeBalances(
  members: Member[],
  expenses: Expense[]
): Balance[];
```

**Algorithm:**
1. Init `paid[memberId] = 0` and `owed[memberId] = 0` for every member.
2. For each expense:
   - `paid[expense.payerMemberId] += expense.amountCents`
   - For each split in `expense.splits`: `owed[split.memberId] += split.amountCents`
3. `netCents = paid[m] - owed[m]` per member.
4. Return array of `{ memberId, netCents }`.

**Equal-split remainder strategy (for use when building splits before calling computeBalances):**
- `base = Math.floor(amountCents / n)` where n = number of split_among members.
- `remainder = amountCents - base * n`
- First `remainder` members each get `base + 1` cents; the rest get `base` cents.
- This guarantees `sum(splits) === amountCents` exactly, with no rounding loss.

Note: `computeBalances` is pure — it operates on pre-built `Split[]` arrays. The caller (API layer, m2) is responsible for expanding an `equal` expense into exact splits using the above strategy before inserting into `expense_split` and before calling `computeBalances`. The domain function itself does not re-derive splits from `splitType`.

**Invariant:** `sum(balances.map(b => b.netCents)) === 0` always (since total paid === total owed across a group).

### settleUp

```ts
export function settleUp(balances: Balance[]): Transaction[];
```

**Algorithm (greedy max-creditor/max-debtor):**
1. Separate into `creditors` (netCents > 0) and `debtors` (netCents < 0).
2. Sort creditors descending by netCents; sort debtors ascending (most negative first).
3. While both lists are non-empty:
   a. Take largest creditor C and largest debtor D (most negative).
   b. `amount = Math.min(C.netCents, Math.abs(D.netCents))`.
   c. Emit `{ from: D.memberId, to: C.memberId, amountCents: amount }`.
   d. Reduce C.netCents by amount; reduce D.netCents (add amount, toward 0).
   e. Remove any entry that reaches 0.
4. Return transaction list.

**Property:** transaction count ≤ n − 1 (where n = number of members with non-zero balance), which is the theoretical minimum for a greedy pass.

---

## 6. tests/domain.test.ts — Unit test cases

### Test suite outline (vitest)

#### computeBalances

| Test | Description |
|------|-------------|
| TC-B1 | Two members, one pays, equal split → payer +50, other −50 |
| TC-B2 | Three members, one pays $90, split equally → payer +60 (net), others −30 each; sum = 0 |
| TC-B3 | Exact split: payer pays $100, splits [70, 30] among two → balances match exact amounts |
| TC-B4 | Multiple expenses across members → cumulative balances, sum = 0 |
| TC-B5 | Equal split with remainder: $10 across 3 members → splits are [4,3,3] cents, sum = 10 |
| TC-B6 | All members pay and owe → net balance sum always exactly 0 (property-style assertion) |

#### settleUp

| Test | Description |
|------|-------------|
| TC-S1 | Two members, one owes other → single transaction |
| TC-S2 | Three members: A owes B $30, A owes C $20 → two transactions, A pays both |
| TC-S3 | Three members with complex graph → txn count ≤ 2 (n−1) |
| TC-S4 | All balances zero → empty transaction list |
| TC-S5 | settleUp result zeroes all balances (simulate applying transactions and re-check) |
| TC-S6 | Four members, chain debt → minimality assertion (≤ 3 txns) |

### Explicit assertions per test
- `balances.reduce((s, b) => s + b.netCents, 0) === 0`
- After applying all transactions: every member's running balance === 0
- `transactions.length <= nonZeroMembers - 1`

---

## Implementation notes

- **No floats anywhere.** All monetary values are `number` typed but must be integer cents. Add a runtime guard in `computeBalances` that throws if any `amountCents` is not `Number.isInteger`.
- `db.ts` uses `better-sqlite3` synchronous API — no async needed.
- `domain.ts` has zero imports — fully pure, no Node/DB dependencies — making it trivially fast to test.
- The `e2e` npm script can point at a `playwright.config.ts` that does not yet exist; vitest-only `npm test` must pass in m1.
- Port 3001 is reserved for m2's Express server; nothing in m1 starts a network listener.

---

## Completion criteria for m1
- [ ] `npm install` succeeds with all listed deps
- [ ] `npm test` runs `tests/domain.test.ts` and all TC-B* + TC-S* pass with `executed > 0`
- [ ] No floats in any test assertion or production code path
- [ ] `balances.sum === 0` asserted in every balance test
- [ ] `settleUp` zeroes every member verified by simulation in TC-S5
