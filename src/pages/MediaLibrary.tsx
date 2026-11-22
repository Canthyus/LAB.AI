import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "../lib/supabase";
import { signedUrl, uploadImage } from "../lib/storage";
import { errMsg } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { MediaItem } from "../lib/types";
import { Empty, ErrorBox, PageHeader, Spinner, Thumb } from "../components/ui";

const KINDS: [string, string][] = [["", "Tudo"], ["character", "Personagens"], ["image", "Imagens"], ["reference", "Referências"], ["storyboard", "Storyboards"], ["video", "Vídeos"], ["audio", "Áudios"], ["subtitle", "Legendas"]];

export default function MediaLibrary() {
  const { user } = useAuth();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    let query = supabase.from("media_library").select("*").order("created_at", { ascending: false }).limit(200);
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) setErr(errMsg(error)); else setItems((data ?? []) as MediaItem[]);
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f || !user) return;
    setBusy(true); setErr(null);
    try {
      const { path } = await uploadImage(user.id, "library", f);
      const { error } = await supabase.from("media_library").insert({ kind: "reference", name: f.name, source: "upload", storage_path: path, mime_type: f.type, size_bytes: f.size });
      if (error) throw error;
      await load();
    } catch (x) { setErr(errMsg(x)); }
    setBusy(false);
  }

  async function open(m: MediaItem) { const u = await signedUrl(m.storage_path); if (u) window.open(u, "_blank", "noopener"); }

  async function remove(m: MediaItem) {
    if (!confirm(`Excluir "${m.name}"? Isto apaga o arquivo.`)) return;
    await supabase.from("media_library").delete().eq("id", m.id);
    await supabase.storage.from("media").remove([m.storage_path]);
    load();
  }

  const shown = (items ?? []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Biblioteca de Mídia" subtitle="Tudo o que foi gerado ou enviado, em um só lugar."
        actions={<><button className="btn-primary" disabled={busy} onClick={() => file.current?.click()}>{busy && <Spinner />}Enviar imagem</button><input ref={file} type="file" accept="image/*" className="hidden" onChange={upload} /></>} />
      <ErrorBox message={err} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {KINDS.map(([k, l]) => <button key={k} className={kind === k ? "btn-primary" : "btn-ghost"} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {!items ? <Spinner /> : !shown.length ? <Empty title="Nada por aqui ainda" hint="Imagens geradas e arquivos enviados aparecem automaticamente." /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {shown.map((m) => (
            <div key={m.id} className="card overflow-hidden">
              {m.kind === "video" || m.kind === "audio" ? <div className="flex aspect-video items-center justify-center bg-ink-700 text-xs text-zinc-400">{m.kind}</div> : <Thumb path={m.storage_path} className="aspect-square w-full" />}
              <div className="space-y-1 p-2.5">
                <div className="truncate text-sm text-zinc-200" title={m.name}>{m.name}</div>
                <div className="text-[11px] text-zinc-500">{m.kind} · {m.source === "upload" ? "enviado" : "gerado"}</div>
                <div className="flex gap-3 text-xs"><button className="text-violet-300 hover:underline" onClick={() => open(m)}>Abrir</button><button className="text-red-400 hover:underline" onClick={() => remove(m)}>Excluir</button></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
