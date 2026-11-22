// Montagem final com FFmpeg (WebAssembly) no navegador. Os arquivos originais nunca são alterados:
// os cortes/transições são aplicados só nos arquivos temporários da renderização.
export interface ExportClip { url: string; inPoint: number; outPoint: number; fade: boolean }
export interface ExportAudio { url: string; start: number; volume: number }
export interface ExportInput { clips: ExportClip[]; audio: ExportAudio[]; srt?: string; width: number; height: number; fps: number }

const CORE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

export async function exportFilm(input: ExportInput, onStatus: (s?: string, pct?: number) => void): Promise<Blob> {
  if (!input.clips.length) throw new Error("A timeline está vazia");
  onStatus("Carregando o FFmpeg (≈30 MB, só na primeira vez)…");
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ff = new FFmpeg();
  let step = 0;
  const steps = input.clips.length + 2;
  ff.on("progress", ({ progress }) => onStatus(undefined, Math.round(((step + Math.min(1, Math.max(0, progress))) / steps) * 100)));
  await ff.load({
    coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
  });

  const W = input.width - (input.width % 2), H = input.height - (input.height % 2);
  const list: string[] = [];
  let total = 0;
  for (let i = 0; i < input.clips.length; i++) {
    const c = input.clips[i];
    const dur = Math.max(0.2, c.outPoint - c.inPoint);
    onStatus(`Processando clipe ${i + 1} de ${input.clips.length}…`);
    await ff.writeFile(`src${i}.mp4`, await fetchFile(c.url));
    const vf = [`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`, `fps=${input.fps}`, "setsar=1"];
    if (c.fade && dur > 1.2) vf.push("fade=t=in:st=0:d=0.5", `fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`);
    const code = await ff.exec(["-ss", String(c.inPoint), "-t", dur.toFixed(2), "-i", `src${i}.mp4`, "-vf", vf.join(","), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", `clip${i}.mp4`]);
    if (code !== 0) throw new Error(`Falha ao processar o clipe ${i + 1}`);
    await ff.deleteFile(`src${i}.mp4`);
    list.push(`file 'clip${i}.mp4'`);
    total += dur; step++;
  }

  onStatus("Juntando os clipes…");
  await ff.writeFile("list.txt", list.join("\n"));
  if ((await ff.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "video.mp4"])) !== 0) throw new Error("Falha ao juntar os clipes");
  step++;

  let out = "video.mp4";
  if (input.audio.length || input.srt) {
    onStatus("Mixando áudio e legendas…");
    const args = ["-i", "video.mp4"];
    for (let i = 0; i < input.audio.length; i++) { await ff.writeFile(`aud${i}`, await fetchFile(input.audio[i].url)); args.push("-i", `aud${i}`); }
    if (input.srt) { await ff.writeFile("subs.srt", input.srt); args.push("-i", "subs.srt"); }
    const maps: string[] = ["-map", "0:v"];
    if (input.audio.length) {
      const parts = input.audio.map((a, i) => `[${i + 1}:a]adelay=${Math.round(a.start * 1000)}|${Math.round(a.start * 1000)},volume=${a.volume.toFixed(2)}[a${i}]`);
      const mix = `${input.audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${input.audio.length}:duration=longest:dropout_transition=0[aout]`;
      args.push("-filter_complex", [...parts, mix].join(";"));
      maps.push("-map", "[aout]", "-c:a", "aac");
    }
    if (input.srt) { const idx = 1 + input.audio.length; maps.push("-map", `${idx}:s`, "-c:s", "mov_text"); }
    args.push(...maps, "-c:v", "copy", "-t", total.toFixed(2), "final.mp4");
    if ((await ff.exec(args)) !== 0) throw new Error("Falha ao mixar áudio/legendas");
    out = "final.mp4";
  }
  onStatus("Finalizando…", 100);
  const data = await ff.readFile(out);
  ff.terminate();
  return new Blob([data as BlobPart], { type: "video/mp4" });
}

export function buildSrt(items: { start: number; end: number; text: string }[]): string {
  const t = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, l = 2) => String(n).padStart(l, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return items.filter((i) => i.text.trim()).map((i, n) => `${n + 1}\n${t(i.start)} --> ${t(i.end)}\n${i.text.trim()}\n`).join("\n");
}
