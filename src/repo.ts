import Database from "better-sqlite3";
import type { Member, Expense, Split } from "./domain.js";
import { equalSplit } from "./domain.js";

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}

export type AddExpenseInput = {
  payerMemberId: number;
  amountCents: number;
  splitType: "equal" | "exact";
  splitAmong?: number[];
  exactSplits?: { memberId: number; amountCents: number }[];
  description?: string;
};

function requireGroup(db: Database.Database, groupId: number): void {
  const row = db.prepare(`SELECT id FROM "group" WHERE id = ?`).get(groupId);
  if (!row) throw new NotFoundError(`Group ${groupId} not found`);
}

function getGroupMemberIds(db: Database.Database, groupId: number): Set<number> {
  const rows = db
    .prepare(`SELECT id FROM member WHERE group_id = ?`)
    .all(groupId) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export function createGroup(
  db: Database.Database,
  name: string
): { id: number; name: string } {
  const row = db
    .prepare(`INSERT INTO "group" (name) VALUES (?) RETURNING id, name`)
    .get(name) as { id: number; name: string };
  return row;
}

export function addMember(
  db: Database.Database,
  groupId: number,
  name: string
): { id: number; name: string; groupId: number } {
  requireGroup(db, groupId);
  const row = db
    .prepare(
      `INSERT INTO member (group_id, name) VALUES (?, ?) RETURNING id, name`
    )
    .get(groupId, name) as { id: number; name: string };
  return { id: row.id, name: row.name, groupId };
}

export function addExpense(
  db: Database.Database,
  groupId: number,
  input: AddExpenseInput
): Expense {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError("amountCents must be a positive integer");
  }

  requireGroup(db, groupId);

  const memberIds = getGroupMemberIds(db, groupId);

  if (!memberIds.has(input.payerMemberId)) {
    throw new NotFoundError(
      `Member ${input.payerMemberId} not found in group ${groupId}`
    );
  }

  let splits: Split[];

  if (input.splitType === "equal") {
    const among = input.splitAmong;
    if (!among || among.length === 0) {
      throw new ValidationError(
        "splitAmong must be a non-empty array for equal split"
      );
    }
    for (const mid of among) {
      if (!memberIds.has(mid)) {
        throw new NotFoundError(
          `Member ${mid} not found in group ${groupId}`
        );
      }
    }
    splits = equalSplit(input.amountCents, among);
  } else {
    // exact
    const exact = input.exactSplits;
    if (!exact || exact.length === 0) {
      throw new ValidationError(
        "exactSplits must be a non-empty array for exact split"
      );
    }
    for (const s of exact) {
      if (!memberIds.has(s.memberId)) {
        throw new NotFoundError(
          `Member ${s.memberId} not found in group ${groupId}`
        );
      }
    }
    const sum = exact.reduce((acc, s) => acc + s.amountCents, 0);
    if (sum !== input.amountCents) {
      throw new ValidationError(
        `exact splits sum ${sum} does not equal amountCents ${input.amountCents}`
      );
    }
    splits = exact.map((s) => ({ memberId: s.memberId, amountCents: s.amountCents }));
  }

  const insertExpense = db.prepare(
    `INSERT INTO expense (group_id, payer_member_id, amount_cents, split_type, description)
     VALUES (?, ?, ?, ?, ?) RETURNING id, payer_member_id, amount_cents, split_type, description`
  );
  const insertSplit = db.prepare(
    `INSERT INTO expense_split (expense_id, member_id, amount_cents) VALUES (?, ?, ?)`
  );

  const txn = db.transaction(() => {
    const expRow = insertExpense.get(
      groupId,
      input.payerMemberId,
      input.amountCents,
      input.splitType,
      input.description ?? null
    ) as {
      id: number;
      payer_member_id: number;
      amount_cents: number;
      split_type: string;
      description: string | null;
    };

    for (const s of splits) {
      insertSplit.run(expRow.id, s.memberId, s.amountCents);
    }

    return expRow;
  });

  const expRow = txn();

  return {
    id: expRow.id,
    payerMemberId: expRow.payer_member_id,
    amountCents: expRow.amount_cents,
    splitType: expRow.split_type as "equal" | "exact",
    splits,
  };
}

export function getGroupMembers(
  db: Database.Database,
  groupId: number
): Member[] {
  requireGroup(db, groupId);
  const rows = db
    .prepare(`SELECT id, name FROM member WHERE group_id = ? ORDER BY id`)
    .all(groupId) as { id: number; name: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export function getGroupExpenses(
  db: Database.Database,
  groupId: number
): Expense[] {
  requireGroup(db, groupId);

  const expRows = db
    .prepare(
      `SELECT id, payer_member_id, amount_cents, split_type, description
       FROM expense WHERE group_id = ? ORDER BY id`
    )
    .all(groupId) as {
    id: number;
    payer_member_id: number;
    amount_cents: number;
    split_type: string;
    description: string | null;
  }[];

  if (expRows.length === 0) return [];

  const expIds = expRows.map((e) => e.id);
  const placeholders = expIds.map(() => "?").join(",");
  const splitRows = db
    .prepare(
      `SELECT expense_id, member_id, amount_cents
       FROM expense_split WHERE expense_id IN (${placeholders}) ORDER BY expense_id, id`
    )
    .all(...expIds) as {
    expense_id: number;
    member_id: number;
    amount_cents: number;
  }[];

  const splitsByExpense = new Map<number, Split[]>();
  for (const s of splitRows) {
    let arr = splitsByExpense.get(s.expense_id);
    if (!arr) {
      arr = [];
      splitsByExpense.set(s.expense_id, arr);
    }
    arr.push({ memberId: s.member_id, amountCents: s.amount_cents });
  }

  return expRows.map((e) => ({
    id: e.id,
    payerMemberId: e.payer_member_id,
    amountCents: e.amount_cents,
    splitType: e.split_type as "equal" | "exact",
    splits: splitsByExpense.get(e.id) ?? [],
  }));
}
