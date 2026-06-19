import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { createApp } from "../src/api.js";
import {
  createGroup,
  addMember,
  addExpense,
  getGroupMembers,
  getGroupExpenses,
} from "../src/repo.js";

// ──────────────────────────────────────────────────────────────────────────────
// Shared db + app for all HTTP tests
// ──────────────────────────────────────────────────────────────────────────────
function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `split-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

describe("API integration tests", () => {
  let tmpPath: string;
  let app: ReturnType<typeof createApp>;
  // stored ids
  let groupId: number;
  let aliceId: number;
  let bobId: number;
  let carolId: number;

  beforeAll(() => {
    tmpPath = tempDbPath();
    const db = openDb(tmpPath);
    app = createApp(db);
  });

  afterAll(() => {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  // ── 1. POST /api/groups ────────────────────────────────────────────────────
  describe("POST /api/groups", () => {
    it("creates a group and returns 201 with id + name", async () => {
      const res = await request(app)
        .post("/api/groups")
        .send({ name: "Test Group" });
      expect(res.status).toBe(201);
      expect(typeof res.body.id).toBe("number");
      expect(res.body.name).toBe("Test Group");
      groupId = res.body.id;
    });

    it("returns 400 for empty name", async () => {
      const res = await request(app).post("/api/groups").send({ name: "" });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app).post("/api/groups").send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── 2. POST /api/groups/:groupId/members ──────────────────────────────────
  describe("POST /api/groups/:groupId/members", () => {
    it("adds Alice and returns 201", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/members`)
        .send({ name: "Alice" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Alice");
      expect(res.body.groupId).toBe(groupId);
      aliceId = res.body.id;
    });

    it("adds Bob and returns 201", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/members`)
        .send({ name: "Bob" });
      expect(res.status).toBe(201);
      bobId = res.body.id;
    });

    it("adds Carol and returns 201", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/members`)
        .send({ name: "Carol" });
      expect(res.status).toBe(201);
      carolId = res.body.id;
    });

    it("returns 404 for unknown group", async () => {
      const res = await request(app)
        .post("/api/groups/99999/members")
        .send({ name: "Ghost" });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 for blank name", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/members`)
        .send({ name: "   " });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── 3. Equal split expense ─────────────────────────────────────────────────
  describe("POST /api/groups/:groupId/expenses — equal split", () => {
    it("creates equal-split expense, splits sum to amountCents", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/expenses`)
        .send({
          payerMemberId: aliceId,
          amountCents: 3000,
          splitType: "equal",
          splitAmong: [aliceId, bobId, carolId],
          description: "Dinner",
        });
      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.splits)).toBe(true);
      expect(res.body.splits).toHaveLength(3);
      const total = (res.body.splits as { amountCents: number }[]).reduce(
        (s, sp) => s + sp.amountCents,
        0
      );
      expect(total).toBe(3000);
      // each split is exactly 1000 (no remainder)
      for (const sp of res.body.splits as { amountCents: number }[]) {
        expect(sp.amountCents).toBe(1000);
      }
    });
  });

  // ── 4. Exact split expense ─────────────────────────────────────────────────
  describe("POST /api/groups/:groupId/expenses — exact split", () => {
    it("creates exact-split expense, splits match input", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/expenses`)
        .send({
          payerMemberId: bobId,
          amountCents: 5000,
          splitType: "exact",
          exactSplits: [
            { memberId: aliceId, amountCents: 2000 },
            { memberId: carolId, amountCents: 3000 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.splits).toHaveLength(2);
      const byMember = Object.fromEntries(
        (res.body.splits as { memberId: number; amountCents: number }[]).map(
          (s) => [s.memberId, s.amountCents]
        )
      );
      expect(byMember[aliceId]).toBe(2000);
      expect(byMember[carolId]).toBe(3000);
    });
  });

  // ── 5. Exact split sum mismatch → 400 ─────────────────────────────────────
  describe("POST /api/groups/:groupId/expenses — exact split validation", () => {
    it("returns 400 when exact splits do not sum to amountCents", async () => {
      const res = await request(app)
        .post(`/api/groups/${groupId}/expenses`)
        .send({
          payerMemberId: bobId,
          amountCents: 5000,
          splitType: "exact",
          exactSplits: [
            { memberId: aliceId, amountCents: 2000 },
            { memberId: carolId, amountCents: 2999 }, // sum = 4999
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/sum/i);
    });
  });

  // ── 6. GET balances — correctness ──────────────────────────────────────────
  describe("GET /api/groups/:groupId/balances", () => {
    it("returns balances that sum to 0 with correct values", async () => {
      const res = await request(app).get(`/api/groups/${groupId}/balances`);
      expect(res.status).toBe(200);
      const balances = res.body as { memberId: number; name: string; netCents: number }[];

      // sum === 0
      const sum = balances.reduce((s, b) => s + b.netCents, 0);
      expect(sum).toBe(0);

      // name field present on each
      for (const b of balances) {
        expect(typeof b.name).toBe("string");
        expect(b.name.length).toBeGreaterThan(0);
      }

      const byId = Object.fromEntries(balances.map((b) => [b.memberId, b.netCents]));

      // Alice: paid 3000, owed (1000 from equal + 2000 from exact) = 3000 → net 0
      expect(byId[aliceId]).toBe(0);
      // Bob: paid 5000, owed 1000 from equal → net 4000
      expect(byId[bobId]).toBe(4000);
      // Carol: paid 0, owed (1000 from equal + 3000 from exact) = 4000 → net -4000
      expect(byId[carolId]).toBe(-4000);
    });
  });

  // ── 7. GET settle-up — zeroes balances ────────────────────────────────────
  describe("GET /api/groups/:groupId/settle-up", () => {
    it("returns transactions that zero out all balances", async () => {
      const [balRes, settleRes] = await Promise.all([
        request(app).get(`/api/groups/${groupId}/balances`),
        request(app).get(`/api/groups/${groupId}/settle-up`),
      ]);
      expect(settleRes.status).toBe(200);

      const transactions = settleRes.body as {
        from: number;
        fromName: string;
        to: number;
        toName: string;
        amountCents: number;
      }[];

      // Carol pays Bob 4000
      expect(transactions).toHaveLength(1);
      expect(transactions[0].from).toBe(carolId);
      expect(transactions[0].to).toBe(bobId);
      expect(transactions[0].amountCents).toBe(4000);

      // fromName / toName present
      expect(transactions[0].fromName).toBe("Carol");
      expect(transactions[0].toName).toBe("Bob");

      // Applying transactions to balances leaves everyone at 0:
      // "from" pays amountCents → their net increases (less debt)
      // "to" receives amountCents → their net decreases (less credit)
      const balances = balRes.body as { memberId: number; netCents: number }[];
      const net = new Map(balances.map((b) => [b.memberId, b.netCents]));
      for (const t of transactions) {
        net.set(t.from, (net.get(t.from) ?? 0) + t.amountCents);
        net.set(t.to, (net.get(t.to) ?? 0) - t.amountCents);
      }
      for (const v of net.values()) {
        expect(v).toBe(0);
      }
    });
  });

  // ── 8. Unknown group → 404 propagation ────────────────────────────────────
  describe("Unknown group → 404", () => {
    it("GET /api/groups/99999/balances → 404", async () => {
      const res = await request(app).get("/api/groups/99999/balances");
      expect(res.status).toBe(404);
    });

    it("GET /api/groups/99999/settle-up → 404", async () => {
      const res = await request(app).get("/api/groups/99999/settle-up");
      expect(res.status).toBe(404);
    });

    it("POST /api/groups/99999/members → 404", async () => {
      const res = await request(app)
        .post("/api/groups/99999/members")
        .send({ name: "Ghost" });
      expect(res.status).toBe(404);
    });

    it("POST /api/groups/99999/expenses → 404", async () => {
      const res = await request(app)
        .post("/api/groups/99999/expenses")
        .send({
          payerMemberId: 1,
          amountCents: 100,
          splitType: "equal",
          splitAmong: [1],
        });
      expect(res.status).toBe(404);
    });
  });
});

// ── 9. Persistence test ──────────────────────────────────────────────────────
describe("Persistence — data survives db close/reopen", () => {
  let persistPath: string;
  let db2: ReturnType<typeof openDb>;

  beforeAll(() => {
    persistPath = tempDbPath();

    const db = openDb(persistPath);
    const group = createGroup(db, "Persist Group");
    const member = addMember(db, group.id, "Dave");
    addExpense(db, group.id, {
      payerMemberId: member.id,
      amountCents: 500,
      splitType: "equal",
      splitAmong: [member.id],
    });
    db.close();

    db2 = openDb(persistPath);
  });

  afterAll(() => {
    db2.close();
    if (fs.existsSync(persistPath)) fs.unlinkSync(persistPath);
  });

  it("getGroupMembers returns the member after reopen", () => {
    // group is id=1 in a fresh db
    const groups = db2
      .prepare(`SELECT id FROM "group" WHERE name = ?`)
      .all("Persist Group") as { id: number }[];
    expect(groups).toHaveLength(1);
    const members = getGroupMembers(db2, groups[0].id);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("Dave");
  });

  it("getGroupExpenses returns expense with splits after reopen", () => {
    const groups = db2
      .prepare(`SELECT id FROM "group" WHERE name = ?`)
      .all("Persist Group") as { id: number }[];
    const expenses = getGroupExpenses(db2, groups[0].id);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountCents).toBe(500);
    expect(expenses[0].splits).toHaveLength(1);
    expect(expenses[0].splits[0].amountCents).toBe(500);
  });
});
