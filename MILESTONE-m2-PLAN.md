# Milestone m2 — REST API + Integration Tests

## Goal
Add `src/repo.ts`, `src/api.ts`, a real `src/server.ts`, and `tests/api.test.ts`.
No UI (m3). No new domain logic — consume existing `domain.ts` only.

---

## Files

| File | Action |
|---|---|
| `src/repo.ts` | New — data-access layer over `Database.Database` |
| `src/api.ts` | New — Express app factory |
| `src/server.ts` | Replace placeholder — real entrypoint |
| `tests/api.test.ts` | New — supertest integration tests |

---

## src/repo.ts

### Imports
```ts
import Database from "better-sqlite3";
import type { Member, Expense, Split } from "./domain.js";
import { equalSplit } from "./domain.js";
```

### Types (local to repo or re-exported)
```ts
export type AddExpenseInput = {
  payerMemberId: number;
  amountCents: number;
  splitType: "equal" | "exact";
  splitAmong?: number[];        // member ids; required when splitType === "equal"
  exactSplits?: { memberId: number; amountCents: number }[]; // required when splitType === "exact"
  description?: string;
};
```

### Functions

#### `createGroup(db, name: string): { id: number; name: string }`
```ts
const row = db.prepare(`INSERT INTO "group" (name) VALUES (?) RETURNING id, name`).get(name);
return row as { id: number; name: string };
```

#### `addMember(db, groupId: number, name: string): { id: number; name: string; groupId: number }`
- Verify group exists first: `SELECT id FROM "group" WHERE id = ?` — throw `NotFoundError` if missing.
- Insert: `INSERT INTO member (group_id, name) VALUES (?, ?) RETURNING id, name`.
- Return `{ id, name, groupId }`.

#### `addExpense(db, groupId: number, input: AddExpenseInput): Expense`
Validation (throw `ValidationError` with message on failure):
- `amountCents` must be a positive integer.
- Group must exist (else `NotFoundError`).
- `payerMemberId` must belong to group (else `NotFoundError`).
- If `splitType === "equal"`: `splitAmong` must be a non-empty array of member ids all belonging to the group.
- If `splitType === "exact"`: `exactSplits` must be non-empty; all member ids must belong to group; `sum(exactSplits[].amountCents)` must equal `amountCents` exactly (else `ValidationError("exact splits sum …")`).

Split expansion:
- `equal` → call `equalSplit(amountCents, splitAmong)` from domain — produces `Split[]`.
- `exact` → use `exactSplits` array directly as `Split[]`.

Persistence (inside a `db.transaction()`):
```sql
INSERT INTO expense (group_id, payer_member_id, amount_cents, split_type, description)
VALUES (?, ?, ?, ?, ?) RETURNING id, ...

-- for each Split:
INSERT INTO expense_split (expense_id, member_id, amount_cents) VALUES (?, ?, ?)
```

Return: `Expense` (with `splits` populated).

#### `getGroupMembers(db, groupId: number): Member[]`
- Verify group exists (else `NotFoundError`).
- `SELECT id, name FROM member WHERE group_id = ? ORDER BY id`.

#### `getGroupExpenses(db, groupId: number): Expense[]`
- Verify group exists (else `NotFoundError`).
- Fetch expenses: `SELECT * FROM expense WHERE group_id = ? ORDER BY id`.
- Fetch all splits in one query: `SELECT * FROM expense_split WHERE expense_id IN (…)`.
- Build `Expense[]` with `splits` populated (group splits by `expense_id`).

### Error types
```ts
export class NotFoundError extends Error { constructor(msg: string) { super(msg); this.name = "NotFoundError"; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = "ValidationError"; } }
```

---

## src/api.ts

### Factory signature
```ts
import type Database from "better-sqlite3";
import express from "express";

export function createApp(db: Database.Database): express.Express
```

### Middleware
- `express.json()` — body parsing.
- 404 fallback handler at bottom.
- Error handler: catches `ValidationError` → 400 `{ error: message }`, `NotFoundError` → 404 `{ error: message }`, else → 500 `{ error: "internal error" }`.

### Routes

