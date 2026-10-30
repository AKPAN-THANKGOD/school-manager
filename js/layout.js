import { logout } from "./guard.js";
import { escapeHtml } from "./format.js";

// Menus per role. Links are relative, so each page sits in its own role folder
// (admin/, teacher/, parent/).
const NAVS = {
  admin: [
    { key: "dashboard", label: "Dashboard",  href: "dashboard.html" },
    { key: "students",  label: "Students",   href: "students.html" },
    { key: "classes",   label: "Classes",    href: "classes.html" },
    { key: "fees",      label: "Fees",       href: "fees.html" },
    { key: "payments",  label: "Payments",   href: "payments.html" },
    { key: "attendance", label: "Attendance", href: "attendance.html" },
  ],
  teacher: [
    { key: "attendance", label: "Attendance", href: "attendance.html" },
  ],
  parent: [
    { key: "dashboard", label: "My children", href: "dashboard.html" },
  ],
};

const ROLE_LABELS = { admin: "Administrator", teacher: "Teacher", parent: "Parent" };

/**
 * Builds the sidebar and top bar around a page, and returns the empty
 * <main> element for the page to fill with its own content.
 *
 *   const content = mountShell({ active: "dashboard", title: "Dashboard", profile });
 *
 * The page needs an empty <div id="app"></div> in its HTML.
 */
export function mountShell({ active, title, profile }) {
  document.title = `${title} | School Manager`;

  const links = (NAVS[profile.role] || []).map(
    (item) =>
      `<a href="${item.href}" class="${item.key === active ? "active" : ""}">${item.label}</a>`
  ).join("");

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  document.getElementById("app").innerHTML = `
    <div class="shell">
      <div class="overlay" id="overlay"></div>

      <aside class="sidebar" id="sidebar">
        <div class="side-brand"><span class="logo-sm">SM</span><span>School Manager</span></div>
        <nav class="side-nav">${links}</nav>
        <div class="side-user">
          <div class="user-name">${escapeHtml(profile.full_name)}</div>
          <div class="user-role">${escapeHtml(ROLE_LABELS[profile.role] || "")}</div>
          <button type="button" class="btn-signout" id="signout-btn">Sign out</button>
        </div>
      </aside>

      <div class="main-col">
        <header class="topbar">
          <button type="button" class="menu-btn" id="menu-btn" aria-label="Open menu">Menu</button>
          <h1>${escapeHtml(title)}</h1>
          <span class="topbar-date">${today}</span>
        </header>
        <main class="content" id="content"></main>
      </div>
    </div>
  `;

  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const toggleMenu = (open) => {
    sidebar.classList.toggle("open", open);
    overlay.classList.toggle("open", open);
  };

  document.getElementById("menu-btn").addEventListener("click", () => toggleMenu(true));
  overlay.addEventListener("click", () => toggleMenu(false));
  document.getElementById("signout-btn").addEventListener("click", logout);

  return document.getElementById("content");
}