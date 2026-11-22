// Contexto de um projeto (projeto + personagens + estilo) e utilidades de prompt compartilhadas.
import type { Admin } from "./supabase.ts";
import { HttpError } from "./http.ts";

export type Ctx = {
  project: any;
  characters: any[];
  style: string;
  refPathByCharacter: Map<string, string>;
};

export function styleModifierOf(style: any): string {
  const c = style?.config ?? {};
  return [c.prompt_modifier, c.lighting && `lighting: ${c.lighting}`, c.photography && `photography: ${c.photography}`]
    .filter(Boolean).join(", ");
}

export async function loadContext(admin: Admin, userId: string, projectId: string): Promise<Ctx> {
  const { data: project } = await admin.from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (!project) throw new HttpError(404, "Projeto não encontrado");

  const { data: links } = await admin.from("project_characters").select("characters(*)").eq("project_id", projectId).eq("user_id", userId);
  const characters = (links ?? []).map((l: any) => l.characters).filter(Boolean);

  let style = "";
  if (project.visual_style_id) {
    const { data: s } = await admin.from("visual_styles").select("config,user_id").eq("id", project.visual_style_id).maybeSingle();
    if (s && (!s.user_id || s.user_id === userId)) style = styleModifierOf(s);
  }

  const refPathByCharacter = new Map<string, string>();
  if (characters.length) {
    const { data: refs } = await admin.from("character_references").select("character_id,storage_path,is_primary,kind")
      .in("character_id", characters.map((c: any) => c.id)).eq("user_id", userId).eq("is_primary", true);
    for (const r of refs ?? []) refPathByCharacter.set(r.character_id, r.storage_path);
  }
  return { project, characters, style, refPathByCharacter };
}

/** Extrai o primeiro objeto JSON de uma resposta de LLM (aceita cercas ```json e texto em volta). */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "A IA não devolveu JSON válido. Tente novamente.", "bad_ai_output");
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "A IA devolveu JSON malformado. Tente novamente.", "bad_ai_output");
  }
}

export const s = (v: unknown, max = 2000): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
export const n = (v: unknown, min: number, max: number, def: number): number => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};

export function castSummary(chars: any[]): string {
  return chars.map((c) => `- ${c.name}: ${[c.apparent_age, c.personality, c.story_role].filter(Boolean).join("; ")}`).join("\n") || "(sem personagens definidos)";
}

/** Converte nomes devolvidos pela IA em ids de personagens do projeto. */
export function idsByNames(chars: any[], names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const out = new Set<string>();
  for (const nm of names) {
    const k = String(nm).trim().toLowerCase();
    const hit = chars.find((c) => c.name.toLowerCase() === k) ?? chars.find((c) => k && (c.name.toLowerCase().includes(k) || k.includes(c.name.toLowerCase())));
    if (hit) out.add(hit.id);
  }
  return [...out];
}

export function charactersVisual(chars: any[], ids: string[]): string {
  return chars.filter((c) => ids.includes(c.id) && c.visual_prompt_en).map((c) => `${c.name}: ${c.visual_prompt_en}`).join(" | ");
}
