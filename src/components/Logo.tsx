import { FlaskConical } from "lucide-react";

/** Marca Lab.AI: frasco de laboratório + wordmark monoespaçado. */
export default function Logo({ size = "md", tagline = true }: { size?: "md" | "lg"; tagline?: boolean }) {
  const lg = size === "lg";
  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex shrink-0 items-center justify-center rounded-lg border border-lab/30 bg-gradient-to-br from-violet-600/30 to-cyan-500/20 ${lg ? "h-12 w-12" : "h-9 w-9"}`}>
        <FlaskConical className={`${lg ? "h-6 w-6" : "h-5 w-5"} text-cyan-300`} strokeWidth={1.75} />
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
      </div>
      <div className="leading-tight">
        <div className={`font-mono font-semibold tracking-tight text-white ${lg ? "text-2xl" : "text-lg"}`}>LAB<span className="text-lab">.</span><span className="bg-gradient-to-r from-violet-400 to-cyan-300 bg-clip-text text-transparent">AI</span></div>
        {tagline && <div className="eyebrow !text-[9px] !text-zinc-500">Laboratório de cinema com IA</div>}
      </div>
    </div>
  );
}
