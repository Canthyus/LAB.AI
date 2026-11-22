import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useStyles } from "../hooks/useData";
import { useAuth } from "../hooks/useAuth";
import type { VisualStyle } from "../lib/types";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { errMsg } from "../lib/api";

export const Swatches = ({ palette }: { palette?: string[] }) => (
  <div className="flex h-2 overflow-hidden rounded-full">{(palette ?? []).map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}</div>
);

const blank = { name: "", description: "", lighting: "", photography: "", palette: "", textures: "", environments: "", cinematic_language: "", prompt_modifier: "" };

export default function Styles() {
  const { styles, loading, reload } = useStyles();
  const { user } = useAuth();
  const [sel, setSel] = useState<VisualStyle | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form || !user) return;
    setBusy(true); setErr(null);
    const palette = form.palette.split(/[\s,;]+/).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
    const { error } = await supabase.from("visual_styles").insert({
      user_id: user.id, is_custom: true, name: form.name.trim(), description: form.description.trim() || null,
      slug: `custom-${crypto.randomUUID().slice(0, 8)}`,
      config: { lighting: form.lighting, photography: form.photography, palette, textures: form.textures, environments: form.environments, cinematic_language: form.cinematic_language, prompt_modifier: form.prompt_modifier },
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setForm(null); reload();
  }

  async function remove(s: VisualStyle) {
    if (!confirm(`Excluir o estilo "${s.name}"? Projetos que o usam ficarão sem estilo.`)) return;
    const { error } = await supabase.from("visual_styles").delete().eq("id", s.id);
    if (error) return setErr(errMsg(error));
    setSel(null); reload();
  }

  const f = (k: keyof typeof blank, label: string, ph = "", area = false) => (
    <div><label className="label">{label}</label>
      {area ? <textarea className="input" rows={2} placeholder={ph} value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} />
        : <input className="input" placeholder={ph} value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} />}
    </div>
  );

  return (
    <>
      <PageHeader title="Universos Visuais" subtitle="O estilo escolhido é aplicado a personagens, cenários, storyboard e vídeos do projeto."
        actions={<button className="btn-primary" onClick={() => setForm({ ...blank })}>Criar estilo personalizado</button>} />
      <ErrorBox message={err} />
      {form && (
        <form onSubmit={create} className="card mb-6 grid gap-3 p-5 sm:grid-cols-2">
          {f("name", "Nome")}{f("description", "Descrição")}
          {f("lighting", "Iluminação", "ex.: luz de neon, sombras duras")}{f("photography", "Fotografia", "ex.: lente 35mm, grão de filme")}
          {f("palette", "Paleta (hex separados por vírgula)", "#0d0221, #ff2a6d, #05d9e8")}{f("textures", "Texturas")}
          {f("environments", "Cenários")}{f("cinematic_language", "Linguagem cinematográfica")}
          <div className="sm:col-span-2">{f("prompt_modifier", "Modificador de prompt (inglês — é anexado a todo prompt de imagem/vídeo)", "ex.: noir film still, high contrast black and white", true)}</div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !form.name.trim() || !form.prompt_modifier.trim()}>{busy && <Spinner />}Salvar estilo</button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}
      {loading ? <Spinner /> : !styles.length ? <Empty title="Nenhum estilo encontrado" hint="Aplique as migrações do banco (0004_seed_models_styles.sql) para carregar a biblioteca." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {styles.map((s) => (
            <button key={s.id} onClick={() => setSel(sel?.id === s.id ? null : s)} className={`card space-y-2 p-4 text-left transition hover:border-violet-500/60 ${sel?.id === s.id ? "border-violet-500" : ""}`}>
              <Swatches palette={s.config.palette} />
              <div className="flex items-center justify-between"><span className="font-medium text-white">{s.name}</span>{s.is_custom && <span className="text-[11px] text-violet-300">personalizado</span>}</div>
              <p className="text-xs text-zinc-400">{s.description}</p>
              {sel?.id === s.id && (
                <dl className="space-y-1 border-t border-ink-600 pt-2 text-xs text-zinc-400">
                  {([["Iluminação", s.config.lighting], ["Fotografia", s.config.photography], ["Texturas", s.config.textures], ["Cenários", s.config.environments], ["Linguagem", s.config.cinematic_language]] as const).map(([k, v]) => v && <div key={k}><dt className="inline text-zinc-300">{k}: </dt><dd className="inline">{v}</dd></div>)}
                  {s.is_custom && <span role="button" className="mt-2 inline-block text-red-400 hover:underline" onClick={(e) => { e.stopPropagation(); remove(s); }}>Excluir estilo</span>}
                </dl>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
