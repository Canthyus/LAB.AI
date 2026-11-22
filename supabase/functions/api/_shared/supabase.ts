import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export type Admin = SupabaseClient;

export function adminClient(): Admin {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "Supabase não configurado no ambiente da função");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Valida o JWT do chamador e devolve o usuário + cliente com service role (para operações do servidor). */
export async function requireUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Não autenticado", "unauthenticated");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessão inválida ou expirada", "unauthenticated");
  return { user: data.user, admin };
}
