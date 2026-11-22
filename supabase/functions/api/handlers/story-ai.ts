// Roteiro, storyboard, planos e imagens de cena — tudo via Agnes (texto + imagem), no servidor.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { enqueueJob, runText } from "../_shared/agnes/engine.ts";
import { castSummary, charactersVisual, extractJson, idsByNames, loadContext, n, s } from "../_shared/context.ts";

type Body = {
  action: "generate_script" | "edit_script" | "generate_storyboard" | "generate_shots" | "scene_image";
  project_id?: string;
  script_id?: string;
  scene_id?: string;
  scene_ids?: string[];
  op?: string;
  instruction?: string;
  replace?: boolean;
  model?: string;
};

const OPS: Record<string, string> = {
  expand: "Expanda a história: mais detalhes, cenas e profundidade, mantendo personagens e tom.",
  summarize: "Resuma o roteiro mantendo os acontecimentos essenciais e o final.",
  rewrite: "Reescreva o roteiro com melhor ritmo e linguagem, mantendo a trama.",
  dialogue: "Altere os diálogos conforme o pedido, sem mudar os acontecimentos.",
  add_character: "Adicione o personagem pedido à história de forma coerente, com falas e papel.",
  remove_character: "Remova o personagem pedido e reescreva as cenas afetadas para a história continuar coerente.",
  events: "Altere os acontecimentos conforme o pedido, mantendo continuidade narrativa.",
  ending: "Modifique o final conforme o pedido, preservando a coerência com o início e o meio.",
};

const SEQ_FORMAT = `"sequences":[{"title":"...","summary":"...","estimated_duration_seconds":number}]`;

