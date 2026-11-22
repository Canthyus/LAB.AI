import type { VisualStyle } from "../lib/types";
import { Thumb, Spinner } from "./ui";

/** Capa do universo visual: imagem real quando existe; senão, um placeholder neutro com a paleta. */
export default function StyleCover({ style, path, pending, className = "aspect-video" }: { style: VisualStyle; path?: string; pending?: boolean; className?: string }) {
  const pal = style.config.palette ?? [];
  return (
    <div className={`relative w-full overflow-hidden bg-ink-900 ${className}`}>
      {path ? <Thumb path={path} alt={style.name} className="h-full w-full" /> : (
        <div className="flex h-full w-full flex-col justify-end" style={{ background: pal.length ? `linear-gradient(135deg, ${pal.slice(0, 3).map((c) => c + "55").join(", ")})` : undefined }}>
          <div className="flex h-1 w-full">{pal.map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}</div>
        </div>
      )}
      {pending && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-xs text-zinc-200"><Spinner />Gerando prévia…</div>}
      {!path && !pending && <div className="absolute inset-x-0 top-2 text-center text-[10px] uppercase tracking-widest text-zinc-500">sem prévia</div>}
    </div>
  );
}
