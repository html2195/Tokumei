const STORAGE_KEY = "tokumei.workspace.v1";
export const MAX_FIELDS = 16;

function emptyWorkspace() {
  return { version: 1, records: [], personas: [], mailboxes: [] };
}

export function readWorkspace() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyWorkspace();
  const data = JSON.parse(raw);
  if (data?.version !== 1 || ![data.records, data.personas, data.mailboxes].every(Array.isArray)) {
    throw new Error("Формат локального хранилища не распознан.");
  }
  return data;
}

export function updateWorkspace(update) {
  const data = readWorkspace();
  update(data);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    throw new Error("Не удалось сохранить данные в браузере. Проверьте настройки хранилища и свободное место.");
  }
  return data;
}

function string(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function identifier(value) {
  return typeof value === "string" && /^[\w-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function date(value, fallback) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeRecord(input) {
  const title = string(input?.title, 140);
  if (!title) throw new Error("У каждой записи должно быть название.");
  const rawUrl = string(input.url, 2048);
  const url = safeUrl(rawUrl);
  if (rawUrl && !url) throw new Error("Введите ссылку, которая начинается с http:// или https://.");
  const tags = Array.isArray(input.tags) ? input.tags : string(input.tags, 450).split(",");
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const now = new Date().toISOString();
  const createdAt = date(input.createdAt, now);
  return {
    id: identifier(input.id),
    title,
    category: string(input.category, 60) || "Без категории",
    tags: [...new Set(tags.map(tag => string(tag, 35)).filter(Boolean))].slice(0, 12),
    url,
    notes: string(input.notes, 20000),
    fields: fields.slice(0, MAX_FIELDS).map(field => ({
      name: string(field?.name, 60),
      value: string(field?.value, 400),
    })).filter(field => field.name && field.value),
    createdAt,
    updatedAt: date(input.updatedAt, createdAt),
  };
}

function normalizePersona(input) {
  const name = string(input?.name, 120);
  const age = input?.age;
  const description = string(input?.description, 1000);
  const style = string(input?.style, 1000);
  if (!name || !Number.isInteger(age) || age < 0 || age > 120 || !description || !style) {
    throw new Error("В файле есть профиль без имени, возраста, характера или стиля общения.");
  }
  return {
    id: identifier(input.id), name, age, description, style,
    traits: (Array.isArray(input.traits) ? input.traits : []).map(trait => string(trait, 50)).filter(Boolean).slice(0, 8),
    example: string(input.example, 1000),
    createdAt: date(input.createdAt, new Date().toISOString()),
    mailboxId: null,
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Файл содержит некорректный JSON.");
  }
  if (Array.isArray(data)) return { records: data.map(normalizeRecord), personas: [] };
  if (data?.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.personas)) {
    throw new Error("Выберите резервную копию Tokumei или JSON-массив записей.");
  }
  return { records: data.records.map(normalizeRecord), personas: data.personas.map(normalizePersona) };
}

export function makeBackup(workspace) {
  return JSON.stringify({
    version: 1,
    records: workspace.records,
    personas: workspace.personas.map(({ mailboxId, ...persona }) => persona),
  }, null, 2);
}
