// Paste your own values from Supabase: Project Settings > API.
// The anon key is safe to use in the browser ONLY if Row Level Security is enabled on your tables.
export const SUPABASE_URL = "https://hzmsokcylrwyjsdcogyz.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_ATvwWMEExfteAkg7cp46KA_cfUFcyOo";

// Where each role goes after login. Change these to match the pages you build.
export const ROLE_HOME = {
  admin: "admin/dashboard.html",
  teacher: "teacher/attendance.html",
  parent: "parent/dashboard.html",
};

// Demo accounts: create these three users in Supabase Auth and give each a row in `profiles`.
export const DEMO_ACCOUNTS = {
  admin:   { email: "admin@demo.com",   password: "Demo@1234" },
  teacher: { email: "teacher@demo.com", password: "Demo@1234" },
  parent:  { email: "parent@demo.com",  password: "Demo@1234" },
};

// ZGd6V3m6RSXxypWs