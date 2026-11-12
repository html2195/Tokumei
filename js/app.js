import { MAX_FIELDS, emptyWorkspace, makeBackup, mergeGraph, normalizeRecord, parseBackup, readWorkspace, safeUrl, updateWorkspace } from "./storage.js?v=f977e0b";
import { CHARACTER_OPTIONS, GENDER_LABELS, VOICE_OPTIONS, generatePersona } from "./personas.js?v=f977e0b";
import { createMailbox, deleteMailbox, getMessage, listMessages } from "./mail.js";
import { createGraphView } from "./graph.js?v=black-hole-1";

const element = id => document.getElementById(id);
const recordForm = element("record-form");
const recordDialog = element("record-dialog");
const messageDialog = element("message-dialog");
const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" });
const expiryFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const years = new Intl.PluralRules("ru-RU");
const defaultCategories = ["Заметки", "Ссылки", "Контакты", "Проекты"];
const routes = ["overview", "graph", "data", "personas", "mail"];
const escapeCharacters = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

let workspace = emptyWorkspace();
let route = "overview";
let editingRecordId = null;
let profile = null;
let mailboxId = null;
let inbox = newInbox();
let changingMailboxes = false;
let messageRequest = 0;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => escapeCharacters[character]);
}

function formattedDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? dateFormat.format(time) : "";
}

function ageLabel(age) {
  const endings = { one: "год", few: "года", many: "лет", other: "лет" };
  return `${age} ${endings[years.select(age)]}`;
}

function icon(name, color) {
  return `<span class="icon-box ${color}" aria-hidden="true"><span class="icon i-${name}"></span></span>`;
}

function emptyState(title, description, image = "", action = "", panel = true) {
  return `<div class="empty ${panel ? "surface" : ""}">${image}<h3>${title}</h3>
    ${description ? `<p>${description}</p>` : ""}${action}</div>`;
}

