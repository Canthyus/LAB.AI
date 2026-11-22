import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useStyles } from "../hooks/useData";
import { errMsg } from "../lib/api";
import { ErrorBox, PageHeader, Spinner } from "../components/ui";
import { Swatches } from "./Styles";
import type { Aspect, ProductionMode } from "../lib/types";

export const FORMATS = [["short_film", "Curta-metragem"], ["trailer", "Trailer"], ["clip", "Clipe"], ["episode", "Episódio"]] as const;
export const MODES: [ProductionMode, string, string][] = [
  ["manual", "Manual", "Você aprova cada etapa antes de avançar."],
  ["assisted", "Assistido", "A IA desenvolve as etapas; você revisa e altera."],
  ["automatic", "Automático", "Encadeia todas as etapas sozinho, respeitando os limites da API."],
];

export default function NewProject() {
  const nav = useNavigate();
  const { styles } = useStyles();
  const [f, setF] = useState({
    name: "", idea: "", genre: "", style: "", format: "short_film", aspect: "16:9" as Aspect, duration: 60,
    language: "pt-BR", chars: "", mode: "assisted" as ProductionMode,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from("projects").insert({
      name: f.name.trim(), original_idea: f.idea.trim(), genre: f.genre.trim() || null, visual_style_id: f.style || null,
      format: f.format, aspect_ratio: f.aspect, target_duration_seconds: f.duration, language: f.language,
      character_count: f.chars ? Number(f.chars) : null, production_mode: f.mode, status: "in_progress",
      current_step: "characters", step_status: { idea: "approved", ...(f.style ? { style: "approved" } : {}) },
    }).select("id").single();
    setBusy(false);
    if (error || !data) return setErr(errMsg(error));
    nav(`/projects/${data.id}`);
  }

  return (
    <>
      <PageHeader title="Novo Projeto" subtitle="Ideia, estilo visual, formato e duração. O resto do fluxo fica nas abas do projeto." />
      <ErrorBox message={err} />
      <form onSubmit={submit} className="space-y-6">
        <section className="card space-y-4 p-5">
          <div><label className="label">Nome do projeto</label><input className="input" required value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label className="label">Ideia (curta ou história completa)</label>
            <textarea className="input" rows={6} required minLength={10} value={f.idea} onChange={(e) => set("idea", e.target.value)} placeholder="Descreva a história que você quer contar…" /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label">Gênero</label><input className="input" value={f.genre} onChange={(e) => set("genre", e.target.value)} placeholder="Aventura, drama…" /></div>
            <div><label className="label">Idioma</label>
              <select className="input" value={f.language} onChange={(e) => set("language", e.target.value)}>
                <option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option>
              </select></div>
            <div><label className="label">Nº de personagens (opcional)</label><input className="input" type="number" min={1} max={12} value={f.chars} onChange={(e) => set("chars", e.target.value)} placeholder="a IA decide" /></div>
          </div>
        </section>

        <section className="card p-5">
          <label className="label">Universo visual</label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {styles.map((s) => (
              <button type="button" key={s.id} onClick={() => set("style", f.style === s.id ? "" : s.id)}
                className={`space-y-2 rounded-lg border p-3 text-left text-sm transition ${f.style === s.id ? "border-violet-500 bg-violet-600/10" : "border-ink-600 hover:border-ink-500"}`}>
                <Swatches palette={s.config.palette} /><div className="text-zinc-100">{s.name}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="card grid gap-4 p-5 sm:grid-cols-3">
          <div><label className="label">Formato</label><select className="input" value={f.format} onChange={(e) => set("format", e.target.value)}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Proporção</label><select className="input" value={f.aspect} onChange={(e) => set("aspect", e.target.value as Aspect)}><option value="16:9">16:9 (horizontal)</option><option value="9:16">9:16 (vertical)</option><option value="1:1">1:1 (quadrado)</option></select></div>
          <div><label className="label">Duração desejada (s)</label><input className="input" type="number" min={5} max={3600} value={f.duration} onChange={(e) => set("duration", Number(e.target.value))} /></div>
          <div className="sm:col-span-3"><label className="label">Modo de produção</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {MODES.map(([v, l, d]) => (
                <button type="button" key={v} onClick={() => set("mode", v)} className={`rounded-lg border p-3 text-left transition ${f.mode === v ? "border-violet-500 bg-violet-600/10" : "border-ink-600"}`}>
                  <div className="text-sm font-medium text-white">{l}</div><div className="text-xs text-zinc-400">{d}</div>
                </button>
              ))}
            </div>
            {f.mode === "automatic" && <p className="mt-2 text-xs text-amber-300">No automático, o sistema aprova as etapas por você e envia os vídeos para a fila; os vídeos consomem a cota da sua API.</p>}
          </div>
        </section>
        <button className="btn-primary" disabled={busy || !f.name.trim() || f.idea.trim().length < 10}>{busy && <Spinner />}Criar projeto</button>
      </form>
    </>
  );
}
