import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, naira, formatDate, isoDate, capitalize } from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "payments", title: "Payments", profile });

const PAGE_SIZE = 20;

const state = {
  term: null,
  payments: [],
  students: [],
  balances: new Map(), // student_id -> balance row
  search: "",
  page: 1,
};

content.innerHTML = `<div class="loading">Loading payments...</div>`;

try {
  await loadAll();
  if (!state.term) {
    content.innerHTML = `<div class="card">No current term is set. Mark a term as current before recording payments.</div>`;
  } else {
    renderPage();
    renderTable();
  }
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load payments: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadAll() {
  const termResult = await supabase
    .from("terms")
    .select("id, session, name")
    .eq("is_current", true)
    .maybeSingle();
  check(termResult);
  state.term = termResult.data;
  if (!state.term) return;

  const [payments, students, balances] = await Promise.all([
    supabase
      .from("payments")
      .select("id, receipt_no, amount, method, paid_on, note, student_id, students(full_name, admission_no)")
      .eq("term_id", state.term.id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("students").select("id, full_name, admission_no").order("full_name"),
    supabase
      .from("student_balances")
      .select("student_id, total_fees, total_paid, balance")
      .eq("term_id", state.term.id),
  ]);
  [payments, students, balances].forEach(check);

  state.payments = payments.data;
  state.students = students.data;
  state.balances = new Map(balances.data.map((b) => [b.student_id, b]));
}

/* ---------- Page layout (built once) ---------- */

function renderPage() {
  const today = isoDate(new Date());

  content.innerHTML = `
    <div class="page-head page-head-row">
      <div>
        <h2>Payments</h2>
        <p id="subtitle"></p>
      </div>
      <button type="button" class="btn btn-primary" id="add-btn">+ Record payment</button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <input type="search" class="input search" id="search"
               placeholder="Search by student, admission or receipt number" aria-label="Search payments" />
      </div>
      <div id="table-area"></div>
      <div class="pagination" id="pagination"></div>
    </div>

    <dialog class="dialog" id="payment-dialog">
      <form id="payment-form" novalidate>
        <div class="dialog-head">
          <h3>Record payment</h3>
          <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <div class="alert" id="payment-error" role="alert" hidden></div>

          <div class="field">
            <label for="p-student">Student</label>
            <select class="select" id="p-student">
              <option value="">Select a student</option>
              ${state.students
                .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)} (${escapeHtml(s.admission_no)})</option>`)
                .join("")}
            </select>
            <small class="field-error" id="p-student-error"></small>
            <small class="hint" id="p-balance-hint"></small>
          </div>

          <div class="field">
            <label for="p-amount">Amount (₦)</label>
            <input class="input" id="p-amount" type="number" min="1" step="any" inputmode="decimal" />
            <small class="field-error" id="p-amount-error"></small>
          </div>

          <div class="field">
            <label for="p-method">Payment method</label>
            <select class="select" id="p-method">
              <option value="cash">Cash</option>
              <option value="transfer">Bank transfer</option>
              <option value="pos">POS</option>
              <option value="online">Online</option>
            </select>
          </div>

          <div class="field">
            <label for="p-date">Date paid</label>
            <input class="input" id="p-date" type="date" value="${today}" max="${today}" />
            <small class="field-error" id="p-date-error"></small>
          </div>

          <div class="field">
            <label for="p-note">Note (optional)</label>
            <input class="input" id="p-note" maxlength="200" placeholder="e.g. second instalment" />
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="payment-save">Save payment</button>
        </div>
      </form>
    </dialog>
  `;

  wireEvents();
}

/* ---------- Table ---------- */

function filteredPayments() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.payments;
  return state.payments.filter(
    (p) =>
      (p.students?.full_name || "").toLowerCase().includes(q) ||
      (p.students?.admission_no || "").toLowerCase().includes(q) ||
      p.receipt_no.toLowerCase().includes(q)
  );
}

function renderTable() {
  const rows = filteredPayments();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const total = state.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  document.getElementById("subtitle").textContent =
    `${state.payments.length} ${state.payments.length === 1 ? "payment" : "payments"} this term, ${naira(total)} collected`;

  const area = document.getElementById("table-area");
  if (pageRows.length === 0) {
    area.innerHTML = `<div class="empty">${
      state.payments.length === 0
        ? "No payments recorded yet. Click Record payment to add the first one."
        : "No payments match your search."
    }</div>`;
  } else {
    area.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Student</th>
              <th>Date</th>
              <th>Method</th>
              <th class="num">Amount</th>
              <th class="num">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((p) => `
              <tr>
                <td class="cell-main">${escapeHtml(p.receipt_no)}</td>
                <td>
                  <div class="cell-main">${escapeHtml(p.students?.full_name || "Unknown")}</div>
                  <div class="cell-sub">${escapeHtml(p.students?.admission_no || "")}</div>
                </td>
                <td>${escapeHtml(formatDate(p.paid_on))}</td>
                <td><span class="badge neutral">${escapeHtml(capitalize(p.method))}</span></td>
                <td class="num">${naira(p.amount)}</td>
                <td>
                  <div class="row-actions">
                    <a class="btn btn-secondary btn-sm" href="receipt.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Receipt</a>
                  </div>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  const pagination = document.getElementById("pagination");
  if (rows.length === 0) {
    pagination.hidden = true;
  } else {
    pagination.hidden = false;
    pagination.innerHTML = `
      <span>Showing ${start + 1}-${start + pageRows.length} of ${rows.length}</span>
      <div class="pager">
        <button type="button" class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? "disabled" : ""}>Previous</button>
        <button type="button" class="btn btn-secondary btn-sm" id="next-page" ${state.page >= totalPages ? "disabled" : ""}>Next</button>
      </div>`;
  }
}

