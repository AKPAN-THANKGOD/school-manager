import { supabase } from "./supabaseClient.js";
import { ROLE_HOME } from "./config.js";

// The project root, worked out from this file's own location (js/guard.js).
// This makes redirects work from any folder depth (admin/, teacher/, parent/...).
const ROOT = new URL("../", import.meta.url);
const LOGIN_URL = new URL("index.html", ROOT).href;

// Hide the page until the check finishes, so protected content never flashes on screen.
document.documentElement.style.visibility = "hidden";

function goToLogin() {
  window.location.replace(LOGIN_URL);
}

function goToHome(role) {
  const target = ROLE_HOME[role];
  if (target) {
    window.location.replace(new URL(target, ROOT).href);
  } else {
    goToLogin();
  }
}

/**
 * Call this at the top of every protected page.
 *
 *   const { user, profile } = await requireRole(["admin"]);
 *
 * - Not signed in            -> sent to the login page
 * - Signed in, wrong role    -> sent to their own dashboard
 * - Signed in, allowed       -> page is shown, and you get the user and profile back
 */
export async function requireRole(allowedRoles = []) {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    goToLogin();
    return new Promise(() => {}); // stop the page script from continuing while redirecting
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", session.user.id)
    .single();

  if (error || !profile) {
    await supabase.auth.signOut();
    goToLogin();
    return new Promise(() => {});
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    goToHome(profile.role);
    return new Promise(() => {});
  }

  // If the user signs out in another tab, send this tab to the login page too.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") goToLogin();
  });

  // Fill in any element marked data-user-name="" with the person's name.
  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = profile.full_name;
  });

  document.documentElement.style.visibility = "visible";
  return { user: session.user, profile };
}

/** Sign out and return to the login page. */
export async function logout() {
  await supabase.auth.signOut();
  goToLogin();
}