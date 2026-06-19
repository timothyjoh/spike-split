import path from "node:path";
import type Database from "better-sqlite3";
import express, { type Request, type Response, type NextFunction } from "express";
import {
  createGroup,
  addMember,
  addExpense,
  getGroupMembers,
  getGroupExpenses,
  NotFoundError,
  ValidationError,
} from "./repo.js";
import { computeBalances, settleUp } from "./domain.js";

export function createApp(db: Database.Database, publicDir?: string): express.Express {
  const app = express();
  app.use(express.json());

  if (publicDir) {
    app.use(express.static(publicDir));
    app.get("/", (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  // POST /api/groups
  app.post("/api/groups", (req: Request, res: Response) => {
    const { name } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    const group = createGroup(db, name.trim());
    res.status(201).json(group);
  });

  // POST /api/groups/:groupId/members
  app.post("/api/groups/:groupId/members", (req: Request, res: Response, next: NextFunction) => {
    const groupId = parseInt(req.params["groupId"] as string, 10);
    if (isNaN(groupId)) {
      res.status(400).json({ error: "invalid groupId" });
      return;
    }
    const { name } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    try {
      const member = addMember(db, groupId, name.trim());
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/groups/:groupId/expenses
  app.post("/api/groups/:groupId/expenses", (req: Request, res: Response, next: NextFunction) => {
    const groupId = parseInt(req.params["groupId"] as string, 10);
    if (isNaN(groupId)) {
      res.status(400).json({ error: "invalid groupId" });
      return;
    }

    const body = req.body ?? {};
    const { payerMemberId, amountCents, splitType, splitAmong, exactSplits, description } = body;

    if (!Number.isInteger(payerMemberId)) {
      res.status(400).json({ error: "payerMemberId must be an integer" });
      return;
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: "amountCents must be a positive integer" });
      return;
    }
    if (splitType !== "equal" && splitType !== "exact") {
      res.status(400).json({ error: 'splitType must be "equal" or "exact"' });
      return;
    }
    if (splitType === "equal") {
      if (!Array.isArray(splitAmong) || splitAmong.length === 0) {
        res.status(400).json({ error: "splitAmong must be a non-empty array for equal split" });
        return;
      }
    }
    if (splitType === "exact") {
      if (!Array.isArray(exactSplits) || exactSplits.length === 0) {
        res.status(400).json({ error: "exactSplits must be a non-empty array for exact split" });
        return;
      }
    }

    try {
      const expense = addExpense(db, groupId, {
        payerMemberId,
        amountCents,
        splitType,
        splitAmong,
        exactSplits,
        description,
      });
      res.status(201).json(expense);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/groups/:groupId/balances
  app.get("/api/groups/:groupId/balances", (req: Request, res: Response, next: NextFunction) => {
    const groupId = parseInt(req.params["groupId"] as string, 10);
    if (isNaN(groupId)) {
      res.status(400).json({ error: "invalid groupId" });
      return;
    }
    try {
      const members = getGroupMembers(db, groupId);
      const expenses = getGroupExpenses(db, groupId);
      const balances = computeBalances(members, expenses);
      const nameMap = new Map(members.map((m) => [m.id, m.name]));
      const result = balances.map((b) => ({
        memberId: b.memberId,
        name: nameMap.get(b.memberId) ?? "",
        netCents: b.netCents,
      }));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/groups/:groupId/settle-up
  app.get("/api/groups/:groupId/settle-up", (req: Request, res: Response, next: NextFunction) => {
    const groupId = parseInt(req.params["groupId"] as string, 10);
    if (isNaN(groupId)) {
      res.status(400).json({ error: "invalid groupId" });
      return;
    }
    try {
      const members = getGroupMembers(db, groupId);
      const expenses = getGroupExpenses(db, groupId);
      const balances = computeBalances(members, expenses);
      const transactions = settleUp(balances);
      const nameMap = new Map(members.map((m) => [m.id, m.name]));
      const result = transactions.map((t) => ({
        from: t.from,
        fromName: nameMap.get(t.from) ?? "",
        to: t.to,
        toName: nameMap.get(t.to) ?? "",
        amountCents: t.amountCents,
      }));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
