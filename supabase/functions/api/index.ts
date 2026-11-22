// Ponto único das Edge Functions do Lab.AI. Rota = último trecho da URL (/functions/v1/api/<rota>).
import { handle, HttpError } from "./_shared/http.ts";
import agnesSettings from "./handlers/agnes-settings.ts";
import agnesJobs from "./handlers/agnes-jobs.ts";
import charactersAi from "./handlers/characters-ai.ts";
import storyAi from "./handlers/story-ai.ts";
import videoAi from "./handlers/video-ai.ts";
import stylesAi from "./handlers/styles-ai.ts";

const routes: Record<string, (req: Request) => Promise<unknown>> = {
  "agnes-settings": agnesSettings,
  "agnes-jobs": agnesJobs,
  "characters-ai": charactersAi,
  "story-ai": storyAi,
  "video-ai": videoAi,
  "styles-ai": stylesAi,
};

Deno.serve(handle(async (req) => {
  const name = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const route = routes[name];
  if (!route) throw new HttpError(404, "Rota desconhecida");
  return await route(req);
}));
