// State
let groupId = null;
let members = []; // [{id, name}, ...]

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
  const splitAmong = members.map(m => m.id); // equal split across all members

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
