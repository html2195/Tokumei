const API_ORIGIN = "https://api.nextmail.sh";
const INBOX_PATH = "/temp-mail/inboxes";

class MailError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", token } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(API_ORIGIN + path, {
      method, headers, credentials: "omit", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Нет связи с Nextmail. Проверьте подключение и попробуйте ещё раз.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const code = data?.error?.code;
    const message = code === "inbox_expired" ? "Срок действия ящика истёк. Создайте новый адрес."
      : response.status === 429 ? "Nextmail временно ограничил запросы. Попробуйте чуть позже."
      : response.status === 503 ? "Почтовый сервис временно недоступен. Попробуйте чуть позже."
      : `Nextmail вернул ошибку ${response.status}. Попробуйте ещё раз.`;
    throw new MailError(message, response.status, code);
  }
  return response.status === 204 ? null : response.json();
}

function inboxPath(mailbox) {
  return `${INBOX_PATH}/${encodeURIComponent(mailbox.id)}`;
}

export async function createMailbox() {
  const { id, address, token, createdAt, expiresAt } = await request(INBOX_PATH, { method: "POST" });
  if (![id, address, token, expiresAt].every(value => typeof value === "string" && value)) {
    throw new Error("Nextmail не вернул данные созданного ящика.");
  }
  return { id, address, token, createdAt, expiresAt };
}

export async function listMessages(mailbox, cursor) {
  const query = new URLSearchParams({ limit: "30" });
  if (cursor) query.set("cursor", cursor);
  const result = await request(`${inboxPath(mailbox)}/messages?${query}`, { token: mailbox.token });
  if (!Array.isArray(result?.data)) throw new Error("Nextmail вернул список писем в неизвестном формате.");
  return {
    messages: result.data,
    nextCursor: result.hasMore && typeof result.nextCursor === "string" ? result.nextCursor : null,
  };
}

export function getMessage(mailbox, id) {
  return request(`${inboxPath(mailbox)}/messages/${encodeURIComponent(id)}`, { token: mailbox.token });
}

export async function deleteMailbox(mailbox) {
  try {
    await request(inboxPath(mailbox), { method: "DELETE", token: mailbox.token });
  } catch (error) {
    if (error.status === 404 || error.code === "inbox_expired") return;
    throw error;
  }
}
