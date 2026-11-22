import { supabase } from "./supabase";

/** Divide o texto do roteiro em sequências usando os cabeçalhos (SEQUÊNCIA 1 — …, CENA, ATO). Sem cabeçalhos, divide em blocos. */
export function deriveSequences(content: string, targetSeconds: number) {
  const head = /^\s*(sequ[eê]ncia|sequence|cena|ato|act|scene)\b.*$/i;
  const lines = content.split(/\r?\n/);
  const parts: { title: string; body: string[] }[] = [];
  for (const ln of lines) {
    if (head.test(ln) && ln.trim().length < 160) parts.push({ title: ln.trim().replace(/^[#*\s]+|[*\s]+$/g, ""), body: [] });
    else if (parts.length) parts[parts.length - 1].body.push(ln);
  }
  if (!parts.length) {
    const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const size = Math.max(1, Math.ceil(paras.length / 4));
    for (let i = 0; i < paras.length; i += size) parts.push({ title: `Sequência ${parts.length + 1}`, body: paras.slice(i, i + size) });
  }
  const per = Math.max(3, Math.round(targetSeconds / Math.max(1, parts.length)));
  return parts.slice(0, 30).map((p, i) => ({
    position: i + 1, title: p.title.slice(0, 200),
    summary: p.body.join(" ").replace(/\s+/g, " ").trim().slice(0, 300) || null, estimated_duration_seconds: per,
  }));
}

/** Garante que o projeto tenha sequências; se não tiver, cria a partir do texto do roteiro. Devolve quantas existem. */
export async function ensureSequences(projectId: string, scriptId: string, content: string, targetSeconds: number): Promise<number> {
  const { count } = await supabase.from("sequences").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if (count) return count;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sessão expirada. Entre novamente.");
  const rows = deriveSequences(content, targetSeconds).map((r) => ({ ...r, user_id: u.user!.id, project_id: projectId, script_id: scriptId }));
  if (!rows.length) throw new Error("O roteiro está vazio. Gere ou escreva o roteiro primeiro.");
  const { error } = await supabase.from("sequences").insert(rows);
  if (error) throw error;
  return rows.length;
}
