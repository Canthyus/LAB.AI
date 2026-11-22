import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon);

// Só a anon key (pública) vive no navegador. A API Key da Agnes nunca passa por aqui.
export const supabase = createClient(url ?? "http://localhost:54321", anon ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});
