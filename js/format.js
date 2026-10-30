// Small helpers for showing data safely and neatly.

/** Make text safe to put inside innerHTML (stops names like <script> from running). */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 45000 -> "₦45,000" */
export function naira(amount) {
  const n = Number(amount) || 0;
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** "2026-10-06" -> "6 Oct 2026" (read as a local date, so it never shifts by a day) */
export function formatDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Date -> "2026-10-23" using the local date (not UTC). */
export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

export function capitalize(text) {
  const s = String(text || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}