async function replaceSequences(admin: any, userId: string, projectId: string, scriptId: string, seqs: any[]) {
  await admin.from("sequences").delete().eq("project_id", projectId).eq("user_id", userId); // cascata: cenas, planos, storyboards
  const rows = seqs.filter((q) => s(q?.title, 200)).slice(0, 30).map((q, i) => ({
    user_id: userId, project_id: projectId, script_id: scriptId, position: i + 1,
    title: s(q.title, 200)!, summary: s(q.summary), estimated_duration_seconds: Math.round(n(q.estimated_duration_seconds, 1, 3600, 10)),
  }));
  if (rows.length) await admin.from("sequences").insert(rows);
  return rows.length;
}

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);
  if (!body.project_id) throw new HttpError(400, "project_id é obrigatório");
  const ctx = await loadContext(admin, user.id, body.project_id);
  const { project, characters } = ctx;
  const projectId = project.id as string;

  // ---------------------------------------------------------------------------------------- roteiro
  if (body.action === "generate_script") {
    const { count } = await admin.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if ((count ?? 0) > 0 && !body.replace) {
      throw new HttpError(409, "Este projeto já tem cenas. Gerar um novo roteiro apaga cenas, planos e storyboard atuais.", "needs_replace");
    }
    if ((project.original_idea ?? "").trim().length < 10) throw new HttpError(400, "Escreva a ideia do projeto antes de gerar o roteiro");

    const system =
      `Você é um roteirista de cinema. Escreva o roteiro completo em "${project.language}" a partir da ideia, com começo, desenvolvimento e conclusão, ` +
      `diálogos entre os personagens, acontecimentos claros e continuidade narrativa. Duração alvo do filme: ${project.target_duration_seconds}s. ` +
      `Use SOMENTE os personagens listados (você pode citar figurantes sem nome). Formato do texto: cabeçalhos de sequência em MAIÚSCULAS, ação em prosa, falas como "NOME: fala". ` +
      `Divida em sequências e estime a duração de cada uma (a soma deve ficar próxima da duração alvo). ` +
      `Responda SOMENTE com JSON: {"title":"...","logline":"...","content":"<roteiro completo>",${SEQ_FORMAT}}.`;
    const out = await runText(admin, user.id, {
      projectId, purpose: "script_generate", model: body.model, temperature: 0.8, maxTokens: 8000,
      messages: [{ role: "system", content: system }, {
        role: "user",
        content: `Gênero: ${project.genre ?? "livre"}\nEstilo visual: ${ctx.style || "livre"}\nPersonagens:\n${castSummary(characters)}\n\nIdeia:\n${project.original_idea}${body.instruction ? `\n\nInstruções extras: ${body.instruction}` : ""}`,
      }],
    });
    const j = extractJson(out);
    const content = s(j.content, 60000);
    if (!content) throw new HttpError(502, "A IA não devolveu o texto do roteiro. Tente novamente.", "bad_ai_output");

    const { data: last } = await admin.from("scripts").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1);
    const { data: script, error } = await admin.from("scripts").insert({
      user_id: user.id, project_id: projectId, version: (last?.[0]?.version ?? 0) + 1,
      title: s(j.title, 200), logline: s(j.logline, 500), content, status: "draft",
    }).select("id").single();
    if (error || !script) throw new HttpError(500, "Falha ao salvar o roteiro");
    const seqs = await replaceSequences(admin, user.id, projectId, script.id, Array.isArray(j.sequences) ? j.sequences : []);
    await admin.from("projects").update({ current_step: "script", status: "in_progress", step_status: { ...(project.step_status ?? {}), script: "pending" } }).eq("id", projectId);
    return { script_id: script.id, sequences: seqs };
  }

  if (body.action === "edit_script") {
    if (!body.script_id) throw new HttpError(400, "script_id é obrigatório");
    const op = body.op && OPS[body.op];
    if (!op) throw new HttpError(400, "Operação desconhecida");
    const { data: script } = await admin.from("scripts").select("*").eq("id", body.script_id).eq("user_id", user.id).maybeSingle();
    if (!script) throw new HttpError(404, "Roteiro não encontrado");
    const { count } = await admin.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    const canResplit = (count ?? 0) === 0;

    const system = `Você edita roteiros de cinema em "${project.language}". Tarefa: ${op} Mantenha o formato do texto. ` +
      `Responda SOMENTE com JSON: {"content":"<roteiro completo editado>"${canResplit ? `,${SEQ_FORMAT}` : ""}}.`;
    const out = await runText(admin, user.id, {
      projectId, purpose: "script_edit", model: body.model, temperature: 0.7, maxTokens: 8000,
      messages: [{ role: "system", content: system }, {
        role: "user",
        content: `Personagens atuais:\n${castSummary(characters)}\n\nPedido do usuário: ${body.instruction ?? "(nenhum detalhe extra)"}\n\nRoteiro atual:\n${script.content}`,
      }],
    });
    const j = extractJson(out);
    const content = s(j.content, 60000);
    if (!content) throw new HttpError(502, "A IA não devolveu o roteiro editado. Tente novamente.", "bad_ai_output");
    await admin.from("scripts").update({ content, status: "draft" }).eq("id", script.id);
    let seqs: number | null = null;
    if (canResplit && Array.isArray(j.sequences) && j.sequences.length) seqs = await replaceSequences(admin, user.id, projectId, script.id, j.sequences);
    return { ok: true, content, sequences: seqs, note: canResplit ? null : "As sequências e cenas existentes foram mantidas; ajuste-as manualmente se necessário." };
  }

  // ------------------------------------------------------------------------------------- storyboard
  if (body.action === "generate_storyboard") {
    const { data: script } = await admin.from("scripts").select("*").eq("project_id", projectId).eq("user_id", user.id).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!script) throw new HttpError(409, "Gere o roteiro primeiro", "no_script");
    if (script.status !== "approved" && project.production_mode !== "automatic") throw new HttpError(409, "Aprove o roteiro antes de gerar o storyboard", "script_not_approved");
    const { data: seqs } = await admin.from("sequences").select("*").eq("project_id", projectId).eq("user_id", user.id).order("position");
    if (!seqs?.length) throw new HttpError(409, "O roteiro não tem sequências", "no_sequences");
    const { count } = await admin.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if ((count ?? 0) > 0 && !body.replace) throw new HttpError(409, "Já existem cenas. Regerar apaga as cenas atuais.", "needs_replace");

    const system =
      `Você é um diretor/storyboarder. Transforme o roteiro em cenas cinematográficas para cada sequência (2 a 5 cenas por sequência, conforme a duração). ` +
      `Textos em "${project.language}". "character_names" deve usar exatamente os nomes dos personagens listados. "dialogue" = falas da cena (ou vazio). ` +
      `Responda SOMENTE com JSON: {"sequences":[{"index":<número da sequência começando em 1>,"scenes":[{"title":"","description":"","location":"","character_names":[],"action":"","emotion":"","lighting":"","environment":"","estimated_duration_seconds":5,"dialogue":""}]}]}.`;
    const out = await runText(admin, user.id, {
      projectId, purpose: "storyboard_scenes", model: body.model, temperature: 0.6, maxTokens: 12000,
      messages: [{ role: "system", content: system }, {
        role: "user",
        content: `Personagens:\n${castSummary(characters)}\n\nSequências:\n${seqs.map((q: any, i: number) => `${i + 1}. ${q.title} (${q.estimated_duration_seconds ?? "?"}s): ${q.summary ?? ""}`).join("\n")}\n\nRoteiro:\n${script.content}`,
      }],
    });
    const j = extractJson(out);
    const rows: any[] = [];
    let pos = 1;
    for (const grp of Array.isArray(j.sequences) ? j.sequences : []) {
      const seq = seqs[Number(grp?.index) - 1];
      if (!seq) continue;
      for (const sc of Array.isArray(grp.scenes) ? grp.scenes : []) {
        if (!s(sc?.title, 200)) continue;
        rows.push({
          user_id: user.id, project_id: projectId, sequence_id: seq.id, position: pos++, title: s(sc.title, 200)!,
          description: s(sc.description), location: s(sc.location, 300), character_ids: idsByNames(characters, sc.character_names),
          action: s(sc.action), emotion: s(sc.emotion, 200), lighting: s(sc.lighting, 300), environment: s(sc.environment, 300),
          estimated_duration_seconds: Math.round(n(sc.estimated_duration_seconds, 1, 120, 5)), dialogue: s(sc.dialogue, 3000), approval_status: "pending",
        });
      }
    }
    if (!rows.length) throw new HttpError(502, "A IA não devolveu cenas. Tente novamente.", "bad_ai_output");
    // só apaga as cenas antigas depois de ter as novas em mãos
    if ((count ?? 0) > 0) await admin.from("scenes").delete().eq("project_id", projectId).eq("user_id", user.id);
    const { error } = await admin.from("scenes").insert(rows);
    if (error) throw new HttpError(500, "Falha ao salvar as cenas");
    await admin.from("projects").update({ current_step: "storyboard", step_status: { ...(project.step_status ?? {}), storyboard: "pending" } }).eq("id", projectId);
    return { scenes: rows.length };
  }

  // --------------------------------------------------------------------------------------- planos
  if (body.action === "generate_shots") {
    let q = admin.from("scenes").select("*").eq("project_id", projectId).eq("user_id", user.id).order("position");
    if (body.scene_ids?.length) q = q.in("id", body.scene_ids);
    const { data: scenes } = await q;
    if (!scenes?.length) throw new HttpError(409, "Não há cenas para dividir em planos", "no_scenes");
    const { data: existing } = await admin.from("shots").select("scene_id").eq("project_id", projectId).in("scene_id", scenes.map((x: any) => x.id));
    const have = new Set((existing ?? []).map((x: any) => x.scene_id));
    const missing = scenes.filter((x: any) => !have.has(x.id));
    const todo = missing.slice(0, 8); // lote por chamada para respeitar tempo e limites
    if (!todo.length) return { shots: 0, remaining: 0 };

    const system =
      `Você é um diretor de fotografia. Divida cada cena em 1 a 4 planos individuais, escolhendo a melhor composição. ` +
      `"shot_type" ∈ [Extreme Wide Shot, Wide Shot, Medium Shot, Medium Close-up, Close-up, Extreme Close-up, Over the Shoulder, POV, Low Angle, High Angle, Tracking Shot, Dolly Shot, Crane Shot]. ` +
      `"visual_prompt" em INGLÊS (o que aparece no quadro, sem repetir a aparência dos personagens). Demais campos em "${project.language}". ` +
      `"duration_seconds" entre 3 e 8. "character_names" = quem aparece no plano. "dialogue" = fala dita neste plano (ou vazio). ` +
      `Responda SOMENTE com JSON: {"scenes":[{"index":<número da cena na lista>,"shots":[{"shot_type":"","visual_prompt":"","character_motion":"","camera_movement":"","framing":"","lighting":"","environment":"","duration_seconds":5,"character_names":[],"dialogue":""}]}]}.`;
    const out = await runText(admin, user.id, {
      projectId, purpose: "shots_generate", model: body.model, temperature: 0.6, maxTokens: 10000,
      messages: [{ role: "system", content: system }, {
        role: "user",
        content: `Estilo: ${ctx.style || "livre"}\nPersonagens:\n${castSummary(characters)}\n\nCenas:\n${todo.map((x: any, i: number) => {
          const names = characters.filter((c: any) => (x.character_ids ?? []).includes(c.id)).map((c: any) => c.name).join(", ");
          return `${i + 1}. ${x.title} | local: ${x.location ?? "-"} | personagens: ${names || "-"} | ação: ${x.action ?? "-"} | emoção: ${x.emotion ?? "-"} | luz: ${x.lighting ?? "-"} | ambiente: ${x.environment ?? "-"} | ~${x.estimated_duration_seconds ?? 5}s\n   ${x.description ?? ""}\n   Diálogo: ${x.dialogue ?? ""}`;
        }).join("\n")}`,
      }],
    });
    const j = extractJson(out);
    const rows: any[] = [];
    for (const grp of Array.isArray(j.scenes) ? j.scenes : []) {
      const sc = todo[Number(grp?.index) - 1];
      if (!sc) continue;
      (Array.isArray(grp.shots) ? grp.shots : []).slice(0, 6).forEach((sh: any, i: number) => {
        if (!s(sh?.visual_prompt)) return;
        const ids = idsByNames(characters, sh.character_names);
        rows.push({
          user_id: user.id, project_id: projectId, scene_id: sc.id, position: i + 1, shot_type: s(sh.shot_type, 60), visual_prompt: s(sh.visual_prompt),
          character_motion: s(sh.character_motion), camera_movement: s(sh.camera_movement, 300), framing: s(sh.framing, 300),
          lighting: s(sh.lighting, 300) ?? sc.lighting, environment: s(sh.environment, 300) ?? sc.environment,
          duration_seconds: n(sh.duration_seconds, 1, 10, 5), character_ids: ids.length ? ids : (sc.character_ids ?? []), dialogue: s(sh.dialogue, 2000),
        });
      });
    }
    if (!rows.length) throw new HttpError(502, "A IA não devolveu planos. Tente novamente.", "bad_ai_output");
    const { error } = await admin.from("shots").insert(rows);
    if (error) throw new HttpError(500, "Falha ao salvar os planos");
    return { shots: rows.length, remaining: missing.length - todo.length };
  }

  // ------------------------------------------------------------------------------ imagem de storyboard
  if (body.action === "scene_image") {
    if (!body.scene_id) throw new HttpError(400, "scene_id é obrigatório");
    const { data: sc } = await admin.from("scenes").select("*").eq("id", body.scene_id).eq("user_id", user.id).maybeSingle();
    if (!sc) throw new HttpError(404, "Cena não encontrada");
    const ids: string[] = sc.character_ids ?? [];
    const refs = ids.map((id) => ctx.refPathByCharacter.get(id)).filter(Boolean) as string[];
    const vis = charactersVisual(characters, ids);
    const prompt = [
      `Storyboard frame, cinematic composition. ${sc.description ?? sc.title}.`,
      sc.location && `Location: ${sc.location}.`, sc.action && `Action: ${sc.action}.`, sc.emotion && `Mood: ${sc.emotion}.`,
      sc.lighting && `Lighting: ${sc.lighting}.`, sc.environment && `Environment: ${sc.environment}.`,
      vis && `Characters (keep identical to the reference images): ${vis}.`, ctx.style,
    ].filter(Boolean).join(" ");
    const job = await enqueueJob(admin, user.id, {
      kind: "image", purpose: "storyboard", projectId, model: body.model, prompt, aspectRatio: project.aspect_ratio,
      referencePaths: refs.slice(0, 3), target: { type: "storyboard", scene_id: sc.id, name: `Storyboard — ${sc.title}` },
    });
    return { job_id: job.id, used_references: refs.length };
  }

  throw new HttpError(400, "Ação desconhecida");
}
