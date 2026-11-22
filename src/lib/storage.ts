import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const cache = new Map<string, { url: string; exp: number }>();
const TTL = 50 * 60_000;

export async function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from("media").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, exp: Date.now() + TTL });
  return data.signedUrl;
}

export function useSignedUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) signedUrl(path).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [path]);
  return url;
}

export async function uploadImage(userId: string, folder: string, file: File): Promise<{ path: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Envie um arquivo de imagem (PNG, JPG ou WebP)");
  if (file.size > 20 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 20 MB)");
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error("Falha no upload: " + error.message);
  return { path };
}
