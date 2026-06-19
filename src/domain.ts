export type Member = {
  id: number;
  name: string;
};

export type Split = {
  memberId: number;
  amountCents: number; // exact cents this member owes
};

export type Expense = {
  id: number;
  payerMemberId: number;
  amountCents: number; // total, integer cents
  splitType: "equal" | "exact";
  splits: Split[]; // populated by caller from expense_split rows
};

export type Balance = {
  memberId: number;
  netCents: number; // positive = owed money, negative = owes money
};

export type Transaction = {
  from: number; // memberId who pays
  to: number; // memberId who receives
  amountCents: number; // always positive
};

/**
 * Compute net balance per member: paid − owed.
 * Throws if any amountCents value is not an integer.
 */
export function computeBalances(members: Member[], expenses: Expense[]): Balance[] {
  // Validate all monetary values are integers
  for (const expense of expenses) {
    if (!Number.isInteger(expense.amountCents)) {
      throw new Error(
        `Non-integer amountCents ${expense.amountCents} on expense id ${expense.id}`
      );
    }
    for (const split of expense.splits) {
      if (!Number.isInteger(split.amountCents)) {
        throw new Error(
          `Non-integer amountCents ${split.amountCents} in split for member ${split.memberId}`
        );
      }
    }
  }

  const paid = new Map<number, number>();
  const owed = new Map<number, number>();

  for (const member of members) {
    paid.set(member.id, 0);
    owed.set(member.id, 0);
  }

  for (const expense of expenses) {
    paid.set(expense.payerMemberId, (paid.get(expense.payerMemberId) ?? 0) + expense.amountCents);
    for (const split of expense.splits) {
      owed.set(split.memberId, (owed.get(split.memberId) ?? 0) + split.amountCents);
    }
  }

  return members.map((m) => ({
    memberId: m.id,
    netCents: (paid.get(m.id) ?? 0) - (owed.get(m.id) ?? 0),
  }));
}

/**
 * Greedy max-creditor/max-debtor settle-up algorithm.
 * Returns minimal list of transactions to zero out all balances.
 * Transaction count ≤ nonZeroMembers − 1.
 */
export function settleUp(balances: Balance[]): Transaction[] {
  const creditors: Array<{ memberId: number; netCents: number }> = [];
  const debtors: Array<{ memberId: number; netCents: number }> = [];

  for (const b of balances) {
    if (b.netCents > 0) creditors.push({ memberId: b.memberId, netCents: b.netCents });
    else if (b.netCents < 0) debtors.push({ memberId: b.memberId, netCents: b.netCents });
  }

  // Sort creditors descending (largest first), debtors ascending (most negative first)
  creditors.sort((a, b) => b.netCents - a.netCents);
  debtors.sort((a, b) => a.netCents - b.netCents);

  const transactions: Transaction[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[0];
    const debtor = debtors[0];

    const amount = Math.min(creditor.netCents, Math.abs(debtor.netCents));

    transactions.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amountCents: amount,
    });

    creditor.netCents -= amount;
    debtor.netCents += amount;

    if (creditor.netCents === 0) creditors.shift();
    if (debtor.netCents === 0) debtors.shift();

    // Re-sort after mutation to maintain greedy invariant
    creditors.sort((a, b) => b.netCents - a.netCents);
    debtors.sort((a, b) => a.netCents - b.netCents);
  }

  return transactions;
}

/**
 * Build equal splits for an expense using the remainder-cent strategy.
 * First `remainder` members get base+1 cents; rest get base cents.
 * Guarantees sum(splits) === amountCents exactly.
 */
export function equalSplit(amountCents: number, memberIds: number[]): Split[] {
  if (memberIds.length === 0) return [];
  const n = memberIds.length;
  const base = Math.floor(amountCents / n);
  const remainder = amountCents - base * n;

  return memberIds.map((memberId, index) => ({
    memberId,
    amountCents: index < remainder ? base + 1 : base,
  }));
}
