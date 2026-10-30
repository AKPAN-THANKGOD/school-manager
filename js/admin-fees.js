import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, naira } from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "fees", title: "Fees", profile });

const state = {
  terms: [],
  classes: [],
  termId: "",
  classId: "",       // class shown on the Fee structure tab
  filterClassId: "", // class filter on the Outstanding tab
  tab: "structure",
  items: [],         // fee items for the chosen term (all classes)
  balances: [],      // student_balances rows for the chosen term
  editingId: null,
  deletingId: null,
};

content.innerHTML = `<div class="loading">Loading fees...</div>`;

try {
  const [terms, classes] = await Promise.all([
    supabase.from("terms").select("id, session, name, is_current").order("start_date", { ascending: false }),
    supabase.from("classes").select("id, name").order("name"),
  ]);
  check(terms);
  check(classes);
  state.terms = terms.data;
  state.classes = classes.data;

  if (state.terms.length === 0) {
    content.innerHTML = `
      <div class="page-head"><h2>Fees</h2></div>
      <div class="card">No terms exist yet. Add a term in the database first, then come back to set fees.</div>`;
  } else if (state.classes.length === 0) {
    content.innerHTML = `
      <div class="page-head"><h2>Fees</h2></div>
      <div class="card">Create at least one class first (Classes page), then set its fees here.</div>`;
  } else {
    state.termId = (state.terms.find((t) => t.is_current) || state.terms[0]).id;
    state.classId = state.classes[0].id;
    renderPage();
    await loadTermData();
  }
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load fees: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadTermData() {
  const requestedTerm = state.termId;
  document.getElementById("tab-area").innerHTML = `<div class="loading">Loading...</div>`;

  try {
    const [items, balances] = await Promise.all([
      supabase.from("fee_items").select("id, class_id, name, amount").eq("term_id", requestedTerm).order("name"),
      supabase
        .from("student_balances")
        .select("student_id, full_name, admission_no, class_id, total_fees, total_paid, balance")
        .eq("term_id", requestedTerm),
    ]);
    check(items);
    check(balances);

    if (requestedTerm !== state.termId) return; // term changed while loading

    state.items = items.data;
    state.balances = balances.data;
    renderTab();
  } catch (error) {
    console.error(error);
    document.getElementById("tab-area").innerHTML =
      `<div class="alert">Could not load fees: ${escapeHtml(error.message || "unknown error")}</div>`;
  }
}

/* ---------- Page shell (built once) ---------- */

function classOptions(selectedId, includeAll = false) {
  return (
    (includeAll ? `<option value="">All classes</option>` : "") +
    state.classes
      .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("")
  );
}

function renderPage() {
  content.innerHTML = `
    <div class="page-head">
      <h2>Fees</h2>
      <p>Set what each class pays, and see who still owes.</p>
    </div>

    <div class="page-tools">
      <select class="select" id="term-select" aria-label="Term">
        ${state.terms
          .map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === state.termId ? "selected" : ""}>${escapeHtml(t.name)}, ${escapeHtml(t.session)}${t.is_current ? " (current)" : ""}</option>`)
          .join("")}
      </select>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" class="tab active" role="tab" data-tab="structure">Fee structure</button>
      <button type="button" class="tab" role="tab" data-tab="outstanding">Outstanding balances</button>
    </div>

    <div id="tab-area"></div>

    <dialog class="dialog" id="item-dialog">
      <form id="item-form" novalidate>
        <div class="dialog-head">
          <h3 id="item-dialog-title"></h3>
          <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <div class="alert" id="item-error" role="alert" hidden></div>
          <div class="field">
            <label for="i-name">Fee name</label>
            <input class="input" id="i-name" maxlength="80" autocomplete="off" placeholder="e.g. Tuition" />
            <small class="field-error" id="i-name-error"></small>
          </div>
          <div class="field">
            <label for="i-amount">Amount (₦)</label>
            <input class="input" id="i-amount" type="number" min="0" step="any" inputmode="decimal" />
            <small class="field-error" id="i-amount-error"></small>
          </div>
          <label class="check-row" id="all-classes-row">
            <input type="checkbox" id="i-all-classes" />
            Add this fee to every class for this term
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="item-save">Save fee</button>
        </div>
      </form>
    </dialog>

    <dialog class="dialog" id="delete-dialog">
      <div class="dialog-head">
        <h3>Delete fee</h3>
        <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <div class="alert" id="delete-error" role="alert" hidden></div>
        <p id="delete-message"></p>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn btn-danger" id="delete-confirm">Delete</button>
      </div>
    </dialog>
  `;

  wireEvents();
}

function renderTab() {
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.tab === state.tab)
  );
  if (state.tab === "structure") renderStructure();
  else renderOutstanding();
}

/* ---------- Tab 1: fee structure ---------- */

function renderStructure() {
  const items = state.items.filter((i) => i.class_id === state.classId);
  const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

  document.getElementById("tab-area").innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <select class="select filter" id="class-select" aria-label="Class">${classOptions(state.classId)}</select>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-primary" id="add-item-btn">+ Add fee</button>
      </div>
      ${items.length === 0 ? `<div class="empty">No fees set for this class yet. Click Add fee to create the first one.</div>` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fee</th><th class="num">Amount</th><th class="num">Actions</th></tr></thead>
          <tbody>
            ${items.map((i) => `
              <tr>
                <td class="cell-main">${escapeHtml(i.name)}</td>
                <td class="num">${naira(i.amount)}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(i.id)}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="delete" data-id="${escapeHtml(i.id)}">Delete</button>
                  </div>
                </td>
              </tr>`).join("")}
            <tr>
              <td class="cell-main">Total per student</td>
              <td class="num cell-main">${naira(total)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>`}
    </div>`;
}

/* ---------- Tab 2: outstanding balances ---------- */

function outstandingRows() {
  return state.balances
    .filter((b) => Number(b.balance) > 0 && (!state.filterClassId || b.class_id === state.filterClassId))
    .sort((a, b) => Number(b.balance) - Number(a.balance));
}

function renderOutstanding() {
  const className = Object.fromEntries(state.classes.map((c) => [c.id, c.name]));
  const rows = outstandingRows();
  const total = rows.reduce((sum, b) => sum + Number(b.balance), 0);

  document.getElementById("tab-area").innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <select class="select filter" id="filter-class" aria-label="Filter by class">${classOptions(state.filterClassId, true)}</select>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-secondary" id="export-btn" ${rows.length === 0 ? "disabled" : ""}>Download CSV</button>
      </div>
      ${rows.length === 0 ? `<div class="empty">Nobody owes anything for this selection.</div>` : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Student</th><th>Class</th><th class="num">Fees</th><th class="num">Paid</th><th class="num">Balance</th></tr>
          </thead>
          <tbody>
            ${rows.map((b) => `
              <tr>
                <td>
                  <div class="cell-main">${escapeHtml(b.full_name)}</div>
                  <div class="cell-sub">${escapeHtml(b.admission_no)}</div>
                </td>
                <td>${escapeHtml(className[b.class_id] || "-")}</td>
                <td class="num">${naira(b.total_fees)}</td>
                <td class="num">${naira(b.total_paid)}</td>
                <td class="num danger-text">${naira(b.balance)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>${rows.length} ${rows.length === 1 ? "student owes" : "students owe"}</span>
        <strong style="color:var(--text)">Total outstanding: ${naira(total)}</strong>
      </div>`}
    </div>`;
}

