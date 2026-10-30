import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, isoDate, addDays, formatDate } from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "attendance", title: "Attendance", profile });

const LOW_RATE = 75; // attendance below this percentage is flagged

const state = {
  classes: [],
  students: [],
  records: [],
  classId: "",
  from: isoDate(addDays(new Date(), -29)),
  to: isoDate(new Date()),
  rows: [], // per-student summary currently shown
};

content.innerHTML = `<div class="loading">Loading attendance...</div>`;

try {
  const [classes, students] = await Promise.all([
    supabase.from("classes").select("id, name").order("name"),
    fetchAll((from, to) =>
      supabase.from("students").select("id, full_name, admission_no, class_id").order("full_name").range(from, to)
    ),
  ]);
  if (classes.error) throw classes.error;

  state.classes = classes.data;
  state.students = students;

  renderPage();
  await loadRecords();
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load attendance: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

// The database returns at most 1000 rows per request, so read big tables in pages.
async function fetchAll(makeQuery) {
  const pageSize = 1000;
  const all = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await makeQuery(start, start + pageSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

async function loadRecords() {
  const area = document.getElementById("report-area");
  area.innerHTML = `<div class="loading">Loading...</div>`;

  const { from, to, classId } = state;

  try {
    const records = await fetchAll((start, end) => {
      let query = supabase
        .from("attendance")
        .select("student_id, class_id, date, status")
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .range(start, end);
      if (classId) query = query.eq("class_id", classId);
      return query;
    });

    // The filters may have changed while this was loading. Ignore stale answers.
    if (from !== state.from || to !== state.to || classId !== state.classId) return;

    state.records = records;
    renderReport();
  } catch (error) {
    console.error(error);
    area.innerHTML = `<div class="alert">Could not load attendance: ${escapeHtml(error.message || "unknown error")}</div>`;
  }
}

/* ---------- Page ---------- */

function renderPage() {
  const today = isoDate(new Date());

  content.innerHTML = `
    <div class="page-head">
      <h2>Attendance reports</h2>
      <p>See how often students are present, late or absent.</p>
    </div>

    <div class="panel" style="margin-bottom:1rem">
      <div class="att-controls">
        <div class="field">
          <label for="class-filter">Class</label>
          <select class="select" id="class-filter">
            <option value="">All classes</option>
            ${state.classes.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="from-date">From</label>
          <input class="input" type="date" id="from-date" value="${state.from}" max="${today}" />
        </div>
        <div class="field">
          <label for="to-date">To</label>
          <input class="input" type="date" id="to-date" value="${state.to}" max="${today}" />
        </div>
      </div>
      <div class="att-summary" id="range-note"></div>
    </div>

    <div id="report-area"></div>
  `;

  document.getElementById("class-filter").addEventListener("change", (event) => {
    state.classId = event.target.value;
    loadRecords();
  });

  const onDateChange = () => {
    const from = document.getElementById("from-date").value;
    const to = document.getElementById("to-date").value;
    const note = document.getElementById("range-note");

    if (!from || !to) { note.textContent = "Choose both dates."; return; }
    if (from > to) { note.innerHTML = `<span class="danger-text">The start date must be on or before the end date.</span>`; return; }

    state.from = from;
    state.to = to;
    updateRangeNote();
    loadRecords();
  };
  document.getElementById("from-date").addEventListener("change", onDateChange);
  document.getElementById("to-date").addEventListener("change", onDateChange);

  content.addEventListener("click", (event) => {
    if (event.target.closest("#export-btn")) exportCsv();
  });

  updateRangeNote();
}

function updateRangeNote() {
  document.getElementById("range-note").textContent =
    `Showing ${formatDate(state.from)} to ${formatDate(state.to)}.`;
}

/* ---------- Report ---------- */

function summarise() {
  const className = Object.fromEntries(state.classes.map((c) => [c.id, c.name]));
  const byStudent = new Map();

  state.records.forEach((r) => {
    const entry = byStudent.get(r.student_id) || { present: 0, late: 0, absent: 0 };
    entry[r.status] += 1;
    byStudent.set(r.student_id, entry);
  });

  const students = state.students.filter((s) => !state.classId || s.class_id === state.classId);

  return students.map((s) => {
    const counts = byStudent.get(s.id) || { present: 0, late: 0, absent: 0 };
    const days = counts.present + counts.late + counts.absent;
    return {
      id: s.id,
      name: s.full_name,
      admission: s.admission_no,
      className: className[s.class_id] || "-",
      ...counts,
      days,
      rate: days > 0 ? Math.round(((days - counts.absent) / days) * 100) : null,
    };
  });
}

function rateBadge(rate) {
  if (rate === null) return `<span class="badge neutral">No records</span>`;
  const kind = rate >= 90 ? "success" : rate >= LOW_RATE ? "warning" : "danger";
  return `<span class="badge ${kind}">${rate}%</span>`;
}

function renderReport() {
  const area = document.getElementById("report-area");
  const rows = summarise();

  // Students with the lowest attendance first; students with no records go last.
  rows.sort((a, b) => {
    if (a.rate === null && b.rate === null) return a.name.localeCompare(b.name);
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return a.rate - b.rate || a.name.localeCompare(b.name);
  });
  state.rows = rows;

  const total = state.records.length;
  const count = { present: 0, late: 0, absent: 0 };
  state.records.forEach((r) => { count[r.status] += 1; });
  const overall = total > 0 ? Math.round(((total - count.absent) / total) * 100) : null;
  const lowCount = rows.filter((r) => r.rate !== null && r.rate < LOW_RATE).length;

  if (rows.length === 0) {
    area.innerHTML = `<div class="panel"><div class="empty">There are no students in this selection.</div></div>`;
    return;
  }

  area.innerHTML = `
    <section class="cards">
      <div class="card">
        <div class="stat-label">Overall attendance</div>
        <div class="stat-value">${overall === null ? "No data" : overall + "%"}</div>
        <div class="stat-sub">${total} ${total === 1 ? "record" : "records"} in this period</div>
      </div>
      <div class="card">
        <div class="stat-label">Present</div>
        <div class="stat-value">${count.present}</div>
      </div>
      <div class="card">
        <div class="stat-label">Late</div>
        <div class="stat-value">${count.late}</div>
      </div>
      <div class="card">
        <div class="stat-label">Absent</div>
        <div class="stat-value ${count.absent > 0 ? "danger" : ""}">${count.absent}</div>
      </div>
      <div class="card">
        <div class="stat-label">Below ${LOW_RATE}% attendance</div>
        <div class="stat-value ${lowCount > 0 ? "danger" : ""}">${lowCount}</div>
        <div class="stat-sub">${lowCount === 1 ? "student" : "students"} to follow up</div>
      </div>
    </section>

    <div class="panel">
      <div class="panel-head">
        <h3>By student</h3>
        <button type="button" class="btn btn-secondary btn-sm" id="export-btn">Download CSV</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th class="num">Present</th>
              <th class="num">Late</th>
              <th class="num">Absent</th>
              <th class="num">Days marked</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>
                  <div class="cell-main">${escapeHtml(r.name)}</div>
                  <div class="cell-sub">${escapeHtml(r.admission)}</div>
                </td>
                <td>${escapeHtml(r.className)}</td>
                <td class="num">${r.present}</td>
                <td class="num">${r.late}</td>
                <td class="num ${r.absent > 0 ? "danger-text" : ""}">${r.absent}</td>
                <td class="num">${r.days}</td>
                <td>${rateBadge(r.rate)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- CSV export ---------- */

function csvCell(value) {
  let text = String(value ?? "");
  // Stop spreadsheet programs from treating text as a formula.
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const header = ["Admission no", "Student", "Class", "Present", "Late", "Absent", "Days marked", "Attendance %"];
  const lines = [header.map(csvCell).join(",")];

  state.rows.forEach((r) => {
    lines.push(
      [r.admission, r.name, r.className, r.present, r.late, r.absent, r.days, r.rate === null ? "" : r.rate]
        .map(csvCell)
        .join(",")
    );
  });

  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${state.from}-to-${state.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}