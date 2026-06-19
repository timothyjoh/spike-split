# Milestone m3 — Minimal Web UI

## Goal

Serve a single-page vanilla-JS UI from the existing Express server on port 3001.
The UI must support the e2e flow: create group → add 3 members → add 2 expenses →
view balances → view settle-up.

---

## Decision: plain ES-module JS in `public/`, no client build step

Client code lives in `public/app.js` as plain browser ES-module JavaScript.
No TypeScript compilation for the client, no Vite, no bundler.
The browser loads it with `<script type="module" src="/app.js">`.
Types stay server-side only (compiled by existing `tsc`/`tsx`/strip-types pipeline).
This eliminates build-step failure modes and keeps the browser-verify gate reliable
for Playwright.

---

## Files to create / modify

### New files

| Path | Description |
|---|---|
| `public/index.html` | Single HTML page; all structure + element ids defined here |
| `public/app.js` | Plain ES-module; all client logic; uses `fetch` against `/api` |

### Modified files

| Path | Change |
|---|---|
| `src/server.ts` | Add `express.static` for `public/` dir + explicit `GET /` → `index.html` |
| `src/api.ts` | No change needed (all API routes already exist) |

---

## `src/server.ts` edits

Insert **before** `createApp(db)` call (or pass `publicDir` into `createApp`, or add
after — either works; inserting after `createApp` before `listen` is simplest):

```ts
import { fileURLToPath } from "node:url";

// Resolve public/ relative to this source file, works from both
// ts source run (src/server.ts) and compiled run (dist/src/server.js)
// because __dirname / import.meta.url always points at the file itself.
// public/ lives at project root, two levels up from src/server.ts
// and two levels up from dist/src/server.js — same relative depth.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
```

Then in `createApp` (or directly on `app` in server.ts after `createApp` returns):

```ts
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
```

**Critical path note**: `src/server.ts` compiles to `dist/src/server.js`.
`public/` is at project root. From `dist/src/server.js`, `../../public` resolves
to project root `/public`. From `src/server.ts` (ts-node / strip-types run),
`../../public` also resolves to project root. Same depth both ways — no env
branching needed.

The `express.static` middleware must be registered **before** the 404 fallback in
`createApp`. Best approach: pass `publicDir` as a parameter to `createApp` and add
`app.use(express.static(publicDir))` + `app.get("/", ...)` at the top of that
function, before all API routes. This keeps `server.ts` as the single place that
knows the filesystem layout.

### Preferred implementation pattern

```ts
// api.ts
export function createApp(db: Database.Database, publicDir?: string): express.Express {
  const app = express();
  app.use(express.json());

  if (publicDir) {
    app.use(express.static(publicDir));
    app.get("/", (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  // ... existing API routes unchanged ...
}
```

```ts
// server.ts — add after existing imports
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname2, "../../public");
const app = createApp(db, PUBLIC_DIR);
```

(Note: `server.ts` already imports `path` and `fileURLToPath` — no new imports.)

---

## `public/index.html` structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Split</title>
</head>
<body>
  <h1>Split</h1>

  <!-- Error/status display -->
  <p id="error" style="color:red"></p>

  <!-- Section 1: Create group -->
  <section id="section-create-group">
    <h2>Create Group</h2>
    <input id="group-name" type="text" placeholder="Group name">
    <button id="create-group">Create Group</button>
  </section>

  <!-- Section 2: Members (shown after group created) -->
  <section id="section-members" style="display:none">
    <h2>Members</h2>
    <ul id="members-list"></ul>
    <input id="member-name" type="text" placeholder="Member name">
    <button id="add-member">Add Member</button>
  </section>

  <!-- Section 3: Add expense (shown after >=1 member) -->
  <section id="section-expense" style="display:none">
    <h2>Add Expense</h2>
    <select id="payer-select"></select>
    <input id="amount" type="number" step="0.01" min="0.01" placeholder="Amount ($)">
    <input id="description" type="text" placeholder="Description (optional)">
    <button id="add-expense">Add Expense</button>
  </section>

  <!-- Section 4: View results -->
  <section id="section-results" style="display:none">
    <button id="show-balances">View Balances</button>
    <ul id="balances-list"></ul>
    <button id="show-settleup">View Settle-Up</button>
    <ul id="settleup-list"></ul>
  </section>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