function csvCell(value) {
  let text = String(value ?? "");
  // Stop spreadsheet programs from treating text as a formula.
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const className = Object.fromEntries(state.classes.map((c) => [c.id, c.name]));
  const term = state.terms.find((t) => t.id === state.termId);

  const lines = [["Admission no", "Student", "Class", "Fees", "Paid", "Balance"].map(csvCell).join(",")];
  outstandingRows().forEach((b) => {
    lines.push(
      [b.admission_no, b.full_name, className[b.class_id] || "", b.total_fees, b.total_paid, b.balance]
        .map(csvCell)
        .join(",")
    );
  });

  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `outstanding-fees-${(term?.name || "term").toLowerCase().replaceAll(/\s+/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Events ---------- */

function wireEvents() {
  const itemDialog = document.getElementById("item-dialog");
  const deleteDialog = document.getElementById("delete-dialog");

  document.getElementById("term-select").addEventListener("change", async (event) => {
    state.termId = event.target.value;
    await loadTermData();
  });

  // Tabs, table buttons and selects are re-created by renderTab(), so listen on the container.
  content.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.tab) {
      state.tab = button.dataset.tab;
      renderTab();
    } else if (button.id === "add-item-btn") {
      openItemDialog(null);
    } else if (button.id === "export-btn") {
      exportCsv();
    } else if (button.dataset.action === "edit") {
      openItemDialog(state.items.find((i) => i.id === button.dataset.id));
    } else if (button.dataset.action === "delete") {
      openDeleteDialog(state.items.find((i) => i.id === button.dataset.id));
    } else if (button.hasAttribute("data-close")) {
      button.closest("dialog").close();
    }
  });

  content.addEventListener("change", (event) => {
    if (event.target.id === "class-select") {
      state.classId = event.target.value;
      renderStructure();
    } else if (event.target.id === "filter-class") {
      state.filterClassId = event.target.value;
      renderOutstanding();
    }
  });

  [itemDialog, deleteDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.getElementById("item-form").addEventListener("submit", saveItem);
  document.getElementById("delete-confirm").addEventListener("click", confirmDelete);
}

/* ---------- Add / edit a fee item ---------- */

function setFieldError(inputId, message) {
  document.getElementById(inputId).classList.toggle("invalid", Boolean(message));
  document.getElementById(`${inputId}-error`).textContent = message;
}

function openItemDialog(item) {
  state.editingId = item ? item.id : null;

  document.getElementById("item-dialog-title").textContent = item ? "Edit fee" : "Add fee";
  document.getElementById("i-name").value = item ? item.name : "";
  document.getElementById("i-amount").value = item ? item.amount : "";
  document.getElementById("i-all-classes").checked = false;
  // "Add to every class" only makes sense when creating a new fee.
  document.getElementById("all-classes-row").hidden = Boolean(item);

  setFieldError("i-name", "");
  setFieldError("i-amount", "");
  document.getElementById("item-error").hidden = true;

  const saveBtn = document.getElementById("item-save");
  saveBtn.disabled = false;
  saveBtn.textContent = "Save fee";

  document.getElementById("item-dialog").showModal();
  document.getElementById("i-name").focus();
}

async function saveItem(event) {
  event.preventDefault();

  const name = document.getElementById("i-name").value.trim();
  const amountText = document.getElementById("i-amount").value;
  const amount = Number(amountText);

  setFieldError("i-name", name ? "" : "Enter a name for this fee.");
  setFieldError("i-amount", amountText !== "" && amount >= 0 ? "" : "Enter an amount of zero or more.");
  if (!name || amountText === "" || !(amount >= 0)) return;

  const saveBtn = document.getElementById("item-save");
  const errorBox = document.getElementById("item-error");
  errorBox.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const wasEditing = Boolean(state.editingId);
  let error;

  if (wasEditing) {
    ({ error } = await supabase.from("fee_items").update({ name, amount }).eq("id", state.editingId));
  } else {
    const targetClasses = document.getElementById("i-all-classes").checked
      ? state.classes.map((c) => c.id)
      : [state.classId];
    const rows = targetClasses.map((classId) => ({
      class_id: classId,
      term_id: state.termId,
      name,
      amount,
    }));
    ({ error } = await supabase.from("fee_items").insert(rows));
  }

  if (error) {
    errorBox.textContent = error.message || "Could not save the fee. Please try again.";
    errorBox.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save fee";
    return;
  }

  document.getElementById("item-dialog").close();
  await refresh();
  showToast(wasEditing ? "Fee updated." : "Fee added.");
}

/* ---------- Delete a fee item ---------- */

function openDeleteDialog(item) {
  if (!item) return;
  state.deletingId = item.id;

  document.getElementById("delete-message").textContent =
    `Delete "${item.name}" (${naira(item.amount)})? Every student in this class will owe ${naira(item.amount)} less this term.`;
  document.getElementById("delete-error").hidden = true;

  const confirmBtn = document.getElementById("delete-confirm");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Delete";

  document.getElementById("delete-dialog").showModal();
}

async function confirmDelete() {
  const confirmBtn = document.getElementById("delete-confirm");
  const errorBox = document.getElementById("delete-error");
  errorBox.hidden = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Deleting...";

  const { error } = await supabase.from("fee_items").delete().eq("id", state.deletingId);

  if (error) {
    errorBox.textContent = error.message || "Could not delete the fee. Please try again.";
    errorBox.hidden = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Delete";
    return;
  }

  document.getElementById("delete-dialog").close();
  await refresh();
  showToast("Fee deleted.");
}

/* ---------- Helpers ---------- */

async function refresh() {
  await loadTermData();
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}