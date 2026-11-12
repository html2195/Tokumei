const AUTH_URL = "https://hebezaffdeqrpjhamcqq.supabase.co/functions/v1/tokumei-auth";
const SESSION_KEY = "tokumei.auth.session.v1";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const LOGIN_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
let token = loadToken();

function loadToken() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY) ?? "";
    return TOKEN_PATTERN.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

function storeToken(next) {
  token = next;
  try {
    if (next) sessionStorage.setItem(SESSION_KEY, next);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The in-memory session still works when tab storage is unavailable.
  }
}

export function generateLogin() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "tk-" + Array.from(bytes, byte => LOGIN_ALPHABET[byte & 31]).join("");
}

async function request(action, { method = "GET", body, session = token } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (session) headers["X-Tokumei-Session"] = session;
  let response;
  try {
    response = await fetch(`${AUTH_URL}/${action}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      credentials: "omit", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Нет связи с сервером входа. Попробуйте ещё раз.");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error ?? "Вход временно недоступен. Попробуйте чуть позже.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function validatedAccount(account) {
  if (!account || !/^[0-9a-f-]{36}$/.test(account.id) || typeof account.login !== "string") {
    throw new Error("Сервер вернул неизвестный формат учётной записи.");
  }
  return account;
}

export async function authenticate(mode, login, password) {
  const result = await request(mode === "register" ? "register" : "login", {
    method: "POST", body: { login, password }, session: "",
  });
  const account = validatedAccount(result?.account);
  if (!TOKEN_PATTERN.test(result?.token)) throw new Error("Сервер не выдал сессию.");
  storeToken(result.token);
  return account;
}

export async function restoreSession() {
  if (!token) return null;
  try {
    return validatedAccount((await request("session"))?.account);
  } catch (error) {
    if (error.status !== 401) throw error;
    storeToken("");
    return null;
  }
}

export async function endSession() {
  const session = token;
  storeToken("");
  if (session) await request("logout", { method: "POST", session });
}