function notify(message) {
  const toast = element("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

function setNotice(id, message = "") {
  const notice = element(id);
  notice.textContent = message;
  notice.hidden = !message;
}

function commit(update) {
  workspace = updateWorkspace(update);
}

function chips(values) {
  return values.length ? `<span class="tags">${values.map(value => `<span class="chip">${escapeHtml(value)}</span>`).join("")}</span>` : "";
}

function latestRecords() {
  return [...workspace.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function renderOverview() {
  element("record-count").textContent = workspace.records.length;
  element("persona-count").textContent = workspace.personas.length;
  element("mail-count").textContent = workspace.mailboxes.length;
  const records = latestRecords().slice(0, 4);
  element("recent-records").innerHTML = records.length
    ? records.map(record => `<button class="recent-row" type="button" data-action="open-record" data-id="${escapeHtml(record.id)}">
        ${icon("record", "green")}<span class="row-main"><strong>${escapeHtml(record.title)}</strong>
        <small>${escapeHtml(record.category)}</small></span><span class="row-date">${formattedDate(record.updatedAt)}</span>
      </button>`).join("")
    : emptyState("У вас пока нет записей", "Добавьте заметку, ссылку или данные по проекту.", icon("record", "green"),
      '<button class="button secondary" type="button" data-action="new-record">Добавить запись</button>', false);
}

function renderRecords() {
  const categories = [...new Set(workspace.records.map(record => record.category))].sort((a, b) => a.localeCompare(b, "ru"));
  const select = element("category-filter");
  const category = categories.includes(select.value) ? select.value : "";
  select.replaceChildren(new Option("Все категории", ""), ...categories.map(value => new Option(value, value)));
  select.value = category;
  element("category-options").replaceChildren(
    ...[...new Set([...defaultCategories, ...categories])].map(value => new Option(value, value)),
  );

  const query = element("record-search").value.toLocaleLowerCase("ru").trim().split(/\s+/).filter(Boolean);
  const records = latestRecords().filter(record => {
    if (category && category !== record.category) return false;
    const searchable = [record.title, record.category, record.notes, record.url, ...record.tags,
      ...record.fields.flatMap(field => [field.name, field.value])].join(" ").toLocaleLowerCase("ru");
    return query.every(term => searchable.includes(term));
  });
  element("record-results").textContent = workspace.records.length ? `Найдено записей — ${records.length}` : "";
  element("record-list").innerHTML = records.length ? records.map(record => `
    <article class="surface record-card">
      <button class="card-button" type="button" data-action="open-record" data-id="${escapeHtml(record.id)}">
        <span class="card-kicker">${escapeHtml(record.category)}</span>
        <span class="card-title">${escapeHtml(record.title)}</span>
        <span class="card-summary">${escapeHtml(record.notes || record.url || record.fields.map(field => field.value).join(" · "))}</span>
        ${chips(record.tags)}<span class="card-meta">${formattedDate(record.updatedAt)}</span>
      </button>
    </article>`).join("") : workspace.records.length
    ? emptyState("Записи не найдены", "Измените запрос или выберите другую категорию.", icon("search", "green"),
      '<button class="button secondary" type="button" data-action="clear-filters">Сбросить фильтры</button>')
    : emptyState("Здесь будут ваши записи", "Создайте запись или импортируйте JSON.", icon("record", "green"));
}

function addField(field = {}, focus = false) {
  const container = element("custom-fields");
  if (container.children.length >= MAX_FIELDS) return;
  const row = document.createElement("div");
  row.className = "custom-field";
  row.innerHTML = `<input aria-label="Название поля" placeholder="Поле" maxlength="60">
    <input aria-label="Значение поля" placeholder="Значение" maxlength="400">
    <button class="button icon-button" type="button" data-action="remove-field" aria-label="Убрать поле">×</button>`;
  row.children[0].value = field.name ?? "";
  row.children[1].value = field.value ?? "";
  container.append(row);
  element("add-custom-field").disabled = container.children.length === MAX_FIELDS;
  if (focus) row.children[0].focus();
}

function openRecord(record) {
  editingRecordId = record?.id ?? null;
  recordForm.reset();
  setNotice("record-error");
  element("record-dialog-title").textContent = record ? "Запись" : "Новая запись";
  element("delete-record").hidden = !record;
  element("custom-fields").replaceChildren();
  element("add-custom-field").disabled = false;
  const url = safeUrl(record?.url);
  const link = element("open-record-link");
  link.hidden = !url;
  if (url) link.href = url;
  else link.removeAttribute("href");
  if (record) {
    for (const field of ["title", "category", "notes", "url"]) {
      recordForm.elements.namedItem(field).value = record[field];
    }
    recordForm.elements.namedItem("tags").value = record.tags.join(", ");
    record.fields.forEach(field => addField(field));
  }
  recordDialog.showModal();
}

function saveRecord(event) {
  event.preventDefault();
  setNotice("record-error");
  try {
    const fields = Array.from(element("custom-fields").children, row => ({
      name: row.children[0].value.trim(), value: row.children[1].value.trim(),
    }));
    if (fields.some(field => Boolean(field.name) !== Boolean(field.value))) {
      throw new Error("Заполните название и значение каждого дополнительного поля.");
    }
    const input = Object.fromEntries(new FormData(recordForm));
    const now = new Date().toISOString();
    commit(data => {
      const index = data.records.findIndex(record => record.id === editingRecordId);
      if (editingRecordId && index < 0) throw new Error("Эта запись уже удалена.");
      const record = normalizeRecord({ ...input, fields, id: editingRecordId,
        createdAt: data.records[index]?.createdAt ?? now, updatedAt: now });
      if (index === -1) data.records.push(record);
      else data.records[index] = record;
    });
    recordDialog.close();
    render();
    notify("Запись сохранена");
  } catch (error) {
    setNotice("record-error", error.message);
  }
}

function confirmRemoval(title, description) {
  const dialog = element("confirm-dialog");
  element("confirm-title").textContent = title;
  element("confirm-text").textContent = description;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
  });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
}

function profileText(persona) {
  const address = workspace.mailboxes.find(box => box.id === persona.mailboxId)?.address;
  const gender = GENDER_LABELS[persona.gender];
  return [
    `${persona.name} · ${ageLabel(persona.age)}`,
    gender ? `Пол — ${gender}` : "",
    persona.occupation ? `Род занятий — ${persona.occupation}` : "",
    persona.description,
    persona.traits.join(", "),
    persona.style,
    persona.example,
    address,
  ].filter(Boolean).join("\n\n");
}

function renderPersonas() {
  const selected = workspace.personas.find(persona => persona.id === profile?.id);
  if (selected) profile = selected;
  if (!profile) {
    element("persona-preview").innerHTML = emptyState("Профиль появится здесь",
      "Укажите диапазон возраста и запустите генерацию.", icon("person", "lilac"), "", false);
  } else {
    const gender = GENDER_LABELS[profile.gender];
    const mail = workspace.mailboxes.length ? `<label class="field profile-mail">Временная почта
      <select id="profile-mailbox"><option value="">Без адреса</option>${workspace.mailboxes.map(box => `
        <option value="${escapeHtml(box.id)}" ${box.id === profile.mailboxId ? "selected" : ""}>${escapeHtml(box.address)}</option>
      `).join("")}</select></label>` : '<div class="profile-mail"><a href="#mail" class="text-link">Создать временную почту</a></div>';
    element("persona-preview").innerHTML = `<div class="profile">
      <header class="profile-header"><span class="avatar" aria-hidden="true">${escapeHtml(initials(profile.name))}</span>
        <div><h2>${escapeHtml(profile.name)}</h2><p>${ageLabel(profile.age)} · Вымышленный профиль</p></div></header>
      ${gender || profile.occupation ? `<dl class="profile-facts">
        ${gender ? `<div><dt>Пол</dt><dd>${escapeHtml(gender)}</dd></div>` : ""}
        ${profile.occupation ? `<div><dt>Род занятий</dt><dd>${escapeHtml(profile.occupation)}</dd></div>` : ""}
      </dl>` : ""}
      <div class="profile-details">
        <section><h3>Характер</h3><p>${escapeHtml(profile.description)}</p>${chips(profile.traits)}</section>
        <section><h3>Особенности общения</h3><p>${escapeHtml(profile.style)}</p></section>
        ${profile.example ? `<section><h3>Пример ${profile.age < 3 ? "реакции" : "реплики"}</h3>
          <blockquote>${escapeHtml(profile.example)}</blockquote></section>` : ""}
      </div>
      ${mail}
      <div class="profile-actions">
        ${selected ? "" : '<button class="button primary" type="button" data-action="save-persona">Сохранить профиль</button>'}
        <button class="button secondary" type="button" data-action="copy-persona">Копировать</button>
        ${selected ? '<button class="button quiet" type="button" data-action="delete-persona">Удалить</button>' : ""}
      </div>
    </div>`;
  }

  element("persona-list").innerHTML = workspace.personas.length
    ? [...workspace.personas].reverse().map(persona => `<article class="surface saved-card ${profile?.id === persona.id ? "selected" : ""}">
        <button class="card-button" type="button" data-action="open-persona" data-id="${escapeHtml(persona.id)}"
          aria-pressed="${profile?.id === persona.id}">
          <span class="avatar" aria-hidden="true">${escapeHtml(initials(persona.name))}</span>
          <span><span class="card-title">${escapeHtml(persona.name)}</span><span class="saved-age">${ageLabel(persona.age)}</span></span>
        </button></article>`).join("")
    : emptyState("Список пока пуст", "Сохраните сгенерированный профиль, чтобы вернуться к нему позже.");
}

function generateProfile(event) {
  event.preventDefault();
  setNotice("persona-error");
  const { ageMin, ageMax, locale, ...options } = Object.fromEntries(new FormData(event.currentTarget));
  try {
    profile = generatePersona(Number(ageMin), Number(ageMax), locale, options);
    renderPersonas();
  } catch (error) {
    setNotice("persona-error", error.message);
  }
}

function updateProfileMailbox(id) {
  if (!profile) return;
  const mailbox = workspace.mailboxes.find(box => box.id === id);
  const next = { ...profile, mailboxId: mailbox?.id ?? null };
  if (workspace.personas.some(persona => persona.id === profile.id)) {
    commit(data => {
      const persona = data.personas.find(persona => persona.id === next.id);
      if (persona) persona.mailboxId = next.mailboxId;
    });
  }
  profile = next;
  notify(mailbox ? "Адрес привязан к профилю" : "Адрес отвязан");
}

function newInbox() {
  return { messages: [], nextCursor: null, paginated: false, busy: false, loaded: false, error: "" };
}

function renderMail() {
  const createButton = element("create-mailbox");
  createButton.disabled = changingMailboxes;
  createButton.innerHTML = changingMailboxes ? "Подождите…" : '<span class="plus" aria-hidden="true">+</span> Создать ящик';
  const layout = element("mail-layout");
  const mailboxes = workspace.mailboxes;
  if (!mailboxes.some(box => box.id === mailboxId)) {
    mailboxId = mailboxes.at(-1)?.id ?? null;
    inbox = newInbox();
  }
  if (!mailboxId) {
    layout.innerHTML = emptyState("Создайте первый ящик", "После создания здесь появятся адрес и входящие письма.", icon("mail", "amber"));
    return;
  }
  const mailbox = mailboxes.find(box => box.id === mailboxId);
  const expiry = Date.parse(mailbox.expiresAt);
  layout.innerHTML = `<section class="surface mailboxes" aria-label="Почтовые ящики">
    <h2>Ящики</h2>
    ${[...mailboxes].reverse().map(box => `<button class="mailbox-button" type="button" data-action="select-mailbox"
      data-id="${escapeHtml(box.id)}" aria-pressed="${box.id === mailboxId}">${escapeHtml(box.address)}</button>`).join("")}
    </section><section class="surface" aria-label="Входящие письма"><header class="inbox-header">
      <div><h2>${escapeHtml(mailbox.address)}</h2>
        ${Number.isFinite(expiry) ? `<p class="mail-expiry">Действует до ${expiryFormat.format(expiry)}</p>` : ""}</div>
      <div class="inbox-actions">
        <button class="button secondary small" type="button" data-action="copy-address">Копировать адрес</button>
        <button class="button secondary small" id="refresh-mailbox" type="button" data-action="refresh-mailbox">Обновить</button>
        <button class="button quiet small" type="button" data-action="delete-mailbox" ${changingMailboxes ? "disabled" : ""}>Убрать ящик</button>
      </div></header><div class="inbox-list" id="inbox-list" aria-live="polite"></div></section>`;
  renderInbox();
}

function renderInbox() {
  const list = element("inbox-list");
  if (!list) return;
  element("refresh-mailbox").disabled = inbox.busy || changingMailboxes;
  element("refresh-mailbox").textContent = inbox.busy ? "Обновление…" : "Обновить";
  let content;
  if (inbox.messages.length) {
    content = (inbox.error ? `<p class="notice">${escapeHtml(inbox.error)}</p>` : "")
      + inbox.messages.map(message => `<button class="message-row" type="button" data-action="open-message" data-id="${escapeHtml(message.id)}">
        ${icon("mail", "amber")}<span class="row-main"><strong>${escapeHtml(message.subject || "Без темы")}</strong>
        <small>${escapeHtml(message.from?.name || message.from?.email || "Неизвестный отправитель")}</small></span>
        <span class="row-date">${formattedDate(message.receivedAt)}</span></button>`).join("");
  } else {
    const title = inbox.error ? "Не удалось загрузить письма" : inbox.busy ? "Загружаем письма…" : "Пока нет писем";
    const description = inbox.error || (inbox.loaded ? "Отправьте письмо на этот адрес. Входящие обновляются автоматически." : "");
    content = emptyState(title, escapeHtml(description), icon("mail", "amber"), "", false);
  }
  list.innerHTML = content
    + (inbox.nextCursor ? `<button class="button secondary small more" type="button" data-action="more-messages"
        ${inbox.busy ? "disabled" : ""}>Показать ещё</button>` : "");
}

async function refreshInbox(cursor = null) {
  const mailbox = workspace.mailboxes.find(box => box.id === mailboxId);
  const current = inbox;
  if (!mailbox || current.busy || changingMailboxes) return;
  current.busy = true;
  current.error = "";
  renderInbox();
  try {
    const result = await listMessages(mailbox, cursor);
    const messages = cursor ? [...current.messages, ...result.messages] : result.messages;
    current.messages = [...new Map(messages.map(message => [message.id, message])).values()];
    current.paginated = Boolean(cursor);
    current.nextCursor = result.nextCursor;
    current.loaded = true;
  } catch (error) {
    current.error = error.message;
  } finally {
    current.busy = false;
    if (current === inbox) renderInbox();
  }
}

async function addMailbox() {
  if (changingMailboxes) return;
  changingMailboxes = true;
  setNotice("mail-error");
  renderMail();
  let mailbox;
  try {
    commit(() => {});
    mailbox = await createMailbox();
    commit(data => { data.mailboxes.push(mailbox); });
    mailboxId = mailbox.id;
    inbox = newInbox();
    notify("Временный ящик создан");
  } catch (error) {
    setNotice("mail-error", error.message);
    if (mailbox) {
      try {
        await deleteMailbox(mailbox);
      } catch {
        setNotice("mail-error", `${error.message} Адрес ${mailbox.address} истечёт автоматически.`);
      }
    }
    mailbox = null;
  } finally {
    changingMailboxes = false;
    render();
  }
  if (mailbox) await refreshInbox();
}

async function removeMailbox() {
  const mailbox = workspace.mailboxes.find(box => box.id === mailboxId);
  if (!mailbox || changingMailboxes) return;
  if (!await confirmRemoval("Убрать ящик?", "Tokumei уберёт адрес из списка и очистит входящие письма.")) return;
  changingMailboxes = true;
  setNotice("mail-error");
  renderMail();
  try {
    await deleteMailbox(mailbox);
    commit(data => {
      data.mailboxes = data.mailboxes.filter(box => box.id !== mailbox.id);
      for (const persona of data.personas) {
        if (persona.mailboxId === mailbox.id) persona.mailboxId = null;
      }
    });
    if (profile?.mailboxId === mailbox.id) profile = { ...profile, mailboxId: null };
    notify("Ящик удалён");
  } catch (error) {
    setNotice("mail-error", error.message);
  } finally {
    changingMailboxes = false;
    render();
  }
  if (!inbox.loaded) await refreshInbox();
}

function messageContent(message) {
  const body = message.message?.decodedBody || message.snippet || "";
  if (!/<(?:!doctype|html|body|div|p|table|span|a|br|img|strong|h[1-6])[\s/>]/i.test(body)) {
    return { text: body, links: [] };
  }
  const template = document.createElement("template");
  template.innerHTML = body;
  for (const node of template.content.querySelectorAll("script, style, iframe, object, embed, noscript, svg, link, meta")) node.remove();
  const links = Array.from(template.content.querySelectorAll("a[href]"), link => safeUrl(link.getAttribute("href"))).filter(Boolean);
  for (const node of template.content.querySelectorAll("p, div, tr, li, br, h1, h2, h3, blockquote")) node.after("\n");
  return { text: template.content.textContent.trim(), links: [...new Set(links)] };
}

async function openMessage(id) {
  const mailbox = workspace.mailboxes.find(box => box.id === mailboxId);
  if (!mailbox) return;
  const request = ++messageRequest;
  const body = element("message-body");
  element("message-title").textContent = "Письмо";
  body.textContent = "Загружаем письмо…";
  messageDialog.showModal();
  try {
    const message = await getMessage(mailbox, id);
    if (!messageDialog.open || request !== messageRequest) return;
    element("message-title").textContent = message.subject || "Без темы";
    const { text, links } = messageContent(message);
    const sender = [message.from?.name, message.from?.email].filter(Boolean).join(" · ");
    body.innerHTML = `<p class="message-meta">${escapeHtml(sender)} · ${formattedDate(message.receivedAt)}</p>
      <p class="message-text">${escapeHtml(text || "В письме нет текстового содержимого.")}</p>
      ${links.length ? `<h3>Ссылки в письме</h3><ul class="message-links">${links.map(link => `
        <li><a class="text-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></li>
      `).join("")}</ul>` : ""}`;
  } catch (error) {
    if (messageDialog.open && request === messageRequest) body.textContent = error.message;
  }
}

async function copyText(text, confirmation) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  notify(confirmation);
}

function exportWorkspace() {
  const blob = new Blob([makeBackup(workspace)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tokumei-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importWorkspace(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    let changed = 0;
    commit(data => {
      const records = new Map(data.records.map(record => [record.id, record]));
      for (const record of backup.records) {
        const previous = records.get(record.id);
        if (previous && previous.updatedAt >= record.updatedAt) continue;
        records.set(record.id, record);
        changed++;
      }
      data.records = [...records.values()];
      const personas = new Map(data.personas.map(persona => [persona.id, persona]));
      for (const persona of backup.personas) {
        if (personas.has(persona.id)) continue;
        personas.set(persona.id, persona);
        changed++;
      }
      data.personas = [...personas.values()];
      changed += mergeGraph(data.graph, backup.graph);
    });
    render();
    notify(changed ? `Импортировано элементов — ${changed}` : "Новых данных в файле нет");
  } catch (error) {
    notify(error.message);
  }
}

function render() {
  renderOverview();
  renderRecords();
  renderPersonas();
  renderMail();
  graphView.render();
}

function showRoute(focus = false) {
  const hash = location.hash.slice(1);
  route = routes.includes(hash) ? hash : "overview";
  for (const view of document.querySelectorAll("[data-view]")) view.hidden = view.dataset.view !== route;
  for (const link of document.querySelectorAll("[data-route]")) {
    if (link.dataset.route === (route === "graph" ? "data" : route)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `${element(`${route}-title`).textContent} · Tokumei`;
  if (focus) {
    element("workspace").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  if (route === "mail" && !inbox.loaded) void refreshInbox();
  if (route === "graph") graphView.render();
}

const actions = {
  "new-record": () => openRecord(),
  "open-record": button => openRecord(workspace.records.find(record => record.id === button.dataset.id)),
  privacy: () => element("privacy-dialog").showModal(),
  "close-dialog": button => button.closest("dialog").close(),
  "add-field": () => addField({}, true),
  "remove-field": button => {
    button.closest(".custom-field").remove();
    element("add-custom-field").disabled = false;
    element("add-custom-field").focus();
  },
  "delete-record": async () => {
    const id = editingRecordId;
    if (!await confirmRemoval("Удалить запись?", "Запись будет удалена из рабочего пространства.")) return;
    try {
      commit(data => { data.records = data.records.filter(record => record.id !== id); });
      recordDialog.close();
      render();
      notify("Запись удалена");
    } catch (error) {
      setNotice("record-error", error.message);
    }
  },
  "clear-filters": () => {
    element("record-search").value = "";
    element("category-filter").value = "";
    renderRecords();
    element("record-search").focus();
  },
  import: () => element("import-file").click(),
  export: exportWorkspace,
  "save-persona": () => {
    if (!profile) return;
    commit(data => {
      if (!data.personas.some(persona => persona.id === profile.id)) data.personas.push(profile);
    });
    render();
    notify("Профиль сохранён");
  },
  "open-persona": button => {
    profile = workspace.personas.find(persona => persona.id === button.dataset.id);
    renderPersonas();
    const preview = element("persona-preview");
    preview.querySelector("button")?.focus({ preventScroll: true });
    preview.scrollIntoView({ block: "nearest" });
  },
  "copy-persona": () => profile && copyText(profileText(profile), "Профиль скопирован"),
  "delete-persona": async () => {
    const id = profile?.id;
    if (!id || !await confirmRemoval("Удалить персонажа?", "Профиль будет удалён из списка сохранённых.")) return;
    commit(data => { data.personas = data.personas.filter(persona => persona.id !== id); });
    if (profile?.id === id) profile = null;
    render();
    notify("Профиль удалён");
  },
  "create-mailbox": addMailbox,
  "select-mailbox": button => {
    if (button.dataset.id === mailboxId) return;
    mailboxId = button.dataset.id;
    inbox = newInbox();
    setNotice("mail-error");
    renderMail();
    document.querySelector('.mailbox-button[aria-pressed="true"]')?.focus();
    return refreshInbox();
  },
  "copy-address": () => copyText(workspace.mailboxes.find(box => box.id === mailboxId)?.address, "Адрес скопирован"),
  "refresh-mailbox": () => refreshInbox(),
  "more-messages": () => refreshInbox(inbox.nextCursor),
  "delete-mailbox": removeMailbox,
  "open-message": button => openMessage(button.dataset.id),
};

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    await actions[button.dataset.action](button);
  } catch (error) {
    notify(error.message);
  }
});
document.addEventListener("change", event => {
  if (event.target.id !== "profile-mailbox") return;
  try {
    updateProfileMailbox(event.target.value);
  } catch (error) {
    event.target.value = profile?.mailboxId ?? "";
    notify(error.message);
  }
});
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  element("workspace").focus();
});
recordForm.addEventListener("submit", saveRecord);
element("persona-form").addEventListener("submit", generateProfile);
element("record-search").addEventListener("input", renderRecords);
element("category-filter").addEventListener("change", renderRecords);
element("import-file").addEventListener("change", importWorkspace);
window.addEventListener("hashchange", () => showRoute(true));
window.addEventListener("storage", () => {
  try {
    const wasSaved = workspace.personas.some(persona => persona.id === profile?.id);
    workspace = readWorkspace();
    if (wasSaved && !workspace.personas.some(persona => persona.id === profile?.id)) profile = null;
    render();
    if (route === "mail" && !inbox.loaded) void refreshInbox();
  } catch (error) {
    notify(error.message);
  }
});
setInterval(() => {
  if (route === "mail" && !document.hidden && !inbox.error && !inbox.paginated) void refreshInbox();
}, 30000);

const graphView = createGraphView({
  getGraph: () => workspace.graph,
  save: update => commit(data => update(data.graph)),
  escapeHtml,
  setNotice,
  notify,
  confirmRemoval,
});
for (const [id, options] of [
  ["persona-gender", Object.entries(GENDER_LABELS)],
  ["persona-character", CHARACTER_OPTIONS],
  ["persona-voice", VOICE_OPTIONS],
]) {
  element(id).append(...options.map(([value, label]) => new Option(label, value)));
}

try {
  workspace = readWorkspace();
} catch {
  notify("Не удалось прочитать данные этого браузера.");
}
render();
showRoute();
