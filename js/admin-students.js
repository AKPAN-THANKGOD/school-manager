import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, naira } from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "students", title: "Students", profile });

const PAGE_SIZE = 20;

const state = {
  term: null,
  students: [],
  classes: [],
  parents: [],
  balances: new Map(), // student_id -> balance row for the current term
  search: "",
  classId: "",
  page: 1,
  editingId: null,
  deletingId: null,
};

content.innerHTML = `<div class="loading">Loading students...</div>`;

try {
  await loadAll();
  renderPage();
  renderTable();
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load students: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadAll() {
  const termResult = await supabase.from("terms").select("id").eq("is_current", true).maybeSingle();
  check(termResult);
  state.term = termResult.data;

  const [students, classes, parents, balances] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_no, full_name, class_id, parent_id")
      .order("full_name"),
    supabase.from("classes").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "parent").order("full_name"),
    state.term
      ? supabase
          .from("student_balances")
          .select("student_id, total_fees, total_paid, balance")
          .eq("term_id", state.term.id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  [students, classes, parents, balances].forEach(check);

  state.students = students.data;
  state.classes = classes.data;
  state.parents = parents.data;
  state.balances = new Map(balances.data.map((b) => [b.student_id, b]));
}

/* ---------- Page layout (built once) ---------- */

function optionsHtml(items, selectedId = "") {
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name ?? item.full_name)}</option>`
    )
    .join("");
}

function renderPage() {
  content.innerHTML = `
    <div class="page-head page-head-row">
      <div>
        <h2>Students</h2>
        <p id="subtitle"></p>
      </div>
      <button type="button" class="btn btn-primary" id="add-btn">+ Add student</button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <input type="search" class="input search" id="search"
               placeholder="Search by name or admission number" aria-label="Search students" />
        <select class="select filter" id="class-filter" aria-label="Filter by class">
          <option value="">All classes</option>
          ${optionsHtml(state.classes)}
        </select>
      </div>
      <div id="table-area"></div>
      <div class="pagination" id="pagination"></div>
    </div>

    <dialog class="dialog" id="student-dialog">
      <form id="student-form" novalidate>
        <div class="dialog-head">
          <h3 id="student-dialog-title"></h3>
          <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <div class="alert" id="student-form-error" role="alert" hidden></div>

          <div class="field">
            <label for="f-name">Full name</label>
            <input class="input" id="f-name" maxlength="120" autocomplete="off" />
            <small class="field-error" id="f-name-error"></small>
          </div>
          <div class="field">
            <label for="f-adm">Admission number</label>
            <input class="input" id="f-adm" maxlength="40" autocomplete="off" />
            <small class="field-error" id="f-adm-error"></small>
          </div>
          <div class="field">
            <label for="f-class">Class</label>
            <select class="select" id="f-class"></select>
            <small class="field-error" id="f-class-error"></small>
          </div>
          <div class="field">
            <label for="f-parent">Parent or guardian (optional)</label>
            <select class="select" id="f-parent"></select>
            <small class="hint">Parents appear here after their account has been created.</small>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="student-save">Save student</button>
        </div>
      </form>
    </dialog>

    <dialog class="dialog" id="delete-dialog">
      <div class="dialog-head">
        <h3>Delete student</h3>
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

/* ---------- Table (re-drawn on every search, filter or page change) ---------- */

function filteredStudents() {
  const q = state.search.trim().toLowerCase();
  return state.students.filter(
    (s) =>
      (!state.classId || s.class_id === state.classId) &&
      (!q || s.full_name.toLowerCase().includes(q) || s.admission_no.toLowerCase().includes(q))
  );
}

function balanceCell(student) {
  const b = state.balances.get(student.id);
  if (!state.term || !b || Number(b.total_fees) === 0) {
    return `<span class="badge neutral">No fees set</span>`;
  }
  const balance = Number(b.balance);
  if (balance <= 0) return `<span class="badge success">Paid</span>`;
  if (Number(b.total_paid) > 0) {
    return `<span class="badge warning">Part paid</span><div class="cell-sub">Owes ${naira(balance)}</div>`;
  }
  return `<span class="badge danger">Unpaid</span><div class="cell-sub">Owes ${naira(balance)}</div>`;
}

