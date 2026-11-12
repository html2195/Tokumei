import { addGraphEdge, GRAPH_TYPES, hasGraphEdge, normalizeGraphNode, safeUrl } from "./storage.js?v=accounts-1";

const NODE_GAP_X = 310;
const NODE_GAP_Y = 102;
const MAX_ZOOM = 1.8;
const KEY_MOVES = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };

export function createGraphView({ getGraph, save, escapeHtml, setNotice, notify, confirmRemoval }) {
  const element = id => document.getElementById(id);
  const viewport = element("graph-viewport");
  const world = element("graph-world");
  const canvas = element("graph-edges");
  const context = canvas.getContext("2d");
  const nodeDialog = element("graph-node-dialog");
  const nodeForm = element("graph-node-form");
  const nodeType = element("graph-node-type");
  const edgeDialog = element("graph-edge-dialog");
  const edgeForm = element("graph-edge-form");
  const edgeTarget = edgeForm.elements.namedItem("target");
  const camera = { x: 0, y: 0, scale: 1, minScale: 0.2 };
  let nodeButtons = new Map();
  let selectedId = null;
  let nodeDraft = {};
  let edgeDraft = {};
  let fitted = false;
  let drag = null;
  let paintFrame = 0;

  nodeType.replaceChildren(...Object.entries(GRAPH_TYPES).map(([type, details]) => new Option(details.label, type)));

  function getNode(id) {
    return getGraph().nodes.find(node => node.id === id);
  }

  function updateNodeLabel() {
    const details = GRAPH_TYPES[nodeType.value];
    element("graph-value-label").textContent = details.valueLabel;
    nodeForm.elements.namedItem("value").inputMode = details.inputMode ?? "text";
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
      const type = document.createElement("span");
      type.className = "graph-node-type";
      type.textContent = GRAPH_TYPES[node.type].label;
      const value = document.createElement("span");
      value.className = "graph-node-value";
      value.textContent = node.value;
      button.append(type, value);
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
    const valueUrl = ["link", "account"].includes(node.type) ? safeUrl(node.value) : "";
    const canLink = graph.nodes.some(other => other.id !== node.id && !hasGraphEdge(graph, node.id, other.id));
    inspector.innerHTML = `
      <span class="chip">${GRAPH_TYPES[node.type].label}</span>
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
            <span><strong>${escapeHtml(other.value)}</strong><small>${escapeHtml(edge.label || GRAPH_TYPES[other.type].label)}</small></span>
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
    context.strokeStyle = selected ? "#baff65" : "#718d6f";
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
    context.fillStyle = "#0b110d";
    context.fillRect(x - width / 2, y - 10, width, 20);
    context.fillStyle = "#d3e2d2";
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
    if (!getNode(selectedId)) selectedId = null;
    element("graph-count").textContent = `Узлы ${graph.nodes.length} · Связи ${graph.edges.length}`;
    element("graph-empty").hidden = Boolean(graph.nodes.length);
    if (!graph.nodes.length) fitted = false;
    renderNodes();
    renderInspector();
    if (!fitted) fit();
    schedulePaint();
  }

  function nextPosition(graph, parent) {
    if (!graph.nodes.length) return { x: 0, y: 0 };
    const x = parent ? parent.x + NODE_GAP_X : (viewport.clientWidth / 2 - camera.x) / camera.scale;
    let y = parent ? parent.y : (viewport.clientHeight / 2 - camera.y) / camera.scale;
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
    for (const field of ["value", "notes", "source"]) {
      nodeForm.elements.namedItem(field).value = node?.[field] ?? "";
    }
    updateNodeLabel();
    setNotice("graph-node-error");
    nodeDialog.showModal();
  }

  function saveNode(event) {
    event.preventDefault();
    setNotice("graph-node-error");
    const fields = Object.fromEntries(new FormData(nodeForm));
    let saved;
    let parent;
    try {
      save(graph => {
        const index = graph.nodes.findIndex(node => node.id === nodeDraft.id);
        parent = graph.nodes.find(node => node.id === nodeDraft.parentId);
        if (nodeDraft.id && index < 0) throw new Error("Этот узел уже удалён.");
        if (nodeDraft.parentId && !parent) throw new Error("Исходный узел уже удалён.");
        const position = graph.nodes[index] ?? nextPosition(graph, parent);
        saved = normalizeGraphNode({ ...fields, id: nodeDraft.id, x: position.x, y: position.y });
        if (index < 0) graph.nodes.push(saved);
        else graph.nodes[index] = saved;
        if (parent) addGraphEdge(graph, { from: parent.id, to: saved.id, label: fields.relation });
      });
      selectedId = saved.id;
      nodeDialog.close();
      render();
      if (!inViewport(saved) || (parent && !inViewport(parent))) fit(parent ? [parent, saved] : [saved]);
      nodeButtons.get(saved.id)?.focus({ preventScroll: true });
      notify(parent ? "Узел и связь добавлены" : "Узел сохранён");
    } catch (error) {
      setNotice("graph-node-error", error.message);
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

  function saveEdge(event) {
    event.preventDefault();
    setNotice("graph-edge-error");
    const fields = Object.fromEntries(new FormData(edgeForm));
    try {
      save(graph => {
        if (edgeDraft.id) {
          const edge = graph.edges.find(item => item.id === edgeDraft.id);
          if (!edge) throw new Error("Эта связь уже удалена.");
          edge.label = fields.label.trim();
        } else {
          addGraphEdge(graph, { from: edgeDraft.from, to: fields.target, label: fields.label });
        }
      });
      edgeDialog.close();
      render();
      notify("Связь сохранена");
    } catch (error) {
      setNotice("graph-edge-error", error.message);
    }
  }

  async function deleteNode() {
    const node = getNode(selectedId);
    if (!node || !await confirmRemoval("Удалить узел?", "Узел и все его связи будут удалены с карты.")) return;
    save(graph => {
      graph.nodes = graph.nodes.filter(item => item.id !== node.id);
      graph.edges = graph.edges.filter(edge => edge.from !== node.id && edge.to !== node.id);
    });
    render();
    notify("Узел удалён");
  }

  async function deleteEdge() {
    const id = edgeDraft.id;
    if (!id || !await confirmRemoval("Удалить связь?", "Связь будет удалена с карты.")) return;
    save(graph => { graph.edges = graph.edges.filter(edge => edge.id !== id); });
    edgeDialog.close();
    render();
    notify("Связь удалена");
  }

  function savePosition(id, position) {
    save(graph => {
      const node = graph.nodes.find(item => item.id === id);
      if (node) Object.assign(node, position);
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

  function endDrag(event) {
    if (drag?.pointer !== event.pointerId) return;
    const finished = drag;
    drag = null;
    viewport.classList.remove("dragging");
    if (!finished.position) return;
    try {
      if (event.type === "pointerup") savePosition(finished.node.id, finished.position);
    } catch (error) {
      notify(error.message);
    }
    render();
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(type, endDrag);
  world.addEventListener("click", event => {
    const button = event.target.closest("[data-graph-node]");
    if (button && event.detail === 0) selectNode(button.dataset.graphNode, true);
  });
  world.addEventListener("keydown", event => {
    if (!Object.hasOwn(KEY_MOVES, event.key)) return;
    const node = getNode(event.target.dataset.graphNode);
    if (!node) return;
    event.preventDefault();
    const [x, y] = KEY_MOVES[event.key];
    try {
      savePosition(node.id, { x: node.x + x, y: node.y + y });
      selectedId = node.id;
      render();
      selectNode(node.id, true);
    } catch (error) {
      notify(error.message);
    }
  });

  const actions = {
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
  nodeForm.addEventListener("submit", saveNode);
  edgeForm.addEventListener("submit", saveEdge);
  new ResizeObserver(() => {
    if (!fitted) fit();
    schedulePaint();
  }).observe(viewport);
  function reset() {
    selectedId = null;
    fitted = false;
    drag = null;
    nodeDraft = {};
    edgeDraft = {};
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
