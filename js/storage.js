const STORAGE_KEY = "tokumei.workspace.v1";
export const MAX_FIELDS = 16;

export const GRAPH_TYPES = {
  person: { label: "Человек", valueLabel: "Имя и фамилия" },
  phone: { label: "Телефон", valueLabel: "Номер телефона", inputMode: "tel" },
  email: { label: "Почта", valueLabel: "Почтовый адрес", inputMode: "email" },
  account: { label: "Аккаунт", valueLabel: "Имя пользователя или профиль" },
  link: { label: "Ссылка", valueLabel: "Адрес ссылки", inputMode: "url" },
  note: { label: "Заметка", valueLabel: "Название или факт" },
};

function emptyGraph() {
  return { nodes: [], edges: [] };
}

export function emptyWorkspace() {
  return { version: 1, records: [], personas: [], mailboxes: [], graph: emptyGraph() };
}

function readStoredWorkspace(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return emptyWorkspace();
  const data = JSON.parse(raw);
  if (data?.version !== 1 || ![data.records, data.personas, data.mailboxes].every(Array.isArray)) {
    throw new Error("Формат локального хранилища не распознан.");
  }
  data.graph ??= emptyGraph();
  if (!Array.isArray(data.graph.nodes) || !Array.isArray(data.graph.edges)) {
    throw new Error("Формат карты связей не распознан.");
  }
  return data;
}

export function workspaceStorageKey(accountId) {
  return `${STORAGE_KEY}.account.${accountId}`;
}

export function readWorkspace(accountId) {
  return accountId ? readStoredWorkspace(workspaceStorageKey(accountId)) : emptyWorkspace();
}

export function updateWorkspace(accountId, update) {
  if (!accountId) throw new Error("Войдите в Tokumei.");
  const data = readWorkspace(accountId);
  update(data);
  try {
    localStorage.setItem(workspaceStorageKey(accountId), JSON.stringify(data));
  } catch {
    throw new Error("Не удалось сохранить данные в браузере. Проверьте настройки хранилища и свободное место.");
  }
  return data;
}

export function hasLegacyWorkspace() {
  const legacy = readStoredWorkspace(STORAGE_KEY);
  return Boolean(legacy.records.length || legacy.personas.length || legacy.mailboxes.length || legacy.graph.nodes.length);
}

function moveLegacyData(accountId) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return readWorkspace(accountId);
  const legacy = readStoredWorkspace(STORAGE_KEY);
  const updated = updateWorkspace(accountId, current => {
    mergeWorkspaceData(current, legacy);
    const ids = new Set(current.mailboxes.map(box => box.id));
    current.mailboxes.push(...legacy.mailboxes.filter(box => !ids.has(box.id)));
  });
  if (localStorage.getItem(STORAGE_KEY) === raw) localStorage.removeItem(STORAGE_KEY);
  return updated;
}

export async function moveLegacyWorkspace(accountId) {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request("tokumei-legacy-workspace", () => moveLegacyData(accountId));
  }
  return moveLegacyData(accountId);
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

export function normalizeGraphNode(input) {
  const value = string(input?.value, 180);
  if (!value) throw new Error("Введите значение узла.");
  const type = Object.hasOwn(GRAPH_TYPES, input.type) ? input.type : "note";
  const rawSource = string(input.source, 2048);
  const source = safeUrl(rawSource);
  if (rawSource && !source) throw new Error("Введите адрес источника с http:// или https://.");
  return {
    id: identifier(input.id),
    type,
    value,
    notes: string(input.notes, 4000),
    source,
    x: coordinate(input.x),
    y: coordinate(input.y),
  };
}

function coordinate(value) {
  return Number.isFinite(value) ? Math.max(-1_000_000, Math.min(1_000_000, value)) : 0;
}

export function hasGraphEdge(graph, from, to) {
  return graph.edges.some(edge => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from));
}

export function addGraphEdge(graph, input) {
  const { from, to } = input;
  const ids = new Set(graph.nodes.map(node => node.id));
  if (from === to || !ids.has(from) || !ids.has(to)) throw new Error("Для связи выберите два разных узла.");
  if (hasGraphEdge(graph, from, to)) throw new Error("Эти узлы уже связаны.");
  const id = identifier(input.id);
  if (graph.edges.some(edge => edge.id === id)) throw new Error("В карте повторяется идентификатор связи.");
  graph.edges.push({ id, from, to, label: string(input.label, 80) });
}

function parseGraph(input) {
  const graph = emptyGraph();
  if (input === undefined) return graph;
  if (!Array.isArray(input?.nodes) || !Array.isArray(input.edges)) {
    throw new Error("Формат карты связей в резервной копии не распознан.");
  }
  const ids = new Map();
  for (const original of input.nodes) {
    const node = normalizeGraphNode(original);
    if (typeof original.id !== "string" || !original.id || ids.has(original.id)) {
      throw new Error("В карте связей есть узел с отсутствующим или повторяющимся идентификатором.");
    }
    ids.set(original.id, node.id);
    graph.nodes.push(node);
  }
  for (const edge of input.edges) {
    addGraphEdge(graph, { ...edge, from: ids.get(edge?.from), to: ids.get(edge?.to) });
  }
  return graph;
}

export function mergeGraph(graph, incoming) {
  const nodes = new Set(graph.nodes.map(node => node.id));
  const edges = new Set(graph.edges.map(edge => edge.id));
  let added = 0;
  for (const node of incoming.nodes) {
    if (nodes.has(node.id)) continue;
    graph.nodes.push(node);
    nodes.add(node.id);
    added++;
  }
  for (const edge of incoming.edges) {
    if (edges.has(edge.id) || hasGraphEdge(graph, edge.from, edge.to)) continue;
    graph.edges.push(edge);
    edges.add(edge.id);
    added++;
  }
  return added;
}

export function mergeWorkspaceData(workspace, incoming) {
  let changed = 0;
  const records = new Map(workspace.records.map(record => [record.id, record]));
  for (const record of incoming.records) {
    const previous = records.get(record.id);
    if (previous && previous.updatedAt >= record.updatedAt) continue;
    records.set(record.id, record);
    changed++;
  }
  workspace.records = [...records.values()];

  const personas = new Map(workspace.personas.map(persona => [persona.id, persona]));
  for (const persona of incoming.personas) {
    if (personas.has(persona.id)) continue;
    personas.set(persona.id, persona);
    changed++;
  }
  workspace.personas = [...personas.values()];
  return changed + mergeGraph(workspace.graph, incoming.graph);
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
    gender: ["male", "female"].includes(input.gender) ? input.gender : "",
    occupation: string(input.occupation, 100),
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
  if (Array.isArray(data)) return { records: data.map(normalizeRecord), personas: [], graph: emptyGraph() };
  if (data?.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.personas)) {
    throw new Error("Выберите резервную копию Tokumei или JSON-массив записей.");
  }
  return {
    records: data.records.map(normalizeRecord),
    personas: data.personas.map(normalizePersona),
    graph: parseGraph(data.graph),
  };
}

export function makeBackup(workspace) {
  return JSON.stringify({
    version: 1,
    records: workspace.records,
    personas: workspace.personas.map(({ mailboxId, ...persona }) => persona),
    graph: workspace.graph,
  }, null, 2);
}