function renderTable() {
  const className = Object.fromEntries(state.classes.map((c) => [c.id, c.name]));
  const parentName = Object.fromEntries(state.parents.map((p) => [p.id, p.full_name]));

  const rows = filteredStudents();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  document.getElementById("subtitle").textContent =
    `${state.students.length} ${state.students.length === 1 ? "student" : "students"} in total`;

  const area = document.getElementById("table-area");
  if (pageRows.length === 0) {
    area.innerHTML = `<div class="empty">${
      state.students.length === 0
        ? "No students yet. Click Add student to enrol the first one."
        : "No students match your search."
    }</div>`;
  } else {
    area.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>Parent or guardian</th>
              <th>Fees this term</th>
              <th class="num">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((s) => `
              <tr>
                <td>
                  <div class="cell-main">${escapeHtml(s.full_name)}</div>
                  <div class="cell-sub">${escapeHtml(s.admission_no)}</div>
                </td>
                <td>${escapeHtml(className[s.class_id] || "-")}</td>
                <td>${s.parent_id ? escapeHtml(parentName[s.parent_id] || "Linked") : `<span class="cell-sub">Not linked</span>`}</td>
                <td>${balanceCell(s)}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(s.id)}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="delete" data-id="${escapeHtml(s.id)}">Delete</button>
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
  const studentDialog = document.getElementById("student-dialog");
  const deleteDialog = document.getElementById("delete-dialog");

  document.getElementById("add-btn").addEventListener("click", () => openStudentDialog(null));

  document.getElementById("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.page = 1;
    renderTable();
  });

  document.getElementById("class-filter").addEventListener("change", (event) => {
    state.classId = event.target.value;
    state.page = 1;
    renderTable();
  });

  // Edit, delete, and page buttons are created by renderTable(), so listen on the container.
  content.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.id === "prev-page") { state.page -= 1; renderTable(); return; }
    if (button.id === "next-page") { state.page += 1; renderTable(); return; }

    if (button.dataset.action === "edit") {
      openStudentDialog(state.students.find((s) => s.id === button.dataset.id));
    } else if (button.dataset.action === "delete") {
      openDeleteDialog(state.students.find((s) => s.id === button.dataset.id));
    } else if (button.hasAttribute("data-close")) {
      button.closest("dialog").close();
    }
  });

  // Click on the dark backdrop closes the dialog.
  [studentDialog, deleteDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.getElementById("student-form").addEventListener("submit", saveStudent);
  document.getElementById("delete-confirm").addEventListener("click", confirmDelete);
}

/* ---------- Add / edit ---------- */

function suggestAdmissionNo() {
  const prefix = `SM/${new Date().getFullYear()}/`;
  let max = 0;
  for (const s of state.students) {
    if (s.admission_no.startsWith(prefix)) {
      const n = parseInt(s.admission_no.slice(prefix.length), 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
  }
  return prefix + String(max + 1).padStart(3, "0");
}

function setFieldError(inputId, message) {
  document.getElementById(inputId).classList.toggle("invalid", Boolean(message));
  document.getElementById(`${inputId}-error`).textContent = message;
}

function openStudentDialog(student) {
  state.editingId = student ? student.id : null;

  document.getElementById("student-dialog-title").textContent = student ? "Edit student" : "Add student";
  document.getElementById("f-name").value = student ? student.full_name : "";
  document.getElementById("f-adm").value = student ? student.admission_no : suggestAdmissionNo();

  document.getElementById("f-class").innerHTML =
    `<option value="">Select a class</option>` + optionsHtml(state.classes, student?.class_id);
  document.getElementById("f-parent").innerHTML =
    `<option value="">No parent linked</option>` + optionsHtml(state.parents, student?.parent_id);

  ["f-name", "f-adm", "f-class"].forEach((id) => setFieldError(id, ""));
  document.getElementById("student-form-error").hidden = true;
  document.getElementById("student-save").disabled = false;
  document.getElementById("student-save").textContent = "Save student";

  document.getElementById("student-dialog").showModal();
  document.getElementById("f-name").focus();
}

function validateStudentForm() {
  const name = document.getElementById("f-name").value.trim();
  const adm = document.getElementById("f-adm").value.trim();
  const classId = document.getElementById("f-class").value;
  let ok = true;

  setFieldError("f-name", name ? "" : "Enter the student's full name.");
  setFieldError("f-adm", adm ? "" : "Enter an admission number.");
  setFieldError("f-class", classId ? "" : "Choose a class.");
  if (!name || !adm || !classId) ok = false;

  return ok;
}

async function saveStudent(event) {
  event.preventDefault();
  if (!validateStudentForm()) return;

  const saveBtn = document.getElementById("student-save");
  const errorBox = document.getElementById("student-form-error");
  errorBox.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const payload = {
    full_name: document.getElementById("f-name").value.trim(),
    admission_no: document.getElementById("f-adm").value.trim(),
    class_id: document.getElementById("f-class").value,
    parent_id: document.getElementById("f-parent").value || null,
  };

  const wasEditing = Boolean(state.editingId);
  const { error } = wasEditing
    ? await supabase.from("students").update(payload).eq("id", state.editingId)
    : await supabase.from("students").insert(payload);

  if (error) {
    errorBox.textContent =
      error.code === "23505"
        ? "That admission number is already used by another student."
        : error.message || "Could not save the student. Please try again.";
    errorBox.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save student";
    return;
  }

  document.getElementById("student-dialog").close();
  await refresh();
  showToast(wasEditing ? "Student updated." : "Student added.");
}

/* ---------- Delete ---------- */

function openDeleteDialog(student) {
  if (!student) return;
  state.deletingId = student.id;

  document.getElementById("delete-message").textContent =
    `Delete ${student.full_name} (${student.admission_no})? Their attendance records will be deleted too. This cannot be undone.`;
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

  const { error } = await supabase.from("students").delete().eq("id", state.deletingId);

  if (error) {
    errorBox.textContent =
      error.code === "23503"
        ? "This student has payment records, so they cannot be deleted."
        : error.message || "Could not delete the student. Please try again.";
    errorBox.hidden = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Delete";
    return;
  }

  document.getElementById("delete-dialog").close();
  await refresh();
  showToast("Student deleted.");
}

/* ---------- Helpers ---------- */

async function refresh() {
  try {
    await loadAll();
    renderTable();
  } catch (error) {
    console.error(error);
    showToast("Saved, but the list could not be refreshed. Reload the page.", true);
  }
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