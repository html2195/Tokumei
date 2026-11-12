import { argon2id } from "npm:@noble/hashes@2.0.1/argon2.js";
import { timingSafeEqual } from "node:crypto";

const origins = new Set([
  "https://html2195.github.io",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);
const projectUrl = Deno.env.get("SUPABASE_URL");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const encoder = new TextEncoder();
const loginPattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const maxBodyBytes = 4096;
const passwordOptions = { m: 19456, t: 2, p: 1, dkLen: 32 };
const dummySalt = crypto.getRandomValues(new Uint8Array(16));

type Account = { id: string; login: string };
type Credentials = Account & { salt: string; password_hash: string };

class AuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  return Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}

async function tokenHash(token: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

async function rpc<T>(name: string, payload: Record<string, string | number>): Promise<T> {
  if (!projectUrl || !serviceKey) throw new Error("Database configuration is missing");
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${serviceKey}`;
  const response = await fetch(`${projectUrl}/rest/v1/rpc/tokumei_auth_${name}`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Account storage error ${name} ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function rateLimit(key: string, max: number, seconds: number) {
  const allowed = await rpc<boolean>("limit", { p_key: key, p_max: max, p_seconds: seconds });
  if (!allowed) throw new AuthError(429, "Слишком много попыток. Попробуйте чуть позже.");
}

async function credentialsFrom(request: Request, register: boolean) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AuthError(415, "Нужен запрос в формате JSON.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, "Введите логин и пароль.");
  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new AuthError(413, "Запрос слишком большой.");
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  let data;
  try {
    data = JSON.parse(raw + decoder.decode());
  } catch {
    throw new AuthError(400, "Введите логин и пароль.");
  }
  const login = typeof data?.login === "string" ? data.login.trim().toLowerCase() : "";
  const password = typeof data?.password === "string" ? data.password : "";
  const length = Array.from(password).length;
  if (!loginPattern.test(login) || !length || length > 128) {
    throw new AuthError(400, "Проверьте логин и пароль.");
  }
  if (register && length < 15) throw new AuthError(400, "Пароль должен содержать от 15 символов.");
  return { login, password };
}

async function signInOrRegister(request: Request, register: boolean) {
  const { login, password } = await credentialsFrom(request, register);
  const operation = register ? "signup" : "signin";
  await rateLimit(`${operation}:global`, register ? 30 : 180, 60);

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await tokenHash(token);
  const passwordBytes = encoder.encode(password);
  if (register) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = argon2id(passwordBytes, salt, passwordOptions);
    const account = await rpc<Account | null>("register", {
      p_login: login, p_salt: toHex(salt), p_hash: toHex(hash), p_token_hash: digest,
    });
    if (!account) throw new AuthError(409, "Логин уже занят. Выберите другой или сгенерируйте новый.");
    return { account, token };
  }

  const stored = await rpc<Credentials | null>("credentials", { p_login: login });
  if (stored) await rateLimit(`signin:${stored.id}`, 8, 60);
  const actual = argon2id(passwordBytes, stored ? fromHex(stored.salt) : dummySalt, passwordOptions);
  const matches = timingSafeEqual(actual, stored ? fromHex(stored.password_hash) : new Uint8Array(32));
  if (!stored || !matches) throw new AuthError(401, "Неверный логин или пароль.");
  await rpc("start_session", { p_id: stored.id, p_token_hash: digest });
  return { account: { id: stored.id, login: stored.login }, token };
}

function reply(status: number, body: unknown, headers: Headers) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  if (origin) {
    if (!origins.has(origin)) return reply(403, { error: "Этот адрес сайта не поддерживается." }, headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-Tokumei-Session");
  }
  if (request.method === "OPTIONS") return reply(204, null, headers);
  const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  try {
    if (request.method === "POST" && (action === "register" || action === "login")) {
      return reply(action === "register" ? 201 : 200, await signInOrRegister(request, action === "register"), headers);
    }
    if ((request.method === "GET" && action === "session") || (request.method === "POST" && action === "logout")) {
      const token = request.headers.get("X-Tokumei-Session") ?? "";
      if (!tokenPattern.test(token)) throw new AuthError(401, "Войдите в Tokumei.");
      const digest = await tokenHash(token);
      if (action === "logout") {
        await rpc("end_session", { p_token_hash: digest });
        return reply(204, null, headers);
      }
      const account = await rpc<Account | null>("session", { p_token_hash: digest });
      if (!account) throw new AuthError(401, "Сессия завершилась. Войдите снова.");
      return reply(200, { account }, headers);
    }
    return reply(404, { error: "Такой операции нет." }, headers);
  } catch (error) {
    if (error instanceof AuthError) return reply(error.status, { error: error.message }, headers);
    console.error(error instanceof Error && error.message.startsWith("Account storage error")
      ? error.message : "Tokumei account request failed");
    return reply(503, { error: "Вход временно недоступен. Попробуйте чуть позже." }, headers);
  }
});
