// Módulo de personagens com IA (tudo via Agnes, no servidor):
//  - extract:         lê a ideia do projeto e cria as fichas dos personagens (texto)
//  - refresh_prompt:  recria o prompt visual (inglês) após edição humana da ficha (texto)
//  - generate_image:  enfileira imagem principal ("main") ou folha de referência ("sheet")
// Consistência visual: a folha e as futuras cenas usam a imagem principal aprovada como referência
// e o mesmo visual_prompt_en + modificador do estilo escolhido.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { enqueueJob, runText } from "../_shared/agnes/engine.ts";

type Body = {
  action: "extract" | "refresh_prompt" | "generate_image";
  project_id?: string;
  character_id?: string;
  idea?: string;
  count?: number;
  kind?: "main" | "sheet";
  style_id?: string;
  model?: string;
};

const FIELDS = [
  "name", "apparent_age", "physical_traits", "clothing", "personality", "expressions", "voice",
  "permanent_visual_traits", "story_role", "visual_prompt_en",
] as const;

/** Extrai o primeiro objeto JSON de uma resposta de LLM (aceita cercas ```json e texto em volta). */
function extractJson(text: string): any {
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

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;

async function styleModifier(admin: any, userId: string, styleId?: string | null): Promise<string> {
  if (!styleId) return "";
  const { data } = await admin.from("visual_styles").select("config, user_id").eq("id", styleId).maybeSingle();
  if (!data || (data.user_id && data.user_id !== userId)) return "";
  const c = data.config ?? {};
  return [c.prompt_modifier, c.lighting && `lighting: ${c.lighting}`, c.photography && `photography: ${c.photography}`]
    .filter(Boolean).join(", ");
}

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);

  // ------------------------------------------------------------------------------------------
  if (body.action === "extract") {
    if (!body.project_id) throw new HttpError(400, "project_id é obrigatório");
    const { data: project } = await admin.from("projects").select("*").eq("id", body.project_id).eq("user_id", user.id).maybeSingle();
    if (!project) throw new HttpError(404, "Projeto não encontrado");
    const idea = (body.idea ?? project.original_idea ?? "").trim();
    if (idea.length < 10) throw new HttpError(400, "Escreva a ideia do projeto (mín. 10 caracteres) antes de gerar personagens");

    const style = await styleModifier(admin, user.id, project.visual_style_id);
    const wanted = body.count ?? project.character_count;

    const system =
      `Você é um roteirista e designer de personagens de cinema. Leia a ideia e identifique TODOS os personagens necessários para contar a história` +
      (wanted ? ` (aproximadamente ${wanted}).` : ".") +
      ` Responda SOMENTE com JSON no formato {"characters":[{` +
      FIELDS.map((f) => `"${f}":"..."`).join(",") + `}]}.` +
      ` Todos os campos em idioma "${project.language}", EXCETO "visual_prompt_en", que deve ser uma descrição visual compacta em INGLÊS` +
      ` (rosto, cabelo, corpo, roupas, cores, acessórios; sem nome próprio, sem ações), fixa e reutilizável em todas as cenas.` +
      ` "voice" descreve timbre/sotaque. Não invente personagens desnecessários.`;
    const user_msg = `Gênero: ${project.genre ?? "não informado"}\nEstilo visual: ${style || "livre"}\nIdeia:\n${idea}`;

    const raw = await runText(admin, user.id, {
      projectId: project.id, purpose: "character_extract",
      messages: [{ role: "system", content: system }, { role: "user", content: user_msg }],
      temperature: 0.7, model: body.model,
    });
    const parsed = extractJson(raw);
    const list: any[] = Array.isArray(parsed?.characters) ? parsed.characters : [];
    const rows = list
      .filter((c) => str(c?.name, 120))
      .slice(0, 12)
      .map((c) => ({
        user_id: user.id, source: "extracted", status: "draft",
        name: str(c.name, 120)!, apparent_age: str(c.apparent_age, 80), physical_traits: str(c.physical_traits),
        clothing: str(c.clothing), personality: str(c.personality), expressions: str(c.expressions), voice: str(c.voice),
        permanent_visual_traits: str(c.permanent_visual_traits), story_role: str(c.story_role), visual_prompt_en: str(c.visual_prompt_en),
      }));
    if (!rows.length) throw new HttpError(502, "A IA não identificou personagens. Detalhe mais a ideia e tente de novo.", "bad_ai_output");

    const { data: created, error } = await admin.from("characters").insert(rows).select("id,name");
    if (error || !created) throw new HttpError(500, "Falha ao salvar os personagens");
    await admin.from("project_characters").insert(created.map((c) => ({ project_id: project.id, character_id: c.id, user_id: user.id })));
    await admin.from("projects").update({
      current_step: "characters",
      status: "in_progress",
      step_status: { ...(project.step_status ?? {}), characters: "pending" },
    }).eq("id", project.id);
    return { created: created.length, characters: created };
  }

  // ------------------------------------------------------------------------------------------
  if (body.action === "refresh_prompt") {
    if (!body.character_id) throw new HttpError(400, "character_id é obrigatório");
    const { data: ch } = await admin.from("characters").select("*").eq("id", body.character_id).eq("user_id", user.id).maybeSingle();
    if (!ch) throw new HttpError(404, "Personagem não encontrado");
    const sheet = [ch.apparent_age, ch.physical_traits, ch.clothing, ch.permanent_visual_traits].filter(Boolean).join(". ");
    if (!sheet) throw new HttpError(400, "Preencha as características físicas e roupas antes");
    const out = await runText(admin, user.id, {
      purpose: "character_prompt",
      messages: [
        { role: "system", content: "Converta a ficha em UMA descrição visual compacta em INGLÊS (rosto, cabelo, corpo, roupas, cores, acessórios), sem nome próprio e sem ações. Responda apenas com o texto." },
        { role: "user", content: sheet },
      ],
      temperature: 0.3, maxTokens: 400,
    });
    const visual = out.trim().slice(0, 1500);
    await admin.from("characters").update({ visual_prompt_en: visual }).eq("id", ch.id);
    return { visual_prompt_en: visual };
  }

  // ------------------------------------------------------------------------------------------
  if (body.action === "generate_image") {
    if (!body.character_id) throw new HttpError(400, "character_id é obrigatório");
    const kind = body.kind === "sheet" ? "sheet" : "main";
    const { data: ch } = await admin.from("characters").select("*").eq("id", body.character_id).eq("user_id", user.id).maybeSingle();
    if (!ch) throw new HttpError(404, "Personagem não encontrado");
    if (!ch.visual_prompt_en) throw new HttpError(400, "Este personagem ainda não tem prompt visual. Use \"Atualizar prompt visual\" ou escreva um.", "no_visual_prompt");

    let styleId = body.style_id ?? null;
    if (!styleId && body.project_id) {
      const { data: p } = await admin.from("projects").select("visual_style_id").eq("id", body.project_id).eq("user_id", user.id).maybeSingle();
      styleId = p?.visual_style_id ?? null;
    }
    const style = await styleModifier(admin, user.id, styleId);

    let prompt: string;
    let refs: string[] = [];
    let ratio: "16:9" | "9:16" | "1:1";
    if (kind === "main") {
      ratio = "9:16";
      prompt = `Full-body character portrait, standing neutral pose, facing camera, plain neutral studio background. ${ch.visual_prompt_en}. ${style}`;
    } else {
      const { data: primary } = await admin.from("character_references").select("storage_path")
        .eq("character_id", ch.id).eq("user_id", user.id).eq("is_primary", true).limit(1).maybeSingle();
      if (!primary) throw new HttpError(409, "Defina uma imagem principal (gerada ou enviada) antes de criar a folha de referência", "no_primary");
      refs = [primary.storage_path];
      ratio = "16:9";
      prompt = `Character reference sheet of the SAME character as in the reference image, on a plain light grey background: front view, side view, back view, a row of facial expressions (neutral, happy, angry, sad, surprised), a few action poses, and costume detail callouts. Keep face, hair, body proportions and outfit colors identical to the reference. ${ch.visual_prompt_en}. ${style}`;
    }

    const job = await enqueueJob(admin, user.id, {
      kind: "image", purpose: kind === "main" ? "character_main" : "character_sheet",
      projectId: body.project_id ?? null, model: body.model, prompt, aspectRatio: ratio, referencePaths: refs,
      target: { type: "character_reference", character_id: ch.id, ref_kind: kind === "main" ? "main" : "sheet", is_primary: kind === "main", name: `${ch.name} — ${kind === "main" ? "principal" : "folha de referência"}` },
    });
    return { job_id: job.id };
  }

  throw new HttpError(400, "Ação desconhecida");
}
