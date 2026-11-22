import { HttpError } from "./http.ts";

// AES-256-GCM. A chave mestra vem de CREDENTIALS_ENCRYPTION_KEY (32 bytes em base64, opcional);
// sem ela, é derivada do segredo de serviço da própria função. O user_id entra como dado autenticado (AAD),
// então um ciphertext copiado para outra conta não decifra.

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function masterKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("CREDENTIALS_ENCRYPTION_KEY");
  if (raw) {
    const bytes = fromB64(raw.trim());
    if (bytes.length !== 32) {
      throw new HttpError(500, "CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em base64", "bad_secret");
    }
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  // Sem o segredo dedicado, deriva a chave do segredo de serviço que o Supabase já injeta na função.
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new HttpError(500, "Sem segredo para cifrar credenciais", "missing_secret");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`pavo-ai:credentials:v1:${base}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(userId) },
    await masterKey(),
    enc.encode(plain),
  );
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string, userId: string): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv), additionalData: enc.encode(userId) },
      await masterKey(),
      fromB64(ciphertext),
    );
    return dec.decode(pt);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "Não foi possível decifrar a API Key salva. Salve-a novamente.", "decrypt_failed");
  }
}
