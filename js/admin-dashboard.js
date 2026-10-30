import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { mountShell } from "./layout.js";
import {
  escapeHtml, naira, formatDate, isoDate, addDays, firstName, capitalize,
} from "./format.js";

const { profile } = await requireRole(["admin"]);
const content = mountShell({ active: "dashboard", title: "Dashboard", profile });

content.innerHTML = `<div class="loading">Loading dashboard...</div>`;

try {
  const data = await loadData();
  render(data);
} catch (error) {
  console.error(error);
  content.innerHTML = `<div class="alert">Could not load the dashboard: ${escapeHtml(error.message || "unknown error")}</div>`;
}

/* ---------- Data ---------- */

function check({ error }) {
  if (error) throw error;
}

async function loadData() {
  const termResult = await supabase
    .from("terms")
    .select("id, session, name")
    .eq("is_current", true)
    .maybeSingle();
  check(termResult);

  const term = termResult.data;
  if (!term) return { term: null };

  const fromDate = isoDate(addDays(new Date(), -6)); // last 7 days including today

  const [balances, classes, payments, attTotal, attAbsent] = await Promise.all([
    supabase
      .from("student_balances")
      .select("student_id, full_name, admission_no, class_id, total_fees, total_paid, balance")
      .eq("term_id", term.id),
    supabase.from("classes").select("id, name"),
    supabase
      .from("payments")
      .select("id, receipt_no, amount, method, paid_on, students(full_name, admission_no)")
      .eq("term_id", term.id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("attendance").select("id", { count: "exact", head: true }).gte("date", fromDate),
    supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .gte("date", fromDate)
      .eq("status", "absent"),
  ]);

  [balances, classes, payments, attTotal, attAbsent].forEach(check);

  return {
    term,
    balances: balances.data,
    classes: classes.data,
    payments: payments.data,
    attendanceTotal: attTotal.count ?? 0,
    attendanceAbsent: attAbsent.count ?? 0,
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
  if (!data.term) {
    content.innerHTML = `
      <div class="page-head"><h2>${greeting()}, ${escapeHtml(firstName(profile.full_name))}</h2></div>
      <div class="card">No current term is set. Add a term and mark it as current to see your figures here.</div>`;
    return;
  }

  const { term, balances, classes, payments, attendanceTotal, attendanceAbsent } = data;
  const className = Object.fromEntries(classes.map((c) => [c.id, c.name]));

  const totalFees = balances.reduce((sum, b) => sum + Number(b.total_fees), 0);
  const totalPaid = balances.reduce((sum, b) => sum + Number(b.total_paid), 0);
  const outstanding = balances.reduce((sum, b) => sum + Math.max(0, Number(b.balance)), 0);
  const collectedPct = totalFees > 0 ? Math.min(100, Math.round((totalPaid / totalFees) * 100)) : 0;

  const attendanceRate =
    attendanceTotal > 0
      ? Math.round((1 - attendanceAbsent / attendanceTotal) * 100) + "%"
      : "No data";

  const defaulters = balances
    .filter((b) => Number(b.balance) > 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 5);

  content.innerHTML = `
    <div class="page-head">
      <h2>${greeting()}, ${escapeHtml(firstName(profile.full_name))}</h2>
      <p>${escapeHtml(term.name)}, ${escapeHtml(term.session)} session</p>
    </div>

    <section class="cards">
      <div class="card">
        <div class="stat-label">Students</div>
        <div class="stat-value">${balances.length}</div>
        <div class="stat-sub">${classes.length} ${classes.length === 1 ? "class" : "classes"}</div>
      </div>
      <div class="card">
        <div class="stat-label">Fees expected</div>
        <div class="stat-value">${naira(totalFees)}</div>
        <div class="stat-sub">This term</div>
      </div>
      <div class="card">
        <div class="stat-label">Fees collected</div>
        <div class="stat-value">${naira(totalPaid)}</div>
        <div class="progress" aria-hidden="true"><span style="width:${collectedPct}%"></span></div>
        <div class="stat-sub">${collectedPct}% of expected</div>
      </div>
      <div class="card">
        <div class="stat-label">Outstanding</div>
        <div class="stat-value ${outstanding > 0 ? "danger" : ""}">${naira(outstanding)}</div>
        <div class="stat-sub">${defaulters.length === 0 ? "Nobody owes" : "Still to be paid"}</div>
      </div>
      <div class="card">
        <div class="stat-label">Attendance, last 7 days</div>
        <div class="stat-value">${attendanceRate}</div>
        <div class="stat-sub">Students not marked absent</div>
      </div>
    </section>

    <section class="grid-2">
      <div class="panel">
        <div class="panel-head">
          <h3>Highest outstanding balances</h3>
          <a href="fees.html">View all</a>
        </div>
        ${defaulters.length === 0 ? `<div class="empty">No outstanding balances.</div>` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Student</th><th>Class</th><th class="num">Paid</th><th class="num">Balance</th></tr>
            </thead>
            <tbody>
              ${defaulters.map((b) => `
                <tr>
                  <td>
                    <div class="cell-main">${escapeHtml(b.full_name)}</div>
                    <div class="cell-sub">${escapeHtml(b.admission_no)}</div>
                  </td>
                  <td>${escapeHtml(className[b.class_id] || "-")}</td>
                  <td class="num">${naira(b.total_paid)}</td>
                  <td class="num danger-text">${naira(b.balance)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Recent payments</h3>
          <a href="payments.html">View all</a>
        </div>
        ${payments.length === 0 ? `<div class="empty">No payments recorded yet.</div>` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Student</th><th>Date</th><th>Method</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              ${payments.map((p) => `
                <tr>
                  <td>
                    <div class="cell-main">${escapeHtml(p.students?.full_name || "Unknown")}</div>
                    <div class="cell-sub">${escapeHtml(p.receipt_no)}</div>
                  </td>
                  <td>${escapeHtml(formatDate(p.paid_on))}</td>
                  <td><span class="badge neutral">${escapeHtml(capitalize(p.method))}</span></td>
                  <td class="num">${naira(p.amount)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`}
      </div>
    </section>
  `;
}