---

## Exact element ids / data-testids (Playwright targets)

| Element | id / selector | Purpose |
|---|---|---|
| Group name input | `#group-name` | Type group name |
| Create group button | `#create-group` | Submit group creation |
| Member name input | `#member-name` | Type member name |
| Add member button | `#add-member` | Submit member add |
| Members list | `#members-list` | `<li>` per member (text: `name (id: N)`) |
| Payer select | `#payer-select` | `<option value="memberId">name</option>` |
| Amount input | `#amount` | Dollar amount (float) |
| Description input | `#description` | Optional description |
| Add expense button | `#add-expense` | Submit expense |
| Show balances button | `#show-balances` | Fetch + render balances |
| Balances list | `#balances-list` | `<li>` per member: `name: +$X.XX` or `-$X.XX` |
| Show settle-up button | `#show-settleup` | Fetch + render settle-up |
| Settle-up list | `#settleup-list` | `<li>` per tx: `fromName pays toName $X.XX` |
| Error display | `#error` | Visible error text; empty string when no error |
| Members section | `#section-members` | Shown after group created |
| Results section | `#section-results` | Shown after >=1 expense added |

No `data-testid` attributes required — plain ids are sufficient and simpler.

---

## `public/app.js` — client logic outline

```js
// State
let groupId = null;
let members = [];  // [{id, name}, ...]

// Dollar → cents: always use Math.round(dollars * 100)
// Cents → dollar display: (cents / 100).toFixed(2) with sign prefix

function fmtCents(cents) {
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function showError(msg) {
  document.getElementById("error").textContent = msg;
}

function clearError() {
  document.getElementById("error").textContent = "";
}

// --- Create Group ---
document.getElementById("create-group").addEventListener("click", async () => {
  const name = document.getElementById("group-name").value.trim();
  if (!name) { showError("Enter a group name"); return; }
  const res = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) { showError((await res.json()).error); return; }
  const group = await res.json();
  groupId = group.id;
  clearError();
  document.getElementById("section-members").style.display = "";
});

// --- Add Member ---
document.getElementById("add-member").addEventListener("click", async () => {
  const name = document.getElementById("member-name").value.trim();
  if (!name || !groupId) { showError("Enter a member name"); return; }
  const res = await fetch(`/api/groups/${groupId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) { showError((await res.json()).error); return; }
  const member = await res.json();
  members.push(member);
  clearError();
  document.getElementById("member-name").value = "";
  renderMembers();
});

function renderMembers() {
  const list = document.getElementById("members-list");
  list.innerHTML = members.map(m => `<li>${m.name} (id: ${m.id})</li>`).join("");

  const sel = document.getElementById("payer-select");
  sel.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join("");

  if (members.length >= 1) {
    document.getElementById("section-expense").style.display = "";
    document.getElementById("section-results").style.display = "";
  }
}

