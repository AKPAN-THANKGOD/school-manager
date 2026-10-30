import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, isoDate, formatDate } from "./format.js";

const { user, profile } = await requireRole(["teacher"]);
const content = mountShell({ active: "attendance", title: "Attendance", profile });

const state = {
  classes: [],
  classId: "",
  date: isoDate(new Date()),
  students: [],
  marks: new Map(), // student_id -> "present" | "absent" | "late"
  hadSavedRecords: false,
};

content.innerHTML = `<div class="loading">Loading your classes...</div>`;

try {
  const { data, error } = await supabase.from("classes").select("id, name").order("name");
  if (error) throw error;
  state.classes = data;

  if (state.classes.length === 0) {
    content.innerHTML = `
      <div class="page-head"><h2>Attendance</h2></div>
      <div class="card">You have not been assigned to a class yet. Ask the school admin to assign you one.</div>`;
  } else {
    state.classId = state.classes[0].id;
    renderPage();
    await loadRegister();
  }
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load your classes: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Page layout (built once) ---------- */

function renderPage() {
  const today = isoDate(new Date());

  content.innerHTML = `
    <div class="page-head">
      <h2>Mark attendance</h2>
      <p>Choose a class and a date, mark each student, then save.</p>
    </div>

    <div class="panel">
      <div class="att-controls">
        <div class="field">
          <label for="class-select">Class</label>
          <select class="select" id="class-select">
            ${state.classes
              .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="date-input">Date</label>
          <input class="input" type="date" id="date-input" value="${today}" max="${today}" />
        </div>
      </div>

      <div id="notice"></div>
      <div id="register"><div class="loading">Loading students...</div></div>
    </div>
  `;

  document.getElementById("class-select").addEventListener("change", async (event) => {
    state.classId = event.target.value;
    await loadRegister();
  });

  document.getElementById("date-input").addEventListener("change", async (event) => {
    const value = event.target.value;
    if (!value || value > isoDate(new Date())) {
      event.target.value = state.date;
      showToast("Choose a date that is not in the future.", true);
      return;
    }
    state.date = value;
    await loadRegister();
  });

  // One listener handles every radio button and the buttons in the register.
  content.addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches('input[type="radio"][data-student]')) {
      state.marks.set(input.dataset.student, input.value);
      updateSummary();
    }
  });

  content.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "mark-all-present") {
      state.students.forEach((s) => state.marks.set(s.id, "present"));
      renderRegister();
    } else if (button.id === "save-btn") {
      saveRegister(button);
    }
  });
}

/* ---------- Loading the register for the chosen class and date ---------- */

async function loadRegister() {
  const register = document.getElementById("register");
  register.innerHTML = `<div class="loading">Loading students...</div>`;
  document.getElementById("notice").innerHTML = "";

  const requestedClass = state.classId;
  const requestedDate = state.date;

  try {
    const [students, records] = await Promise.all([
      supabase
        .from("students")
        .select("id, full_name, admission_no")
        .eq("class_id", requestedClass)
        .order("full_name"),
      supabase
        .from("attendance")
        .select("student_id, status")
        .eq("class_id", requestedClass)
        .eq("date", requestedDate),
    ]);
    if (students.error) throw students.error;
    if (records.error) throw records.error;

    // The teacher may have changed class or date while this was loading. Ignore stale answers.
    if (requestedClass !== state.classId || requestedDate !== state.date) return;

    state.students = students.data;
    state.marks = new Map(records.data.map((r) => [r.student_id, r.status]));
    state.hadSavedRecords = records.data.length > 0;

    // Nothing saved yet for this day: start everyone as present so the teacher
    // only has to change the exceptions.
    if (!state.hadSavedRecords) {
      state.students.forEach((s) => state.marks.set(s.id, "present"));
    }

    renderRegister();
  } catch (error) {
    console.error(error);
    register.innerHTML = `<div class="alert" style="margin:1rem 1.2rem">Could not load students: ${escapeHtml(error.message || "unknown error")}</div>`;
  }
}

/* ---------- Register ---------- */

function renderRegister() {
  const register = document.getElementById("register");
  const notice = document.getElementById("notice");

  const day = new Date(`${state.date}T00:00:00`).getDay();
  const weekend = day === 0 || day === 6;

  const bits = [];
  if (weekend) bits.push("This date is a weekend.");
  if (state.hadSavedRecords) bits.push(`Attendance for ${formatDate(state.date)} was already saved. Saving again will update it.`);
  else if (state.students.length > 0) bits.push("Not saved yet. Everyone starts as present, so only change the exceptions.");
  notice.innerHTML = bits.length
    ? `<div class="att-summary"><span>${escapeHtml(bits.join(" "))}</span></div>`
    : "";

  if (state.students.length === 0) {
    register.innerHTML = `<div class="empty">There are no students in this class yet.</div>`;
    return;
  }

  register.innerHTML = `
    <div class="att-summary" id="summary"></div>
    <ul class="att-list">
      ${state.students.map((s) => `
        <li class="att-row">
          <div>
            <div class="cell-main">${escapeHtml(s.full_name)}</div>
            <div class="cell-sub">${escapeHtml(s.admission_no)}</div>
          </div>
          <div class="seg" role="radiogroup" aria-label="Attendance for ${escapeHtml(s.full_name)}">
            ${["present", "absent", "late"].map((status) => `
              <label>
                <input type="radio" name="att-${escapeHtml(s.id)}" value="${status}"
                       data-student="${escapeHtml(s.id)}" ${state.marks.get(s.id) === status ? "checked" : ""} />
                <span>${status.charAt(0).toUpperCase() + status.slice(1)}</span>
              </label>`).join("")}
          </div>
        </li>`).join("")}
    </ul>
    <div class="att-foot">
      <button type="button" class="btn btn-primary" id="save-btn">Save attendance</button>
    </div>
  `;

  updateSummary();
}

function updateSummary() {
  const summary = document.getElementById("summary");
  if (!summary) return;

  const counts = { present: 0, absent: 0, late: 0 };
  state.students.forEach((s) => {
    const mark = state.marks.get(s.id);
    if (mark) counts[mark] += 1;
  });

  summary.innerHTML = `
    <span class="badge success">${counts.present} present</span>
    <span class="badge danger">${counts.absent} absent</span>
    <span class="badge warning">${counts.late} late</span>
    <span class="spacer"></span>
    <button type="button" class="btn btn-secondary btn-sm" id="mark-all-present">Mark all present</button>
  `;
}

/* ---------- Saving ---------- */

async function saveRegister(button) {
  const unmarked = state.students.filter((s) => !state.marks.get(s.id));
  if (unmarked.length > 0) {
    showToast(`Mark every student first. ${unmarked.length} still unmarked.`, true);
    return;
  }

  button.disabled = true;
  button.textContent = "Saving...";

  const rows = state.students.map((s) => ({
    student_id: s.id,
    class_id: state.classId,
    date: state.date,
    status: state.marks.get(s.id),
    marked_by: user.id,
  }));

  // Saving the same day twice updates the old marks instead of failing,
  // because a student can only have one record per day.
  const { error } = await supabase
    .from("attendance")
    .upsert(rows, { onConflict: "student_id,date" });

  button.disabled = false;
  button.textContent = "Save attendance";

  if (error) {
    console.error(error);
    showToast(error.message || "Could not save attendance. Please try again.", true);
    return;
  }

  state.hadSavedRecords = true;
  renderRegister();
  showToast(`Attendance saved for ${formatDate(state.date)}.`);
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