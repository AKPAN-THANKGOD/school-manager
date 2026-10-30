import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import { escapeHtml, naira, formatDate, isoDate, addDays, firstName, capitalize } from "./format.js";

const { profile } = await requireRole(["parent"]);
const content = mountShell({ active: "dashboard", title: "My children", profile });

content.innerHTML = `<div class="loading">Loading...</div>`;

try {
  render(await loadData());
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load your children's records: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadData() {
  // Row Level Security means these queries only ever return this parent's own children.
  const studentsResult = await supabase
    .from("students")
    .select("id, full_name, admission_no, class_id")
    .order("full_name");
  check(studentsResult);

  const students = studentsResult.data;
  if (students.length === 0) return { students: [] };

  const termResult = await supabase
    .from("terms")
    .select("id, name, session")
    .eq("is_current", true)
    .maybeSingle();
  check(termResult);
  const term = termResult.data;

  const studentIds = students.map((s) => s.id);
  const classIds = [...new Set(students.map((s) => s.class_id))];
  const since = isoDate(addDays(new Date(), -29));

  const [classes, attendance, balances, payments, fees] = await Promise.all([
    supabase.from("classes").select("id, name").in("id", classIds),
    supabase
      .from("attendance")
      .select("student_id, date, status")
      .in("student_id", studentIds)
      .gte("date", since)
      .order("date", { ascending: false }),
    term
      ? supabase
          .from("student_balances")
          .select("student_id, total_fees, total_paid, balance")
          .eq("term_id", term.id)
          .in("student_id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    term
      ? supabase
          .from("payments")
          .select("id, student_id, receipt_no, amount, method, paid_on")
          .eq("term_id", term.id)
          .in("student_id", studentIds)
          .order("paid_on", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    term
      ? supabase
          .from("fee_items")
          .select("class_id, name, amount")
          .eq("term_id", term.id)
          .in("class_id", classIds)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  [classes, attendance, balances, payments, fees].forEach(check);

  return {
    students,
    term,
    classes: classes.data,
    attendance: attendance.data,
    balances: balances.data,
    payments: payments.data,
    fees: fees.data,
  };
}

/* ---------- Rendering ---------- */

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function render(data) {
  const head = `
    <div class="page-head">
      <h2>${greeting()}, ${escapeHtml(firstName(profile.full_name))}</h2>
      <p>${data.term ? `${escapeHtml(data.term.name)}, ${escapeHtml(data.term.session)} session` : "Your children's attendance and school fees"}</p>
    </div>`;

  if (data.students.length === 0) {
    content.innerHTML = `${head}
      <div class="card">No children are linked to your account yet. Please ask the school office to link your child to this account.</div>`;
    return;
  }

  content.innerHTML = head + data.students.map((s) => childBlock(s, data)).join("");
}

function childBlock(student, data) {
  const className = data.classes.find((c) => c.id === student.class_id)?.name || "";
  const balance = data.balances.find((b) => b.student_id === student.id);
  const payments = data.payments.filter((p) => p.student_id === student.id);
  const feeLines = data.fees.filter((f) => f.class_id === student.class_id);
  const records = data.attendance.filter((a) => a.student_id === student.id);

  return `
    <section class="child-block">
      <div class="child-head">
        <h2>${escapeHtml(student.full_name)}</h2>
        <span>${escapeHtml(className)} &middot; ${escapeHtml(student.admission_no)}</span>
      </div>

      ${feeSection(balance, feeLines, payments, data.term)}
      ${attendanceSection(records)}
    </section>`;
}

function feeSection(balance, feeLines, payments, term) {
  if (!term || !balance || Number(balance.total_fees) === 0) {
    return `<div class="card" style="margin-bottom:1rem">No fees have been set for this term yet.</div>`;
  }

  const totalFees = Number(balance.total_fees);
  const totalPaid = Number(balance.total_paid);
  const owed = Math.max(0, Number(balance.balance));
  const pct = Math.min(100, Math.round((totalPaid / totalFees) * 100));

  return `
    <section class="cards">
      <div class="card">
        <div class="stat-label">Fees this term</div>
        <div class="stat-value">${naira(totalFees)}</div>
      </div>
      <div class="card">
        <div class="stat-label">Paid so far</div>
        <div class="stat-value">${naira(totalPaid)}</div>
        <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <div class="stat-sub">${pct}% of fees</div>
      </div>
      <div class="card">
        <div class="stat-label">Balance to pay</div>
        <div class="stat-value ${owed > 0 ? "danger" : ""}">${naira(owed)}</div>
        <div class="stat-sub">${owed > 0 ? "Please pay at the school office" : "Fees paid in full. Thank you."}</div>
      </div>
    </section>

    <section class="grid-2" style="margin-bottom:1rem">
      <div class="panel">
        <div class="panel-head"><h3>Fee breakdown</h3></div>
        <ul class="fee-lines">
          ${feeLines.map((f) => `<li><span>${escapeHtml(f.name)}</span><span>${naira(f.amount)}</span></li>`).join("")}
          <li class="total"><span>Total</span><span>${naira(totalFees)}</span></li>
        </ul>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Payments made</h3></div>
        ${payments.length === 0 ? `<div class="empty">No payments recorded yet.</div>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${payments.map((p) => `
                <tr>
                  <td class="cell-main">${escapeHtml(p.receipt_no)}</td>
                  <td>${escapeHtml(formatDate(p.paid_on))}</td>
                  <td><span class="badge neutral">${escapeHtml(capitalize(p.method))}</span></td>
                  <td class="num">${naira(p.amount)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`}
      </div>
    </section>`;
}

function attendanceSection(records) {
  if (records.length === 0) {
    return `
      <div class="panel">
        <div class="panel-head"><h3>Attendance, last 30 days</h3></div>
        <div class="empty">No attendance has been recorded yet.</div>
      </div>`;
  }

  const count = { present: 0, late: 0, absent: 0 };
  records.forEach((r) => { count[r.status] += 1; });
  const rate = Math.round(((records.length - count.absent) / records.length) * 100);

  // Most recent 10 school days, shown oldest to newest.
  const recent = records.slice(0, 10).reverse();

  return `
    <div class="panel">
      <div class="panel-head">
        <h3>Attendance, last 30 days</h3>
        <span class="badge ${rate >= 90 ? "success" : rate >= 75 ? "warning" : "danger"}">${rate}% attended</span>
      </div>
      <div class="att-summary">
        <span class="badge success">${count.present} present</span>
        <span class="badge warning">${count.late} late</span>
        <span class="badge danger">${count.absent} absent</span>
      </div>
      <div class="recent-days">
        ${recent.map((r) => {
          const d = new Date(`${r.date}T00:00:00`);
          return `
            <div class="day-chip ${escapeHtml(r.status)}">
              <span>${escapeHtml(capitalize(r.status))}</span>
              <small>${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</small>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}