#### `POST /api/groups`
Request body: `{ name: string }`

Validation: `name` must be a non-empty string → 400 if missing/blank.

Success → **201**:
```json
{ "id": 1, "name": "Weekend Trip" }
```

#### `POST /api/groups/:groupId/members`
Request body: `{ name: string }`

Path: `:groupId` parsed as integer; non-integer → 400 `{ error: "invalid groupId" }`.

Validation: `name` non-empty string → 400.

Success → **201**:
```json
{ "id": 1, "name": "Alice", "groupId": 42 }
```

Group not found → 404.

#### `POST /api/groups/:groupId/expenses`
Request body:
```json
{
  "payerMemberId": 1,
  "amountCents": 3000,
  "splitType": "equal",
  "splitAmong": [1, 2, 3],
  "description": "Dinner"
}
```
or:
```json
{
  "payerMemberId": 1,
  "amountCents": 3000,
  "splitType": "exact",
  "exactSplits": [
    { "memberId": 1, "amountCents": 1000 },
    { "memberId": 2, "amountCents": 2000 }
  ]
}
```

Validation:
- `payerMemberId` integer required.
- `amountCents` positive integer required.
- `splitType` ∈ `["equal", "exact"]` required.
- `equal`: `splitAmong` non-empty integer array required.
- `exact`: `exactSplits` non-empty array of `{memberId, amountCents}` required; sum must equal `amountCents`.

Success → **201**:
```json
{
  "id": 7,
  "payerMemberId": 1,
  "amountCents": 3000,
  "splitType": "equal",
  "description": "Dinner",
  "splits": [
    { "memberId": 1, "amountCents": 1000 },
    { "memberId": 2, "amountCents": 1000 },
    { "memberId": 3, "amountCents": 1000 }
  ]
}
```

Group/member not found → 404. Validation error → 400.

#### `GET /api/groups/:groupId/balances`
Calls `getGroupMembers`, `getGroupExpenses`, then `computeBalances`.

Success → **200**:
```json
[
  { "memberId": 1, "name": "Alice", "netCents": 2000 },
  { "memberId": 2, "name": "Bob",   "netCents": -1000 },
  { "memberId": 3, "name": "Carol", "netCents": -1000 }
]
```

Note: join member name into each balance entry (build a `Map<id, name>` from `getGroupMembers`).

Group not found → 404.

#### `GET /api/groups/:groupId/settle-up`
Calls `getGroupMembers`, `getGroupExpenses`, `computeBalances`, then `settleUp`.

Success → **200**:
```json
[
  { "from": 2, "fromName": "Bob", "to": 1, "toName": "Alice", "amountCents": 1000 },
  { "from": 3, "fromName": "Carol", "to": 1, "toName": "Alice", "amountCents": 1000 }
]
```

Include `fromName`/`toName` (looked up from member map).

Group not found → 404.

---

## src/server.ts

```ts
import path from "node:path";
import fs from "node:fs";
import { openDb } from "./db.js";
import { createApp } from "./api.js";

const DB_PATH = process.env.DB_PATH ?? "./data/split.db";
const PORT = Number(process.env.PORT ?? 3001);

// Ensure data dir exists
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = openDb(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`split server listening on port ${PORT}`);
});
```

`npm run dev` / `npm start` both invoke this. `--watch` flag for dev via `tsx watch`.

---

## tests/api.test.ts

### Test setup strategy
- Each test file (`api.test.ts`) uses a **single shared temp db** for the whole file; created once in `beforeAll`, removed in `afterAll`.
- Temp path: `path.join(os.tmpdir(), "split-test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".db")`.
- `app = createApp(openDb(tmpPath))` — no port binding; used via `supertest(app)`.
- Add `*.db` to `.gitignore`.

### Test cases

#### 1. `POST /api/groups` — create group
- Body `{ name: "Test Group" }` → 201, body has `id` (number) and `name === "Test Group"`.
- Body `{ name: "" }` → 400 with `{ error: ... }`.
- Body `{}` → 400.

