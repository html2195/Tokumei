import { addGraphEdge, createMap, GRAPH_TYPES, hasGraphEdge, mapTitle, MAX_MAPS, normalizeGraphNode, safeUrl } from "./storage.js?v=maps-1";
import { nodePlatform, platformLink, PLATFORMS, supportsPlatform } from "./platforms.js?v=maps-1";

const NODE_GAP_X = 310;
const NODE_GAP_Y = 102;
const MAX_ZOOM = 1.8;
const KEY_MOVES = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };

export function createGraphView({ getMaps, updateMaps, escapeHtml, setNotice, notify, confirmRemoval }) {
  const element = id => document.getElementById(id);
  const viewport = element("graph-viewport");
  const world = element("graph-world");
  const canvas = element("graph-edges");
  const context = canvas.getContext("2d");
  const mapDialog = element("graph-map-dialog");
  const mapForm = element("graph-map-form");
  const mapList = element("graph-map-list");
  const nodeDialog = element("graph-node-dialog");
  const nodeForm = element("graph-node-form");
  const nodeType = element("graph-node-type");
  const nodePlatformSelect = element("graph-node-platform");
  const edgeDialog = element("graph-edge-dialog");
  const edgeForm = element("graph-edge-form");
  const edgeTarget = edgeForm.elements.namedItem("target");
  const camera = { x: 0, y: 0, scale: 1, minScale: 0.2 };
  let nodeButtons = new Map();
  let activeMapId = null;
  let mapDraft = null;
  let saving = false;
  let viewGeneration = 0;
  let selectedId = null;
  let nodeDraft = {};
  let edgeDraft = {};
  let fitted = false;
  let drag = null;
  let paintFrame = 0;

  nodeType.replaceChildren(...Object.entries(GRAPH_TYPES).map(([type, details]) => new Option(details.label, type)));
  nodePlatformSelect.replaceChildren(new Option("Определить по ссылке", ""),
    ...Object.entries(PLATFORMS).map(([key, { label }]) => new Option(label, key)));

  function getGraph() {
    const maps = getMaps();
    return maps.find(map => map.id === activeMapId) ?? maps[0];
  }

  function save(update) {
    const mapId = getGraph().id;
    return updateMaps(maps => {
      const map = maps.find(item => item.id === mapId);
      if (!map) throw new Error("Эта карта уже удалена.");
      update(map);
    });
  }

  function renderMaps() {
    const maps = getMaps();
    const focused = document.activeElement?.dataset.mapId;
    mapList.innerHTML = maps.map(map => {
      const title = escapeHtml(map.title);
      return `<button class="button secondary small graph-map-button" type="button" data-graph-action="select-map"
        data-map-id="${escapeHtml(map.id)}" aria-pressed="${map.id === activeMapId}" title="${title}">${title}</button>`;
    }).join("");
    if (focused) [...mapList.children].find(button => button.dataset.mapId === focused)?.focus({ preventScroll: true });
    element("graph-map-count").textContent = `${maps.length} / ${MAX_MAPS}`;
    element("graph-add-map").disabled = maps.length >= MAX_MAPS;
    element("graph-remove-map").disabled = maps.length <= 1;
  }

  function switchMap(id) {
    if (activeMapId === id) return;
    reset();
    activeMapId = id;
  }

  function selectMap(id) {
    if (!getMaps().some(map => map.id === id)) return;
    switchMap(id);
    render();
    [...mapList.children].find(button => button.dataset.mapId === id)?.focus({ preventScroll: true });
  }

  function openMapDialog(rename = false) {
    if (!rename && getMaps().length >= MAX_MAPS) return;
    const map = getGraph();
    mapDraft = rename ? map.id : null;
    mapForm.elements.namedItem("title").value = rename ? map.title : "";
    element("graph-map-title").textContent = rename ? "Переименовать карту" : "Новая карта";
    element("graph-map-submit").textContent = rename ? "Сохранить название" : "Создать карту";
    setNotice("graph-map-error");
    mapDialog.showModal();
  }

  async function saveMap(event) {
    event.preventDefault();
    if (saving) return;
    setNotice("graph-map-error");
    const field = mapForm.elements.namedItem("title");
    const title = field.value;
    const previousId = mapDraft;
    const generation = viewGeneration;
    let nextId = previousId;
    saving = true;
    const submit = element("graph-map-submit");
    submit.disabled = true;
    try {
      await updateMaps(maps => {
        if (!previousId) {
          nextId = createMap(maps, title).id;
          return;
        }
        const map = maps.find(item => item.id === previousId);
        if (!map) throw new Error("Эта карта уже удалена.");
        map.title = mapTitle(title);
      });
      if (generation !== viewGeneration) return;
      mapDialog.close();
      selectMap(nextId);
      notify(previousId ? "Название карты сохранено" : "Карта создана");
    } catch (error) {
      if (generation === viewGeneration) setNotice("graph-map-error", error.message);
    } finally {
      saving = false;
      submit.disabled = false;
    }
  }

  async function removeMap() {
    if (getMaps().length <= 1) return;
    const map = getGraph();
    const generation = viewGeneration;
    if (!await confirmRemoval(`Удалить карту «${map.title}»?`, "Узлы и связи этой карты будут удалены из браузера.") || generation !== viewGeneration) return;
    await updateMaps(maps => {
      const index = maps.findIndex(item => item.id === map.id);
      if (index < 0) throw new Error("Эта карта уже удалена.");
      if (maps.length <= 1) throw new Error("В рабочем пространстве должна остаться одна карта.");
      maps.splice(index, 1);
    });
    if (generation !== viewGeneration) return;
    selectMap(getGraph().id);
    notify("Карта удалена");
  }

  function getNode(id) {
    return getGraph().nodes.find(node => node.id === id);
  }

  function updateNodeLabel() {
    const details = GRAPH_TYPES[nodeType.value];
    element("graph-value-label").textContent = details.valueLabel;
    nodeForm.elements.namedItem("value").inputMode = details.inputMode ?? "text";
    updatePlatformOption();
  }

  function updatePlatformOption() {
    const type = nodeType.value;
    nodePlatformSelect.disabled = !supportsPlatform(type);
    element("graph-platform-field").hidden = nodePlatformSelect.disabled;
    const value = nodeForm.elements.namedItem("value").value;
    const source = nodeForm.elements.namedItem("source").value;
    const platform = nodePlatform({ type, value, source });
    nodePlatformSelect.options[0].textContent = platform ? `Авто · ${PLATFORMS[platform].label}` : "Определить по ссылке";
  }

  function nodeLabel(node, platform = nodePlatform(node)) {
    return PLATFORMS[platform]?.label ?? GRAPH_TYPES[node.type]?.label ?? GRAPH_TYPES.note.label;
  }

  function nodeIcon(node, platform = nodePlatform(node)) {
    const type = Object.hasOwn(GRAPH_TYPES, node.type) ? node.type : "note";
    const id = platform || `type-${type}`;
    return `<span class="graph-node-icon" data-platform="${platform}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><use href="./assets/graph-icons.svg#${id}"></use></svg></span>`;
  }

  function moveButton(button, point) {
    button.style.left = `${point.x}px`;
    button.style.top = `${point.y}px`;
  }

  function renderNodes() {
    const focused = document.activeElement?.dataset.graphNode;
    nodeButtons = new Map(getGraph().nodes.map(node => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "graph-node";
      button.dataset.graphNode = node.id;
      button.dataset.type = node.type;
      button.setAttribute("aria-pressed", String(node.id === selectedId));
      moveButton(button, node);
      const platform = nodePlatform(node);
      const content = document.createElement("span");
      content.className = "graph-node-content";
      const type = document.createElement("span");
      type.className = "graph-node-type";
      type.textContent = nodeLabel(node, platform);
      const value = document.createElement("span");
      value.className = "graph-node-value";
      value.textContent = node.value;
      content.append(type, value);
      button.innerHTML = nodeIcon(node, platform);
      button.append(content);
      button.title = node.value;
      return [node.id, button];
    }));
    world.replaceChildren(...nodeButtons.values());
    nodeButtons.get(focused)?.focus({ preventScroll: true });
  }

  function renderInspector() {
    const inspector = element("graph-inspector");
    const node = getNode(selectedId);
    if (!node) {
      inspector.innerHTML = "<h2>Узел</h2><p class='graph-context'>Выберите узел, чтобы посмотреть его связи и добавить новые.</p>";
      return;
    }
    const graph = getGraph();
    const related = graph.edges.filter(edge => edge.from === node.id || edge.to === node.id);
    const source = safeUrl(node.source);
    const valueUrl = supportsPlatform(node.type) ? safeUrl(node.value) || platformLink(node.value)?.href : "";
    const canLink = graph.nodes.some(other => other.id !== node.id && !hasGraphEdge(graph, node.id, other.id));
    inspector.innerHTML = `
      <div class="graph-inspector-type">${nodeIcon(node)}<span class="chip">${nodeLabel(node)}</span></div>
      <h2>${escapeHtml(node.value)}</h2>
      ${node.notes ? `<p class="graph-node-notes">${escapeHtml(node.notes)}</p>` : ""}
      ${valueUrl ? `<a class="text-link graph-source" href="${escapeHtml(valueUrl)}" target="_blank" rel="noopener noreferrer">Открыть ссылку</a>` : ""}
      ${source ? `<a class="text-link graph-source" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Открыть источник</a>` : ""}
      <div class="graph-node-actions">
        <button class="button primary small" type="button" data-graph-action="new-related">+ Связанный узел</button>
        <button class="button secondary small" type="button" data-graph-action="link-existing" ${canLink ? "" : "disabled"}>Связать с узлом</button>
        <button class="button secondary small" type="button" data-graph-action="edit-node">Править узел</button>
        <button class="button quiet small" type="button" data-graph-action="delete-node">Удалить узел</button>
      </div>
      <h3>Связи</h3>
      ${related.length ? `<ul class="graph-relations">${related.map(edge => {
        const outgoing = edge.from === node.id;
        const other = getNode(outgoing ? edge.to : edge.from);
        return `<li>
          <button class="graph-relation-target" type="button" data-graph-action="select-node" data-id="${escapeHtml(other.id)}">
            <span class="graph-direction" aria-hidden="true">${outgoing ? "→" : "←"}</span>
            <span><strong>${escapeHtml(other.value)}</strong><small>${escapeHtml(edge.label || nodeLabel(other))}</small></span>
          </button>
          <button class="button secondary small" type="button" data-graph-action="edit-edge" data-id="${escapeHtml(edge.id)}" aria-label="Править связь с ${escapeHtml(other.value)}">Править</button>
        </li>`;
      }).join("")}</ul>` : "<p class='graph-context'>Связей пока нет.</p>"}
    `;
  }

  function selectNode(id, reveal = false) {
    const node = getNode(id);
    selectedId = node?.id ?? null;
    for (const [key, button] of nodeButtons) button.setAttribute("aria-pressed", String(key === selectedId));
    renderInspector();
    if (node && reveal && !inViewport(node)) {
      camera.x = viewport.clientWidth / 2 - node.x * camera.scale;
      camera.y = viewport.clientHeight / 2 - node.y * camera.scale;
    }
    schedulePaint();
  }

  function screenPoint(node) {
    const point = drag?.node?.id === node.id && drag.position ? drag.position : node;
    return { x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale };
  }

  function inViewport(node) {
    const { x, y } = screenPoint(node);
    const button = nodeButtons.get(node.id);
    const halfWidth = button.offsetWidth * camera.scale / 2;
    const halfHeight = button.offsetHeight * camera.scale / 2;
    return x >= halfWidth && x <= viewport.clientWidth - halfWidth && y >= halfHeight && y <= viewport.clientHeight - halfHeight;
  }

  function drawEdge(edge, nodes, halfWidth, halfHeight) {
    const from = screenPoint(nodes.get(edge.from));
    const to = screenPoint(nodes.get(edge.to));
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    const inset = Math.min(halfWidth / Math.abs(dx), halfHeight / Math.abs(dy));
    if (inset >= .48) return;
    const start = { x: from.x + dx * inset, y: from.y + dy * inset };
    const end = { x: to.x - dx * inset, y: to.y - dy * inset };
    const angle = Math.atan2(dy, dx);
    const selected = edge.from === selectedId || edge.to === selectedId;
    context.strokeStyle = selected ? "#dbc5ff" : "#8e7aab";
    context.lineWidth = selected ? 1.7 : 1.3;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.moveTo(end.x - 9 * Math.cos(angle - .48), end.y - 9 * Math.sin(angle - .48));
    context.lineTo(end.x, end.y);
    context.lineTo(end.x - 9 * Math.cos(angle + .48), end.y - 9 * Math.sin(angle + .48));
    context.stroke();
    const labelSpace = Math.min(192, distance * (1 - 2 * inset) - 8);
    if (!edge.label || labelSpace < 28) return;
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    let label = edge.label;
    const characters = Array.from(label);
    while (context.measureText(label).width + 14 > labelSpace && characters.length > 1) {
      characters.pop();
      label = characters.join("") + "…";
    }
    const width = context.measureText(label).width + 14;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const x = (start.x + end.x) / 2 + (horizontal ? 0 : width / 2 + 8);
    const y = (start.y + end.y) / 2 - (horizontal ? 13 : 0);
    context.fillStyle = "#0b0811";
    context.fillRect(x - width / 2, y - 10, width, 20);
    context.fillStyle = "#d3cadf";
    context.fillText(label, x, y);
  }

  function paint() {
    paintFrame = 0;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    element("graph-scale").textContent = `${Math.round(camera.scale * 100)}%`;
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const graph = getGraph();
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const sample = nodeButtons.values().next().value;
    if (!sample) return;
    const halfWidth = sample.offsetWidth * camera.scale / 2;
    const halfHeight = sample.offsetHeight * camera.scale / 2;
    for (const edge of graph.edges) {
      if (nodes.has(edge.from) && nodes.has(edge.to)) drawEdge(edge, nodes, halfWidth, halfHeight);
    }
  }

  function schedulePaint() {
    if (!paintFrame) paintFrame = requestAnimationFrame(paint);
  }

  function fit(nodes = getGraph().nodes) {
    const sample = nodeButtons.values().next().value;
    if (!nodes.length || !sample || !viewport.clientWidth) return;
    const x = nodes.map(node => node.x);
    const y = nodes.map(node => node.y);
    const left = Math.min(...x) - sample.offsetWidth / 2;
    const right = Math.max(...x) + sample.offsetWidth / 2;
    const top = Math.min(...y) - sample.offsetHeight / 2;
    const bottom = Math.max(...y) + sample.offsetHeight / 2;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    camera.scale = Math.min(1, Math.max(width - 48, 1) / (right - left), Math.max(height - 48, 1) / (bottom - top));
    camera.minScale = Math.min(.2, camera.scale);
    camera.x = width / 2 - (left + right) * camera.scale / 2;
    camera.y = height / 2 - (top + bottom) * camera.scale / 2;
    fitted = true;
    schedulePaint();
  }

  function zoom(factor) {
    if (!getGraph().nodes.length) return;
    const scale = Math.max(camera.minScale, Math.min(MAX_ZOOM, camera.scale * factor));
    const ratio = scale / camera.scale;
    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;
    camera.x = centerX + (camera.x - centerX) * ratio;
    camera.y = centerY + (camera.y - centerY) * ratio;
    camera.scale = scale;
    schedulePaint();
  }

  function render() {
    const graph = getGraph();
    switchMap(graph.id);
    renderMaps();
    if (!getNode(selectedId)) selectedId = null;
    element("graph-count").textContent = `Узлы ${graph.nodes.length} · Связи ${graph.edges.length}`;
    element("graph-empty").hidden = Boolean(graph.nodes.length);
    if (!graph.nodes.length) fitted = false;
    renderNodes();
    renderInspector();
    if (!fitted) fit();
    schedulePaint();
  }

  function nextPosition(graph, parent, center) {
    if (!graph.nodes.length) return { x: 0, y: 0 };
    const x = parent ? parent.x + NODE_GAP_X : center.x;
    let y = parent ? parent.y : center.y;
    while (graph.nodes.some(node => Math.abs(node.x - x) < 202 && Math.abs(node.y - y) < 87)) y += NODE_GAP_Y;
    return { x, y };
  }

  function openNodeDialog({ node, parent } = {}) {
    nodeDraft = { id: node?.id, parentId: parent?.id };
    nodeForm.reset();
    element("graph-node-title").textContent = node ? "Править узел" : parent ? "Связанный узел" : "Новый узел";
    const summary = element("graph-node-context");
    summary.textContent = parent ? `Связь с узлом «${parent.value}»` : "";
    summary.hidden = !parent;
    element("graph-node-relation").hidden = !parent;
    nodeType.value = node?.type ?? (parent?.type === "person" ? "phone" : parent ? "note" : "person");
    for (const field of ["value", "notes", "source", "platform"]) {
      nodeForm.elements.namedItem(field).value = node?.[field] ?? "";
    }
    updateNodeLabel();
    setNotice("graph-node-error");
    nodeDialog.showModal();
  }

  async function saveNode(event) {
    event.preventDefault();
    if (saving) return;
    setNotice("graph-node-error");
    const fields = Object.fromEntries(new FormData(nodeForm));
    const draft = nodeDraft;
    const generation = viewGeneration;
    const center = { x: (viewport.clientWidth / 2 - camera.x) / camera.scale, y: (viewport.clientHeight / 2 - camera.y) / camera.scale };
    let saved;
    let parent;
    const submit = event.submitter ?? nodeForm.querySelector("[type=submit]");
    saving = submit.disabled = true;
    try {
      await save(graph => {
        const index = graph.nodes.findIndex(node => node.id === draft.id);
        parent = graph.nodes.find(node => node.id === draft.parentId);
        if (draft.id && index < 0) throw new Error("Этот узел уже удалён.");
        if (draft.parentId && !parent) throw new Error("Исходный узел уже удалён.");
        const position = graph.nodes[index] ?? nextPosition(graph, parent, center);
        saved = normalizeGraphNode({ ...fields, id: draft.id, x: position.x, y: position.y });
        if (index < 0) graph.nodes.push(saved);
        else graph.nodes[index] = saved;
        if (parent) addGraphEdge(graph, { from: parent.id, to: saved.id, label: fields.relation });
      });
      if (generation !== viewGeneration) return;
      selectedId = saved.id;
      nodeDialog.close();
      render();
      if (!inViewport(saved) || (parent && !inViewport(parent))) fit(parent ? [parent, saved] : [saved]);
      nodeButtons.get(saved.id)?.focus({ preventScroll: true });
      notify(parent ? "Узел и связь добавлены" : "Узел сохранён");
    } catch (error) {
      if (generation === viewGeneration) setNotice("graph-node-error", error.message);
    } finally {
      saving = submit.disabled = false;
    }
  }

  function openEdgeDialog(edge) {
    const graph = getGraph();
    const from = getNode(edge?.from ?? selectedId);
    if (!from) return;
    edgeDraft = { from: from.id, id: edge?.id };
    edgeForm.reset();
    element("graph-edge-title").textContent = edge ? "Править связь" : "Связать узлы";
    element("graph-edge-context").textContent = edge ? `${from.value} → ${getNode(edge.to).value}` : `Связь от узла «${from.value}»`;
    element("graph-edge-target").hidden = Boolean(edge);
    element("graph-delete-edge").hidden = !edge;
    edgeTarget.disabled = Boolean(edge);
    const targets = edge ? [] : graph.nodes.filter(node => node.id !== from.id && !hasGraphEdge(graph, from.id, node.id));
    edgeTarget.replaceChildren(new Option("Выберите узел", ""), ...targets.map(node => new Option(node.value, node.id)));
    edgeForm.elements.namedItem("label").value = edge?.label ?? "";
    setNotice("graph-edge-error");
    edgeDialog.showModal();
  }

  async function saveEdge(event) {
    event.preventDefault();
    if (saving) return;
    setNotice("graph-edge-error");
    const fields = Object.fromEntries(new FormData(edgeForm));
    const draft = edgeDraft;
    const generation = viewGeneration;
    const submit = event.submitter ?? edgeForm.querySelector("[type=submit]");
    saving = submit.disabled = true;
    try {
      await save(graph => {
        if (draft.id) {
          const edge = graph.edges.find(item => item.id === draft.id);
          if (!edge) throw new Error("Эта связь уже удалена.");
          edge.label = fields.label.trim();
        } else {
          addGraphEdge(graph, { from: draft.from, to: fields.target, label: fields.label });
        }
      });
      if (generation !== viewGeneration) return;
      edgeDialog.close();
      render();
      notify("Связь сохранена");
    } catch (error) {
      if (generation === viewGeneration) setNotice("graph-edge-error", error.message);
    } finally {
      saving = submit.disabled = false;
    }
  }

  async function deleteNode() {
    const node = getNode(selectedId);
    const generation = viewGeneration;
    if (!node || !await confirmRemoval("Удалить узел?", "Узел и все его связи будут удалены с карты.") || generation !== viewGeneration) return;
    await save(graph => {
      graph.nodes = graph.nodes.filter(item => item.id !== node.id);
      graph.edges = graph.edges.filter(edge => edge.from !== node.id && edge.to !== node.id);
    });
    if (generation !== viewGeneration) return;
    render();
    notify("Узел удалён");
  }

  async function deleteEdge() {
    const id = edgeDraft.id;
    const generation = viewGeneration;
    if (!id || !await confirmRemoval("Удалить связь?", "Связь будет удалена с карты.") || generation !== viewGeneration) return;
    await save(graph => { graph.edges = graph.edges.filter(edge => edge.id !== id); });
    if (generation !== viewGeneration) return;
    edgeDialog.close();
    render();
    notify("Связь удалена");
  }

  function savePosition(id, position, relative = false) {
    return save(graph => {
      const node = graph.nodes.find(item => item.id === id);
      if (node) {
        node.x = relative ? node.x + position.x : position.x;
        node.y = relative ? node.y + position.y : position.y;
      }
    });
  }

  viewport.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || !getGraph().nodes.length) return;
    const button = event.target.closest("[data-graph-node]");
    const node = getNode(button?.dataset.graphNode);
    drag = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: camera.x, y: camera.y, node };
    if (node) {
      button.focus({ preventScroll: true });
      selectNode(node.id);
    }
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", event => {
    if (drag?.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.node) {
      drag.position = { x: drag.node.x + dx / camera.scale, y: drag.node.y + dy / camera.scale };
      const button = nodeButtons.get(drag.node.id);
      if (button) moveButton(button, drag.position);
    } else {
      camera.x = drag.x + dx;
      camera.y = drag.y + dy;
    }
    schedulePaint();
  });

  async function endDrag(event) {
    if (drag?.pointer !== event.pointerId) return;
    const finished = drag;
    drag = null;
    viewport.classList.remove("dragging");
    if (!finished.position) return;
    const generation = viewGeneration;
    try {
      if (event.type === "pointerup") await savePosition(finished.node.id, finished.position);
    } catch (error) {
      if (generation === viewGeneration) notify(error.message);
    }
    if (generation === viewGeneration) render();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(type, endDrag);
  world.addEventListener("click", event => {
    const button = event.target.closest("[data-graph-node]");
    if (button && event.detail === 0) selectNode(button.dataset.graphNode, true);
  });
  world.addEventListener("keydown", async event => {
    if (!Object.hasOwn(KEY_MOVES, event.key)) return;
    const node = getNode(event.target.dataset.graphNode);
    if (!node) return;
    event.preventDefault();
    const [x, y] = KEY_MOVES[event.key];
    const generation = viewGeneration;
    try {
      await savePosition(node.id, { x, y }, true);
      if (generation !== viewGeneration) return;
      selectedId = node.id;
      render();
      selectNode(node.id, true);
    } catch (error) {
      if (generation === viewGeneration) notify(error.message);
    }
  });

  const actions = {
    "select-map": button => selectMap(button.dataset.mapId),
    "add-map": () => openMapDialog(),
    "rename-map": () => openMapDialog(true),
    "remove-map": removeMap,
    "new-node": () => openNodeDialog(),
    "new-related": () => openNodeDialog({ parent: getNode(selectedId) }),
    "edit-node": () => openNodeDialog({ node: getNode(selectedId) }),
    "delete-node": deleteNode,
    "link-existing": () => openEdgeDialog(),
    "edit-edge": button => {
      const edge = getGraph().edges.find(item => item.id === button.dataset.id);
      if (edge) openEdgeDialog(edge);
    },
    "delete-edge": deleteEdge,
    "select-node": button => {
      selectNode(button.dataset.id, true);
      nodeButtons.get(selectedId)?.focus({ preventScroll: true });
    },
    "zoom-in": () => zoom(1.25),
    "zoom-out": () => zoom(.8),
    fit: () => fit(),
  };
  document.addEventListener("click", async event => {
    const button = event.target.closest("button[data-graph-action]");
    if (!button) return;
    try {
      await actions[button.dataset.graphAction](button);
    } catch (error) {
      notify(error.message);
    }
  });
  nodeType.addEventListener("change", updateNodeLabel);
  for (const name of ["value", "source"]) nodeForm.elements.namedItem(name).addEventListener("input", updatePlatformOption);
  mapForm.addEventListener("submit", saveMap);
  nodeForm.addEventListener("submit", saveNode);
  edgeForm.addEventListener("submit", saveEdge);
  new ResizeObserver(() => {
    if (!fitted) fit();
    schedulePaint();
  }).observe(viewport);
  function reset() {
    viewGeneration++;
    activeMapId = null;
    mapDraft = null;
    selectedId = null;
    fitted = false;
    const pointer = drag?.pointer;
    drag = null;
    if (pointer !== undefined && viewport.hasPointerCapture(pointer)) viewport.releasePointerCapture(pointer);
    nodeDraft = {};
    edgeDraft = {};
    for (const dialog of [mapDialog, nodeDialog, edgeDialog]) if (dialog.open) dialog.close();
    mapForm.reset();
    nodeForm.reset();
    edgeForm.reset();
    edgeTarget.replaceChildren();
    element("graph-node-context").textContent = "";
    element("graph-edge-context").textContent = "";
    viewport.classList.remove("dragging");
    Object.assign(camera, { x: 0, y: 0, scale: 1, minScale: 0.2 });
  }
  return { render, reset };
}