/* ---------- Events ---------- */

function wireEvents() {
  const dialog = document.getElementById("payment-dialog");

  document.getElementById("add-btn").addEventListener("click", openDialog);

  document.getElementById("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderTable();
  });

  content.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "prev-page") { state.page -= 1; renderTable(); }
    else if (button.id === "next-page") { state.page += 1; renderTable(); }
    else if (button.hasAttribute("data-close")) button.closest("dialog").close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.getElementById("p-student").addEventListener("change", updateBalanceHint);
  document.getElementById("payment-form").addEventListener("submit", savePayment);
}

/* ---------- Record payment ---------- */

function setFieldError(inputId, message) {
  document.getElementById(inputId).classList.toggle("invalid", Boolean(message));
  document.getElementById(`${inputId}-error`).textContent = message;
}

function owedBy(studentId) {
  const b = state.balances.get(studentId);
  return b ? Number(b.balance) : 0;
}

function updateBalanceHint() {
  const studentId = document.getElementById("p-student").value;
  const hint = document.getElementById("p-balance-hint");
  const amountInput = document.getElementById("p-amount");

  if (!studentId) { hint.textContent = ""; return; }

  const b = state.balances.get(studentId);
  if (!b || Number(b.total_fees) === 0) {
    hint.textContent = "No fees are set for this student's class this term.";
    return;
  }
  const owed = owedBy(studentId);
  hint.textContent = owed > 0
    ? `Fees ${naira(b.total_fees)}, paid ${naira(b.total_paid)}, balance ${naira(owed)}.`
    : "This student has already paid in full.";

  if (owed > 0 && !amountInput.value) amountInput.value = owed;
}

function openDialog() {
  document.getElementById("payment-form").reset();
  document.getElementById("p-date").value = isoDate(new Date());
  document.getElementById("p-balance-hint").textContent = "";
  ["p-student", "p-amount", "p-date"].forEach((id) => setFieldError(id, ""));
  document.getElementById("payment-error").hidden = true;

  const saveBtn = document.getElementById("payment-save");
  saveBtn.disabled = false;
  saveBtn.textContent = "Save payment";

  document.getElementById("payment-dialog").showModal();
  document.getElementById("p-student").focus();
}

function validate() {
  const studentId = document.getElementById("p-student").value;
  const amount = Number(document.getElementById("p-amount").value);
  const date = document.getElementById("p-date").value;
  let ok = true;

  setFieldError("p-student", studentId ? "" : "Choose a student.");
  if (!studentId) ok = false;

  let amountMsg = "";
  if (!(amount > 0)) amountMsg = "Enter an amount greater than zero.";
  else if (studentId && amount > owedBy(studentId)) {
    amountMsg = `That is more than the balance of ${naira(owedBy(studentId))}.`;
  }
  setFieldError("p-amount", amountMsg);
  if (amountMsg) ok = false;

  let dateMsg = "";
  if (!date) dateMsg = "Choose the date paid.";
  else if (date > isoDate(new Date())) dateMsg = "The date cannot be in the future.";
  setFieldError("p-date", dateMsg);
  if (dateMsg) ok = false;

  return ok;
}

async function savePayment(event) {
  event.preventDefault();
  if (!validate()) return;

  const saveBtn = document.getElementById("payment-save");
  const errorBox = document.getElementById("payment-error");
  errorBox.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const { data, error } = await supabase
    .from("payments")
    .insert({
      student_id: document.getElementById("p-student").value,
      term_id: state.term.id,
      amount: Number(document.getElementById("p-amount").value),
      method: document.getElementById("p-method").value,
      paid_on: document.getElementById("p-date").value,
      note: document.getElementById("p-note").value.trim() || null,
    })
    .select("id, receipt_no")
    .single();

  if (error) {
    errorBox.textContent = error.message || "Could not save the payment. Please try again.";
    errorBox.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save payment";
    return;
  }

  document.getElementById("payment-dialog").close();
  try {
    await loadAll();
    renderTable();
  } catch (refreshError) {
    console.error(refreshError);
  }
  showToast(`Payment saved. Receipt ${data.receipt_no}.`);
  window.open(`receipt.html?id=${encodeURIComponent(data.id)}`, "_blank", "noopener");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}