#### 2. `POST /api/groups/:groupId/members` — add members
- Valid group, `{ name: "Alice" }` → 201, body `{ id, name: "Alice", groupId }`.
- Repeat for Bob and Carol (store their ids for later tests).
- Unknown groupId → 404.
- Blank name → 400.

#### 3. `POST /api/groups/:groupId/expenses` — equal split
- Payer Alice, amount 3000 cents, splitType "equal", splitAmong [alice, bob, carol].
- Expect 201; body has `splits` with length 3; `splits.map(s => s.amountCents)` sums to 3000.
- Each split is 1000 cents (no remainder in this case).

#### 4. `POST /api/groups/:groupId/expenses` — exact split
- Payer Bob, amount 5000 cents, splitType "exact", exactSplits `[{memberId: alice, amountCents: 2000}, {memberId: carol, amountCents: 3000}]`.
- Expect 201; splits match input.

#### 5. `POST /api/groups/:groupId/expenses` — exact split validation: sum mismatch
- Exact splits summing to 4999 when amount is 5000 → 400 `{ error: /sum/i }`.

#### 6. `GET /api/groups/:groupId/balances` — correctness
- After expenses from cases 3 and 4:
  - Alice paid 3000, owed 1000 (from case 3) + 2000 (from case 4) = 3000 → net 0.
  - Bob paid 5000, owed 1000 (from case 3) → net 4000.
  - Carol paid 0, owed 1000 (from case 3) + 3000 (from case 4) = 4000 → net −4000.
- Assert `sum(netCents) === 0`.
- Assert each member has `name` field.
- Assert specific values for Alice, Bob, Carol.

#### 7. `GET /api/groups/:groupId/settle-up` — zeroes out all balances
- One transaction: Carol pays Bob 4000 cents.
- Assert `amountCents === 4000`, `from === carol.id`, `to === bob.id`.
- Assert `fromName` and `toName` present.
- Assert that applying transactions to balances leaves all at 0 (reduce check).

#### 8. Unknown group — 404 propagation
- `GET /api/groups/99999/balances` → 404.
- `GET /api/groups/99999/settle-up` → 404.
- `POST /api/groups/99999/members` → 404.
- `POST /api/groups/99999/expenses` → 404.

#### 9. Persistence test (separate `describe` block with its own db)
- Open db at a unique temp path `persistPath`.
- `createGroup`, `addMember`, `addExpense` via repo functions directly (not supertest, to isolate from HTTP).
- Call `db.close()`.
- Reopen: `const db2 = openDb(persistPath)`.
- `getGroupMembers(db2, groupId)` → same member returned.
- `getGroupExpenses(db2, groupId)` → expense with splits present.
- `db2.close()` in `afterAll`.

---

## Split persistence rules (summary)

| `splitType` | Input field | Persisted as |
|---|---|---|
| `equal` | `splitAmong: number[]` | `equalSplit(amountCents, splitAmong)` expands to `expense_split` rows |
| `exact` | `exactSplits: {memberId, amountCents}[]` | validated (sum check), written directly to `expense_split` |

Both paths write `expense` row first, then `expense_split` rows, inside a single `db.transaction()`.

---

## Package additions needed

```json
"dependencies": {
  "express": "^4.19"
},
"devDependencies": {
  "supertest": "^7",
  "@types/express": "^4",
  "@types/supertest": "^6"
}
```

(better-sqlite3 and its types already present from m1.)

---

## npm scripts (additions/changes)

| Script | Command |
|---|---|
| `dev` | `tsx watch src/server.ts` |
| `start` | `node --experimental-strip-types src/server.ts` |

No changes to `test` or `e2e` scripts.

---

## .gitignore additions
```
*.db
data/
```

---

## Implementation order for the coding agent

1. Install deps (`express`, `supertest`, `@types/express`, `@types/supertest`).
2. Write `src/repo.ts` (with `NotFoundError`, `ValidationError`, all 5 functions).
3. Write `src/api.ts` (`createApp` factory with all 5 routes + error handler).
4. Write `src/server.ts` (entrypoint).
5. Write `tests/api.test.ts`.
6. Run `npm test` — must pass with `executed > 0`.
