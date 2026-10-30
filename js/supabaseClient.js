import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// One shared client for the whole app, so every page uses the same login session.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);