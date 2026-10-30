import { supabase } from "./supabaseClient.js";
import { ROLE_HOME, DEMO_ACCOUNTS } from "./config.js";

/* ---------- Element references ---------- */
const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const emailError = document.getElementById("email-error");
const passwordError = document.getElementById("password-error");
const alertBox = document.getElementById("alert");
const submitBtn = document.getElementById("submit-btn");
const btnLabel = submitBtn.querySelector(".btn-label");
const spinner = submitBtn.querySelector(".spinner");
const toggleBtn = document.getElementById("toggle-password");
const forgotLink = document.getElementById("forgot-link");

/* ---------- Small UI helpers ---------- */
function showAlert(message, type = "error") {
  alertBox.textContent = message;
  alertBox.className = `alert ${type}`;
  alertBox.hidden = false;
}

function clearAlert() {
  alertBox.hidden = true;
  alertBox.textContent = "";
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  spinner.hidden = !isLoading;
  btnLabel.textContent = isLoading ? "Signing in..." : "Sign in";
}

function setFieldError(input, errorEl, message) {
  errorEl.textContent = message;
  input.classList.toggle("invalid", Boolean(message));
}

function validate() {
  let ok = true;
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email) {
    setFieldError(emailInput, emailError, "Enter your email address.");
    ok = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, emailError, "Enter a valid email address.");
    ok = false;
  } else {
    setFieldError(emailInput, emailError, "");
  }

  if (!password) {
    setFieldError(passwordInput, passwordError, "Enter your password.");
    ok = false;
  } else {
    setFieldError(passwordInput, passwordError, "");
  }

  return ok;
}

/* ---------- Role lookup and redirect ---------- */
async function getRole(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  return data.role;
}

function redirectByRole(role) {
  const target = ROLE_HOME[role];
  if (!target) {
    throw new Error("Your account has no valid role. Please contact the school admin.");
  }
  window.location.href = target;
}

/* ---------- Friendly error messages ---------- */
function friendlyError(error) {
  const msg = (error?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "Incorrect email or password.";
  if (msg.includes("email not confirmed")) return "Please confirm your email before signing in.";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "Network problem. Check your internet connection and try again.";
  return error?.message || "Something went wrong. Please try again.";
}

/* ---------- Sign in ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAlert();
  if (!validate()) return;

  setLoading(true);
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) throw error;

    const role = await getRole(data.user.id);
    if (!role) {
      await supabase.auth.signOut();
      throw new Error("Your account has no profile yet. Please contact the school admin.");
    }

    redirectByRole(role);
  } catch (error) {
    showAlert(friendlyError(error));
    setLoading(false);
  }
});

/* ---------- Show / hide password ---------- */
toggleBtn.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "Hide" : "Show";
  toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

/* ---------- Forgot password ---------- */
forgotLink.addEventListener("click", async (event) => {
  event.preventDefault();
  clearAlert();
  const email = emailInput.value.trim();

  if (!email) {
    setFieldError(emailInput, emailError, "Enter your email first, then click Forgot password.");
    emailInput.focus();
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`,
  });

  if (error) {
    showAlert(friendlyError(error));
  } else {
    showAlert("If that email has an account, a reset link has been sent.", "success");
  }
});

/* ---------- Demo buttons ---------- */
document.querySelectorAll(".btn-demo").forEach((btn) => {
  btn.addEventListener("click", () => {
    const account = DEMO_ACCOUNTS[btn.dataset.role];
    emailInput.value = account.email;
    passwordInput.value = account.password;
    setFieldError(emailInput, emailError, "");
    setFieldError(passwordInput, passwordError, "");
    clearAlert();
  });
});

/* ---------- Already signed in? Skip the login page ---------- */
(async function checkExistingSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    const role = await getRole(data.session.user.id);
    if (role && ROLE_HOME[role]) redirectByRole(role);
  }
})();