// --- Add Expense ---
document.getElementById("add-expense").addEventListener("click", async () => {
  if (!groupId || members.length === 0) { showError("Add members first"); return; }
  const payerMemberId = parseInt(document.getElementById("payer-select").value, 10);
  const dollars = parseFloat(document.getElementById("amount").value);
  if (!Number.isFinite(dollars) || dollars <= 0) { showError("Enter a valid amount"); return; }
  const amountCents = Math.round(dollars * 100);
  const description = document.getElementById("description").value.trim() || undefined;
  const splitAmong = members.map(m => m.id);  // equal split across all members

  const res = await fetch(`/api/groups/${groupId}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payerMemberId, amountCents, splitType: "equal", splitAmong, description }),
  });
  if (!res.ok) { showError((await res.json()).error); return; }
  clearError();
  document.getElementById("amount").value = "";
  document.getElementById("description").value = "";
});

// --- View Balances ---
document.getElementById("show-balances").addEventListener("click", async () => {
  if (!groupId) return;
  const res = await fetch(`/api/groups/${groupId}/balances`);
  if (!res.ok) { showError((await res.json()).error); return; }
  const balances = await res.json();
  clearError();
  const list = document.getElementById("balances-list");
  list.innerHTML = balances.map(b => `<li>${b.name}: ${fmtCents(b.netCents)}</li>`).join("");
});

// --- View Settle-Up ---
document.getElementById("show-settleup").addEventListener("click", async () => {
  if (!groupId) return;
  const res = await fetch(`/api/groups/${groupId}/settle-up`);
  if (!res.ok) { showError((await res.json()).error); return; }
  const txs = await res.json();
  clearError();
  const list = document.getElementById("settleup-list");
  if (txs.length === 0) {
    list.innerHTML = "<li>All settled!</li>";
    return;
  }
  list.innerHTML = txs.map(t =>
    `<li>${t.fromName} pays ${t.toName} $${(t.amountCents / 100).toFixed(2)}</li>`
  ).join("");
});
```

---

## Dollar ↔ cents conversion

- **Input → API**: `amountCents = Math.round(dollars * 100)` (handles floating-point
  imprecision; always integer).
- **API → display**: `(Math.abs(cents) / 100).toFixed(2)` with sign prefix
  (`+` / `-`).
- Settle-up display: raw `$` with no sign (amounts are always positive transfers).

---

## express.static path resolution (compiled vs source run)

```
Source run:  node --experimental-strip-types src/server.ts
  __dirname  = <project>/src
  ../../public = <project>/public  ✓

Compiled run: node dist/src/server.js
  __dirname  = <project>/dist/src
  ../../public = <project>/public  ✓
```

Both resolve identically. No `process.cwd()` dependency. No env branching.

The `path.resolve(__dirname, "../../public")` expression using `fileURLToPath(import.meta.url)`
in `src/server.ts` is the single correct approach.

---

## API call sequence (e2e flow)

1. `POST /api/groups` `{ name }` → `{ id, name }` → store `groupId`
2. `POST /api/groups/:groupId/members` `{ name }` × 3 → accumulate `members[]`
3. `POST /api/groups/:groupId/expenses` `{ payerMemberId, amountCents, splitType:"equal", splitAmong:[...all member ids] }` × 2
4. `GET /api/groups/:groupId/balances` → render `#balances-list`
5. `GET /api/groups/:groupId/settle-up` → render `#settleup-list`

---

## e2e test expectations (Playwright)

- After step 1: `#section-members` visible.
- After adding 3 members: `#members-list` has 3 `<li>` items; `#payer-select` has 3 options.
- After adding 2 expenses: `#section-results` visible (already shown after first member).
- After clicking `#show-balances`: `#balances-list` has 3 `<li>` items; text matches `/\+\$|\-\$/`.
- After clicking `#show-settleup`: `#settleup-list` has ≥1 `<li>` item; text matches `/pays/`.
- `#error` is empty on all success paths.

---

## Implementation order

1. Create `public/index.html` (static, no build).
2. Create `public/app.js` (plain ES-module JS).
3. Edit `src/api.ts`: add `publicDir?: string` param to `createApp`; add static + GET `/` routes at top.
4. Edit `src/server.ts`: compute `PUBLIC_DIR` via `import.meta.url`; pass to `createApp`.
5. Manual smoke: `npm run dev` → `curl http://localhost:3001/` → HTML returned.
6. Write/run Playwright e2e test against the live server.

---

## Out of scope for m3

- Auth, sessions, multi-group navigation.
- CSS styling beyond browser defaults.
- Exact-amount split UI (API supports it; UI defaults to equal split across all members).
- Client-side TypeScript compilation.
