import { test, expect } from "@playwright/test";

/**
 * Full Definition-of-Done flow for spike-split.
 *
 * Expenses:
 *   Alice pays $90 (equal split among 3) → each owes $30
 *   Bob pays   $30 (equal split among 3) → each owes $10
 *
 * Expected net balances (cents):
 *   Alice: +9000 - 3000 - 1000 = +5000  (+$50.00)
 *   Bob:   +3000 - 3000 - 1000 = -1000  (-$10.00)
 *   Carol:     0 - 3000 - 1000 = -4000  (-$40.00)
 *
 * Settle-up (minimal, ≤2 transactions):
 *   Carol → Alice $40.00
 *   Bob   → Alice $10.00
 */
test("full definition-of-done flow", async ({ page }) => {
  // 1. Load the app
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Split");

  // 2. Create a group
  const groupName = `E2E-${Date.now()}`;
  await page.locator("#group-name").fill(groupName);
  await page.locator("#create-group").click();

  // Members section should appear
  await expect(page.locator("#section-members")).toBeVisible();

  // 3. Add 3 members
  for (const name of ["Alice", "Bob", "Carol"]) {
    await page.locator("#member-name").fill(name);
    await page.locator("#add-member").click();
    // Wait for the member to appear in the list
    await expect(page.locator("#members-list")).toContainText(name);
  }

  // Assert all 3 members are in the list
  const membersList = page.locator("#members-list li");
  await expect(membersList).toHaveCount(3);
  await expect(page.locator("#members-list")).toContainText("Alice");
  await expect(page.locator("#members-list")).toContainText("Bob");
  await expect(page.locator("#members-list")).toContainText("Carol");

  // Expense section should be visible now
  await expect(page.locator("#section-expense")).toBeVisible();

  // 4. Add expense 1: Alice pays $90
  await page.locator("#payer-select").selectOption({ label: "Alice" });
  await page.locator("#amount").fill("90");
  await page.locator("#description").fill("Dinner");
  await page.locator("#add-expense").click();

  // Amount field should be cleared after submit
  await expect(page.locator("#amount")).toHaveValue("");

  // 5. Add expense 2: Bob pays $30
  await page.locator("#payer-select").selectOption({ label: "Bob" });
  await page.locator("#amount").fill("30");
  await page.locator("#description").fill("Drinks");
  await page.locator("#add-expense").click();
  await expect(page.locator("#amount")).toHaveValue("");

  // 6. View Balances
  await page.locator("#show-balances").click();
  const balancesList = page.locator("#balances-list");
  await expect(balancesList).toBeVisible();

  // All 3 members should appear
  await expect(balancesList).toContainText("Alice");
  await expect(balancesList).toContainText("Bob");
  await expect(balancesList).toContainText("Carol");

  // Verify expected balance signs/values
  // Alice: +$50.00  Bob: -$10.00  Carol: -$40.00
  await expect(balancesList).toContainText("+$50.00");
  await expect(balancesList).toContainText("-$10.00");
  await expect(balancesList).toContainText("-$40.00");

  // 7. View Settle-Up
  await page.locator("#show-settleup").click();
  const settleupList = page.locator("#settleup-list");
  await expect(settleupList).toBeVisible();

  // Should have "pays" lines
  await expect(settleupList).toContainText("pays");

  // Should contain the two expected transactions
  await expect(settleupList).toContainText("Carol");
  await expect(settleupList).toContainText("Alice");

  // Count transaction items — should be minimal (≤ 2)
  const items = settleupList.locator("li");
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(2);

  // Verify the settle-up dollar amounts make sense
  await expect(settleupList).toContainText("$40.00");
  await expect(settleupList).toContainText("$10.00");

  // No errors throughout
  await expect(page.locator("#error")).toHaveText("");
});
