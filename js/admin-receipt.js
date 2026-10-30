import { supabase } from "./supabaseClient.js";
import { requireRole } from "./guard.js";
import { escapeHtml, naira, formatDate, capitalize } from "./format.js";

await requireRole(["admin"]);

// Change this to your school's name. It is printed at the top of every receipt.
const SCHOOL_NAME = "School Manager Demo School";
const SCHOOL_ADDRESS = "Uyo, Akwa Ibom State";

const root = document.getElementById("receipt-root");
const paymentId = new URLSearchParams(window.location.search).get("id");

if (!paymentId) {
  showError("No receipt was selected.");
} else {
  try {
    await render();
  } catch (error) {
    console.error(error);
    showError(error.message || "Could not load this receipt.");
  }
}

function showError(message) {
  root.innerHTML = `<div class="alert">${escapeHtml(message)}</div>`;
}

async function render() {
  const { data: payment, error } = await supabase
    .from("payments")
    .select(`
      id, receipt_no, amount, method, paid_on, note, created_at, student_id, term_id,
      students(full_name, admission_no, classes(name)),
      terms(name, session)
    `)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throw error;
  if (!payment) { showError("Receipt not found."); return; }

  // Work out the balance as it stood right after THIS payment.
  const [{ data: studentRow, error: e1 }, { data: sameTerm, error: e2 }] = await Promise.all([
    supabase.from("students").select("class_id").eq("id", payment.student_id).single(),
    supabase
      .from("payments")
      .select("amount, created_at")
      .eq("student_id", payment.student_id)
      .eq("term_id", payment.term_id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const { data: fees, error: e3 } = await supabase
    .from("fee_items")
    .select("name, amount")
    .eq("class_id", studentRow.class_id)
    .eq("term_id", payment.term_id)
    .order("name");
  if (e3) throw e3;

  const totalFees = fees.reduce((sum, f) => sum + Number(f.amount), 0);
  const paidUpToNow = sameTerm
    .filter((p) => p.created_at <= payment.created_at)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = totalFees - paidUpToNow;

  document.title = `Receipt ${payment.receipt_no}`;

  root.innerHTML = `
    <div class="receipt-actions">
      <button type="button" class="btn btn-primary" id="print-btn">Print receipt</button>
      <button type="button" class="btn btn-secondary" id="close-btn">Close</button>
    </div>

    <article class="receipt">
      <header class="receipt-head">
        <div class="receipt-school">${escapeHtml(SCHOOL_NAME)}</div>
        <div class="receipt-address">${escapeHtml(SCHOOL_ADDRESS)}</div>
        <div class="receipt-title">Fee Payment Receipt</div>
      </header>

      <dl class="receipt-meta">
        <div><dt>Receipt no.</dt><dd>${escapeHtml(payment.receipt_no)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(formatDate(payment.paid_on))}</dd></div>
        <div><dt>Student</dt><dd>${escapeHtml(payment.students?.full_name || "")}</dd></div>
        <div><dt>Admission no.</dt><dd>${escapeHtml(payment.students?.admission_no || "")}</dd></div>
        <div><dt>Class</dt><dd>${escapeHtml(payment.students?.classes?.name || "")}</dd></div>
        <div><dt>Term</dt><dd>${escapeHtml(payment.terms?.name || "")}, ${escapeHtml(payment.terms?.session || "")}</dd></div>
        <div><dt>Method</dt><dd>${escapeHtml(capitalize(payment.method))}</dd></div>
        ${payment.note ? `<div><dt>Note</dt><dd>${escapeHtml(payment.note)}</dd></div>` : ""}
      </dl>

      <table class="receipt-table">
        <tbody>
          <tr><td>Total fees this term</td><td class="num">${naira(totalFees)}</td></tr>
          <tr><td>Paid before this payment</td><td class="num">${naira(paidUpToNow - Number(payment.amount))}</td></tr>
          <tr class="receipt-paid"><td>Amount paid now</td><td class="num">${naira(payment.amount)}</td></tr>
          <tr class="receipt-balance"><td>Balance remaining</td><td class="num">${naira(Math.max(0, balance))}</td></tr>
        </tbody>
      </table>

      <footer class="receipt-foot">
        <p>${balance <= 0 ? "Fees paid in full. Thank you." : "Thank you for your payment."}</p>
        <div class="receipt-sign"><span>Received by (signature)</span></div>
      </footer>
    </article>
  `;

  document.getElementById("print-btn").addEventListener("click", () => window.print());
  document.getElementById("close-btn").addEventListener("click", () => window.close());
}