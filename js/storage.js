import { PLATFORMS, supportsPlatform } from "./platforms.js?v=maps-1";

const STORAGE_KEY = "tokumei.workspace.v1";
const DEFAULT_MAP_TITLE = "Карта 1";
const INITIAL_MAP_PREFIX = "initial-";
export const MAX_FIELDS = 16;
export const MAX_MAPS = 3;

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

function defaultMap(graph = emptyGraph()) {
  return { ...graph, id: INITIAL_MAP_PREFIX + crypto.randomUUID(), title: DEFAULT_MAP_TITLE };
}

export function mapTitle(value) {
  const title = string(value, 80);
  if (!title) throw new Error("Введите название карты.");
  return title;
}

export function createMap(maps, title) {
  if (maps.length >= MAX_MAPS) throw new Error("В рабочем пространстве можно создать до трёх карт.");
  const map = { id: crypto.randomUUID(), title: mapTitle(title), ...emptyGraph() };
  maps.push(map);
  return map;
}

export function emptyWorkspace() {
  return { version: 2, records: [], personas: [], mailboxes: [], maps: [defaultMap()] };
}

function readStoredWorkspace(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return { data: emptyWorkspace(), migrated: true };
  const data = JSON.parse(raw);
  if (![1, 2].includes(data?.version) || ![data.records, data.personas, data.mailboxes].every(Array.isArray)) {
    throw new Error("Формат локального хранилища не распознан.");
  }
  if (data.version === 1) {
    const { graph, ...legacy } = data;
    const maps = [defaultMap(graph ?? emptyGraph())];
    validateMaps(maps);
    return { data: { ...legacy, version: 2, maps }, migrated: true };
  }
  validateMaps(data.maps);
  return { data, migrated: false };
}

export function workspaceStorageKey(accountId) {
  return `${STORAGE_KEY}.account.${accountId}`;
}

function withStorageLock(key, action) {
  return globalThis.navigator?.locks ? navigator.locks.request(key, action) : action();
}

function writeWorkspace(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    throw new Error("Не удалось сохранить данные в браузере. Проверьте настройки хранилища и свободное место.");
  }
}

export async function loadWorkspace(accountId) {
  const key = workspaceStorageKey(accountId);
  return withStorageLock(key, () => {
    const { data, migrated } = readStoredWorkspace(key);
    if (migrated) writeWorkspace(key, data);
    return data;
  });
}

export async function updateWorkspace(accountId, update) {
  if (!accountId) throw new Error("Войдите в Tokumei.");
  const key = workspaceStorageKey(accountId);
  return withStorageLock(key, () => {
    const { data } = readStoredWorkspace(key);
    update(data);
    validateMaps(data.maps);
    writeWorkspace(key, data);
    return data;
  });
}

export function hasLegacyWorkspace() {
  const { data: legacy } = readStoredWorkspace(STORAGE_KEY);
  return Boolean(legacy.records.length || legacy.personas.length || legacy.mailboxes.length || legacy.maps.some(map => map.nodes.length));
}

export async function moveLegacyWorkspace(accountId) {
  return withStorageLock(STORAGE_KEY, async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return loadWorkspace(accountId);
    const { data: legacy } = readStoredWorkspace(STORAGE_KEY);
    const updated = await updateWorkspace(accountId, current => {
      mergeWorkspaceData(current, { ...legacy, maps: [], legacyGraph: legacy.maps[0] });
      const ids = new Set(current.mailboxes.map(box => box.id));
      current.mailboxes.push(...legacy.mailboxes.filter(box => !ids.has(box.id)));
    });
    if (localStorage.getItem(STORAGE_KEY) === raw) localStorage.removeItem(STORAGE_KEY);
    return updated;
  });
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
  const platform = supportsPlatform(type) && typeof input.platform === "string" && Object.hasOwn(PLATFORMS, input.platform) ? input.platform : "";
  return {
    id: identifier(input.id),
    type,
    value,
    notes: string(input.notes, 4000),
    source,
    ...(platform ? { platform } : {}),
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

function isGraph(value) {
  return Array.isArray(value?.nodes) && Array.isArray(value.edges);
}

function validateMaps(maps) {
  if (!Array.isArray(maps) || !maps.length || maps.length > MAX_MAPS) {
    throw new Error("В рабочем пространстве должно быть от одной до трёх карт.");
  }
  const ids = new Set();
  for (const map of maps) {
    if (!isGraph(map) || typeof map.id !== "string" || !/^[\w-]{1,128}$/.test(map.id) || ids.has(map.id)) {
      throw new Error("Формат карты связей не распознан.");
    }
    mapTitle(map.title);
    ids.add(map.id);
  }
}

function parseGraph(input) {
  const graph = emptyGraph();
  if (input === undefined) return graph;
  if (!isGraph(input)) {
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
  const maps = new Map(workspace.maps.map(map => [map.id, map]));
  const first = workspace.maps[0];
  if (maps.size === 1 && first.id.startsWith(INITIAL_MAP_PREFIX) && first.title === DEFAULT_MAP_TITLE && !first.nodes.length &&
      incoming.maps.length && !incoming.maps.some(map => map.id === first.id)) {
    maps.delete(first.id);
  }
  const newMaps = incoming.maps.filter(map => !maps.has(map.id));
  if (maps.size + newMaps.length > MAX_MAPS) {
    throw new Error("Для новых карт из копии не хватает места. Освободите место и повторите импорт.");
  }

  let changed = 0;
  for (const map of incoming.maps) {
    const existing = maps.get(map.id);
    if (existing) changed += mergeGraph(existing, map);
    else {
      maps.set(map.id, map);
      changed += 1 + map.nodes.length + map.edges.length;
    }
  }
  workspace.maps = [...maps.values()];
  if (incoming.legacyGraph) changed += mergeGraph(workspace.maps[0], incoming.legacyGraph);

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
  return changed;
}

function normalizePersona(input) {
  const name = string(input?.name, 180);
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
    city: string(input.city, 100),
    country: string(input.country, 80),
    backstory: string(input.backstory, 1800),
    interest: string(input.interest, 200),
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
  if (Array.isArray(data)) return { records: data.map(normalizeRecord), personas: [], maps: [] };
  if (![1, 2].includes(data?.version) || !Array.isArray(data.records) || !Array.isArray(data.personas)) {
    throw new Error("Выберите резервную копию Tokumei или JSON-массив записей.");
  }
  if (data.version === 2) validateMaps(data.maps);
  return {
    records: data.records.map(normalizeRecord),
    personas: data.personas.map(normalizePersona),
    maps: data.version === 2 ? data.maps.map(({ id, title, ...graph }) => ({ id, title: mapTitle(title), ...parseGraph(graph) })) : [],
    ...(data.version === 1 && data.graph !== undefined ? { legacyGraph: parseGraph(data.graph) } : {}),
  };
}

export function makeBackup(workspace) {
  return JSON.stringify({
    version: 2,
    records: workspace.records,
    personas: workspace.personas.map(({ mailboxId, ...persona }) => persona),
    maps: workspace.maps,
  }, null, 2);
}
