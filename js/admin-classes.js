import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml } from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "classes", title: "Classes", profile });

const state = {
  classes: [],
  teachers: [],
  studentCounts: new Map(), // class_id -> number of students
  editingId: null,
  deletingId: null,
};

content.innerHTML = `<div class="loading">Loading classes...</div>`;

try {
  await loadAll();
  renderPage();
  renderTable();
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load classes: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadAll() {
  const [classes, teachers, students] = await Promise.all([
    supabase.from("classes").select("id, name, teacher_id").order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "teacher").order("full_name"),
    supabase.from("students").select("class_id"),
  ]);
  [classes, teachers, students].forEach(check);

  state.classes = classes.data;
  state.teachers = teachers.data;
  state.studentCounts = new Map();
  students.data.forEach((s) => {
    state.studentCounts.set(s.class_id, (state.studentCounts.get(s.class_id) || 0) + 1);
  });
}

/* ---------- Page ---------- */

function teacherOptions(selectedId = "") {
  return (
    `<option value="">No teacher assigned</option>` +
    state.teachers
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}" ${t.id === selectedId ? "selected" : ""}>${escapeHtml(t.full_name)}</option>`
      )
      .join("")
  );
}

function renderPage() {
  content.innerHTML = `
    <div class="page-head page-head-row">
      <div>
        <h2>Classes</h2>
        <p id="subtitle"></p>
      </div>
      <button type="button" class="btn btn-primary" id="add-btn">+ Add class</button>
    </div>

    <div class="panel">
      <div id="table-area"></div>
    </div>

    <dialog class="dialog" id="class-dialog">
      <form id="class-form" novalidate>
        <div class="dialog-head">
          <h3 id="class-dialog-title"></h3>
          <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <div class="alert" id="class-error" role="alert" hidden></div>
          <div class="field">
            <label for="c-name">Class name</label>
            <input class="input" id="c-name" maxlength="60" autocomplete="off" placeholder="e.g. JSS 1" />
            <small class="field-error" id="c-name-error"></small>
          </div>
          <div class="field">
            <label for="c-teacher">Class teacher</label>
            <select class="select" id="c-teacher"></select>
            <small class="hint">Teachers appear here after their account has been created.</small>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="class-save">Save class</button>
        </div>
      </form>
    </dialog>

    <dialog class="dialog" id="delete-dialog">
      <div class="dialog-head">
        <h3>Delete class</h3>
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

function renderTable() {
  const teacherName = Object.fromEntries(state.teachers.map((t) => [t.id, t.full_name]));

  document.getElementById("subtitle").textContent =
    `${state.classes.length} ${state.classes.length === 1 ? "class" : "classes"}`;

  const area = document.getElementById("table-area");
  if (state.classes.length === 0) {
    area.innerHTML = `<div class="empty">No classes yet. Click Add class to create the first one.</div>`;
    return;
  }

  area.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Class</th><th>Class teacher</th><th class="num">Students</th><th class="num">Actions</th></tr>
        </thead>
        <tbody>
          ${state.classes.map((c) => `
            <tr>
              <td class="cell-main">${escapeHtml(c.name)}</td>
              <td>${c.teacher_id ? escapeHtml(teacherName[c.teacher_id] || "Assigned") : `<span class="cell-sub">Not assigned</span>`}</td>
              <td class="num">${state.studentCounts.get(c.id) || 0}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(c.id)}">Edit</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-action="delete" data-id="${escapeHtml(c.id)}">Delete</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/* ---------- Events ---------- */

function wireEvents() {
  const classDialog = document.getElementById("class-dialog");
  const deleteDialog = document.getElementById("delete-dialog");

  document.getElementById("add-btn").addEventListener("click", () => openClassDialog(null));

  content.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.action === "edit") {
      openClassDialog(state.classes.find((c) => c.id === button.dataset.id));
    } else if (button.dataset.action === "delete") {
      openDeleteDialog(state.classes.find((c) => c.id === button.dataset.id));
    } else if (button.hasAttribute("data-close")) {
      button.closest("dialog").close();
    }
  });

  [classDialog, deleteDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.getElementById("class-form").addEventListener("submit", saveClass);
  document.getElementById("delete-confirm").addEventListener("click", confirmDelete);
}

/* ---------- Add / edit ---------- */

function openClassDialog(cls) {
  state.editingId = cls ? cls.id : null;

  document.getElementById("class-dialog-title").textContent = cls ? "Edit class" : "Add class";
  document.getElementById("c-name").value = cls ? cls.name : "";
  document.getElementById("c-teacher").innerHTML = teacherOptions(cls?.teacher_id);
  document.getElementById("c-name").classList.remove("invalid");
  document.getElementById("c-name-error").textContent = "";
  document.getElementById("class-error").hidden = true;

  const saveBtn = document.getElementById("class-save");
  saveBtn.disabled = false;
  saveBtn.textContent = "Save class";

  document.getElementById("class-dialog").showModal();
  document.getElementById("c-name").focus();
}

async function saveClass(event) {
  event.preventDefault();

  const nameInput = document.getElementById("c-name");
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add("invalid");
    document.getElementById("c-name-error").textContent = "Enter a class name.";
    return;
  }
  nameInput.classList.remove("invalid");
  document.getElementById("c-name-error").textContent = "";

  const saveBtn = document.getElementById("class-save");
  const errorBox = document.getElementById("class-error");
  errorBox.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const payload = {
    name,
    teacher_id: document.getElementById("c-teacher").value || null,
  };

  const wasEditing = Boolean(state.editingId);
  const { error } = wasEditing
    ? await supabase.from("classes").update(payload).eq("id", state.editingId)
    : await supabase.from("classes").insert(payload);

  if (error) {
    errorBox.textContent =
      error.code === "23505"
        ? "A class with that name already exists."
        : error.message || "Could not save the class. Please try again.";
    errorBox.hidden = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save class";
    return;
  }

  document.getElementById("class-dialog").close();
  await refresh();
  showToast(wasEditing ? "Class updated." : "Class added.");
}

/* ---------- Delete ---------- */

function openDeleteDialog(cls) {
  if (!cls) return;
  state.deletingId = cls.id;

  const count = state.studentCounts.get(cls.id) || 0;
  document.getElementById("delete-message").textContent = count > 0
    ? `${cls.name} still has ${count} ${count === 1 ? "student" : "students"}. Move or delete them first, then delete the class.`
    : `Delete ${cls.name}? Its fee items will be deleted too. This cannot be undone.`;
  document.getElementById("delete-error").hidden = true;

  const confirmBtn = document.getElementById("delete-confirm");
  confirmBtn.disabled = count > 0;
  confirmBtn.textContent = "Delete";

  document.getElementById("delete-dialog").showModal();
}

async function confirmDelete() {
  const confirmBtn = document.getElementById("delete-confirm");
  const errorBox = document.getElementById("delete-error");
  errorBox.hidden = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Deleting...";

  const { error } = await supabase.from("classes").delete().eq("id", state.deletingId);

  if (error) {
    errorBox.textContent =
      error.code === "23503"
        ? "This class still has students, so it cannot be deleted."
        : error.message || "Could not delete the class. Please try again.";
    errorBox.hidden = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Delete";
    return;
  }

  document.getElementById("delete-dialog").close();
  await refresh();
  showToast("Class deleted.");
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