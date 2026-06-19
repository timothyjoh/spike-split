import { describe, it, expect } from "vitest";
import {
  computeBalances,
  settleUp,
  equalSplit,
  type Member,
  type Expense,
  type Balance,
} from "../src/domain.js";

// Helper: build a simple expense with pre-built splits
function makeExpense(
  id: number,
  payerMemberId: number,
  amountCents: number,
  splits: Array<{ memberId: number; amountCents: number }>
): Expense {
  return { id, payerMemberId, amountCents, splitType: "equal", splits };
}

const MEMBERS_AB: Member[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

const MEMBERS_ABC: Member[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Carol" },
];

const MEMBERS_ABCD: Member[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Carol" },
  { id: 4, name: "Dave" },
];

// Utility: sum of balances (must be 0)
function sumBalances(balances: Balance[]): number {
  return balances.reduce((s, b) => s + b.netCents, 0);
}

// Utility: apply transactions to balances and return running sums.
// "from" is the debtor paying out → their net balance increases (toward 0).
// "to" is the creditor receiving → their net balance decreases (toward 0).
function applyTransactions(
  balances: Balance[],
  transactions: ReturnType<typeof settleUp>
): Map<number, number> {
  const net = new Map<number, number>();
  for (const b of balances) net.set(b.memberId, b.netCents);
  for (const txn of transactions) {
    net.set(txn.from, (net.get(txn.from) ?? 0) + txn.amountCents); // debtor pays → net rises
    net.set(txn.to, (net.get(txn.to) ?? 0) - txn.amountCents);   // creditor receives → net falls
  }
  return net;
}

// ─── computeBalances ───────────────────────────────────────────────────────

describe("computeBalances", () => {
  it("TC-B1: two members, one pays, equal split → payer +50, other −50", () => {
    const expenses = [
      makeExpense(1, 1, 100, [
        { memberId: 1, amountCents: 50 },
        { memberId: 2, amountCents: 50 },
      ]),
    ];
    const balances = computeBalances(MEMBERS_AB, expenses);
    expect(sumBalances(balances)).toBe(0);
    const alice = balances.find((b) => b.memberId === 1)!;
    const bob = balances.find((b) => b.memberId === 2)!;
    expect(alice.netCents).toBe(50);
    expect(bob.netCents).toBe(-50);
  });

  it("TC-B2: three members, one pays $90, split equally → payer +60 net, others −30 each; sum=0", () => {
    // Alice pays 9000 cents; each owes 3000
    const expenses = [
      makeExpense(1, 1, 9000, [
        { memberId: 1, amountCents: 3000 },
        { memberId: 2, amountCents: 3000 },
        { memberId: 3, amountCents: 3000 },
      ]),
    ];
    const balances = computeBalances(MEMBERS_ABC, expenses);
    expect(sumBalances(balances)).toBe(0);
    const alice = balances.find((b) => b.memberId === 1)!;
    const bob = balances.find((b) => b.memberId === 2)!;
    const carol = balances.find((b) => b.memberId === 3)!;
    expect(alice.netCents).toBe(6000);
    expect(bob.netCents).toBe(-3000);
    expect(carol.netCents).toBe(-3000);
  });

  it("TC-B3: exact split payer pays $100, splits [70,30] → balances match exact amounts", () => {
    const expenses = [
      {
        id: 1,
        payerMemberId: 1,
        amountCents: 10000,
        splitType: "exact" as const,
        splits: [
          { memberId: 1, amountCents: 7000 },
          { memberId: 2, amountCents: 3000 },
        ],
      },
    ];
    const balances = computeBalances(MEMBERS_AB, expenses);
    expect(sumBalances(balances)).toBe(0);
    const alice = balances.find((b) => b.memberId === 1)!;
    const bob = balances.find((b) => b.memberId === 2)!;
    // Alice paid 10000, owed 7000 → net +3000
    expect(alice.netCents).toBe(3000);
    // Bob owed 3000, paid 0 → net -3000
    expect(bob.netCents).toBe(-3000);
  });

  it("TC-B4: multiple expenses across members → cumulative balances, sum=0", () => {
    // Expense 1: Alice pays 6000, splits equally (2000 each among A,B,C)
    // Expense 2: Bob pays 3000, splits equally (1000 each among A,B,C)
    const expenses = [
      makeExpense(1, 1, 6000, [
        { memberId: 1, amountCents: 2000 },
        { memberId: 2, amountCents: 2000 },
        { memberId: 3, amountCents: 2000 },
      ]),
      makeExpense(2, 2, 3000, [
        { memberId: 1, amountCents: 1000 },
        { memberId: 2, amountCents: 1000 },
        { memberId: 3, amountCents: 1000 },
      ]),
    ];
    const balances = computeBalances(MEMBERS_ABC, expenses);
    expect(sumBalances(balances)).toBe(0);
    // Alice: paid 6000, owed 2000+1000=3000 → net +3000
    // Bob:   paid 3000, owed 2000+1000=3000 → net 0
    // Carol: paid 0,    owed 2000+1000=3000 → net -3000
    const alice = balances.find((b) => b.memberId === 1)!;
    const bob = balances.find((b) => b.memberId === 2)!;
    const carol = balances.find((b) => b.memberId === 3)!;
    expect(alice.netCents).toBe(3000);
    expect(bob.netCents).toBe(0);
    expect(carol.netCents).toBe(-3000);
  });

  it("TC-B5: equal split with remainder: $10 across 3 members → splits [4,3,3] cents, sum=10", () => {
    const memberIds = [1, 2, 3];
    const splits = equalSplit(10, memberIds);
    expect(splits.reduce((s, sp) => s + sp.amountCents, 0)).toBe(10);
    expect(splits[0].amountCents).toBe(4); // remainder=1, first member gets base+1
    expect(splits[1].amountCents).toBe(3);
    expect(splits[2].amountCents).toBe(3);
    // Verify computeBalances uses these splits correctly
    const expenses = [makeExpense(1, 1, 10, splits)];
    const balances = computeBalances(MEMBERS_ABC, expenses);
    expect(sumBalances(balances)).toBe(0);
  });

  it("TC-B6: all members pay and owe → net balance sum always exactly 0 (property assertion)", () => {
    // Multiple cross-payments
    const expenses = [
      makeExpense(1, 1, 5000, [
        { memberId: 2, amountCents: 3000 },
        { memberId: 3, amountCents: 2000 },
      ]),
      makeExpense(2, 2, 4000, [
        { memberId: 1, amountCents: 2000 },
        { memberId: 3, amountCents: 2000 },
      ]),
      makeExpense(3, 3, 6000, [
        { memberId: 1, amountCents: 3000 },
        { memberId: 2, amountCents: 3000 },
      ]),
    ];
    const balances = computeBalances(MEMBERS_ABC, expenses);
    expect(sumBalances(balances)).toBe(0);
  });

  it("throws if amountCents is not an integer", () => {
    const expenses = [makeExpense(1, 1, 99.5, [{ memberId: 2, amountCents: 99 }])];
    expect(() => computeBalances(MEMBERS_AB, expenses)).toThrow();
  });
});

// ─── settleUp ──────────────────────────────────────────────────────────────

describe("settleUp", () => {
  it("TC-S1: two members, one owes the other → single transaction", () => {
    const balances: Balance[] = [
      { memberId: 1, netCents: 5000 },
      { memberId: 2, netCents: -5000 },
    ];
    const txns = settleUp(balances);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toEqual({ from: 2, to: 1, amountCents: 5000 });
    // Apply and verify zeroed
    const net = applyTransactions(balances, txns);
    for (const v of net.values()) expect(v).toBe(0);
  });

  it("TC-S2: A owes B $30, A owes C $20 → two transactions, A pays both", () => {
    // A: -5000, B: +3000, C: +2000
    const balances: Balance[] = [
      { memberId: 1, netCents: -5000 },
      { memberId: 2, netCents: 3000 },
      { memberId: 3, netCents: 2000 },
    ];
    const txns = settleUp(balances);
    expect(txns.length).toBeLessThanOrEqual(2);
    // Verify all balances are zeroed after applying transactions
    const net = applyTransactions(balances, txns);
    for (const v of net.values()) expect(v).toBe(0);
    // All txns must be from member 1 (the debtor)
    for (const txn of txns) expect(txn.from).toBe(1);
  });

  it("TC-S3: three members with complex graph → txn count ≤ 2 (n−1)", () => {
    const balances: Balance[] = [
      { memberId: 1, netCents: 3000 },
      { memberId: 2, netCents: -1000 },
      { memberId: 3, netCents: -2000 },
    ];
    const nonZero = balances.filter((b) => b.netCents !== 0).length;
    const txns = settleUp(balances);
    expect(txns.length).toBeLessThanOrEqual(nonZero - 1);
    const net = applyTransactions(balances, txns);
    for (const v of net.values()) expect(v).toBe(0);
  });

  it("TC-S4: all balances zero → empty transaction list", () => {
    const balances: Balance[] = [
      { memberId: 1, netCents: 0 },
      { memberId: 2, netCents: 0 },
    ];
    expect(settleUp(balances)).toHaveLength(0);
  });

  it("TC-S5: settleUp result zeroes all balances (simulation)", () => {
    const balances: Balance[] = [
      { memberId: 1, netCents: 6000 },
      { memberId: 2, netCents: -2000 },
      { memberId: 3, netCents: -4000 },
    ];
    const txns = settleUp(balances);
    const net = applyTransactions(balances, txns);
    for (const [, v] of net) expect(v).toBe(0);
  });

  it("TC-S6: four members, chain debt → minimality assertion (≤ 3 txns)", () => {
    // A is net +9000, B is -3000, C is -3000, D is -3000
    const balances: Balance[] = [
      { memberId: 1, netCents: 9000 },
      { memberId: 2, netCents: -3000 },
      { memberId: 3, netCents: -3000 },
      { memberId: 4, netCents: -3000 },
    ];
    const nonZero = balances.filter((b) => b.netCents !== 0).length;
    const txns = settleUp(balances);
    expect(txns.length).toBeLessThanOrEqual(nonZero - 1);
    const net = applyTransactions(balances, txns);
    for (const v of net.values()) expect(v).toBe(0);
    // All amounts must be positive
    for (const txn of txns) expect(txn.amountCents).toBeGreaterThan(0);
  });
});
