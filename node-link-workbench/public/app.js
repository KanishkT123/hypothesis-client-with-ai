const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);
const TAG_NODE_RADIUS = 34;
const QUOTE_WIDTH = 250;
const QUOTE_HEIGHT = 86;

const els = {
  sessionLabel: document.querySelector('#sessionLabel'),
  groupSelect: document.querySelector('#groupSelect'),
  refreshBtn: document.querySelector('#refreshBtn'),
  newEdgeBtn: document.querySelector('#newEdgeBtn'),
  loginBtn: document.querySelector('#loginBtn'),
  graphTitle: document.querySelector('#graphTitle'),
  graphStats: document.querySelector('#graphStats'),
  saveState: document.querySelector('#saveState'),
  notice: document.querySelector('#notice'),
  canvasScroll: document.querySelector('#canvasScroll'),
  svg: document.querySelector('#graphSvg'),
  edgeEditor: document.querySelector('#edgeEditor'),
  cancelEdgeBtn: document.querySelector('#cancelEdgeBtn'),
  edgeSource: document.querySelector('#edgeSource'),
  edgeTarget: document.querySelector('#edgeTarget'),
  edgeLabel: document.querySelector('#edgeLabel'),
  saveEdgeBtn: document.querySelector('#saveEdgeBtn'),
  selectionPanel: document.querySelector('#selectionPanel'),
  edgeList: document.querySelector('#edgeList'),
};

const state = {
  session: null,
  groups: [],
  snapshot: null,
  edits: null,
  graph: null,
  selectedNodeId: null,
  dragging: null,
  saveTimer: null,
};

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function showNotice(message) {
  if (!message) {
    els.notice.hidden = true;
    els.notice.textContent = '';
    return;
  }
  els.notice.hidden = false;
  els.notice.textContent = message;
}

function setSaveState(message) {
  els.saveState.textContent = message;
}

function shortText(text, max = 120) {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function wrapLines(text, maxChars, maxLines) {
  const words = shortText(text, maxChars * maxLines).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) {
      break;
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
  }
  return lines;
}

function contentTags(tags = []) {
  const seen = new Set();
  const result = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || SYSTEM_TAGS.has(tag) || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

function hashColor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 52% 36%)`;
}

function nodePosition(id, fallbackX, fallbackY) {
  const saved = state.edits?.layout?.nodes?.[id];
  return {
    x: Number.isFinite(saved?.x) ? saved.x : fallbackX,
    y: Number.isFinite(saved?.y) ? saved.y : fallbackY,
  };
}

function buildGraph() {
  const snapshot = state.snapshot || { annotations: [] };
  const tagMap = new Map();
  const quoteNodes = [];
  const autoEdges = [];

  const annotations = (snapshot.annotations || []).filter(
    ann => !ann.hidden && !ann.isReply,
  );

  for (const ann of annotations) {
    const tags = contentTags(ann.tags);
    for (const tag of tags) {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, { id: `tag:${tag}`, type: 'tag', tag, count: 0 });
      }
      tagMap.get(tag).count += 1;
    }

    if (!ann.quote) {
      continue;
    }

    const quoteNode = {
      id: `quote:${ann.id}`,
      type: 'quote',
      annotation: ann,
      tags,
    };
    quoteNodes.push(quoteNode);

    for (const tag of tags) {
      autoEdges.push({
        id: `auto:${tag}:${ann.id}`,
        type: 'auto',
        source: `tag:${tag}`,
        target: quoteNode.id,
      });
    }
  }

  const tagNodes = [...tagMap.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag),
  );
  quoteNodes.sort((a, b) => {
    const tagA = a.tags[0] || '';
    const tagB = b.tags[0] || '';
    return (
      tagA.localeCompare(tagB) ||
      a.annotation.created.localeCompare(b.annotation.created)
    );
  });

  const tagColumnHeight = Math.max(680, tagNodes.length * 92 + 120);
  const quoteRows = Math.ceil(quoteNodes.length / 2);
  const quoteColumnHeight = Math.max(680, quoteRows * 118 + 120);
  const height = Math.max(tagColumnHeight, quoteColumnHeight);
  const width = quoteNodes.length > 8 ? 1180 : 980;

  tagNodes.forEach((node, index) => {
    const pos = nodePosition(node.id, 120, 86 + index * 92);
    Object.assign(node, pos, { color: hashColor(node.tag) });
  });

  quoteNodes.forEach((node, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const pos = nodePosition(node.id, 430 + col * 300, 64 + row * 118);
    Object.assign(node, pos);
  });

  const visibleTags = new Set(tagNodes.map(node => node.tag));
  const humanEdges = (state.edits?.tagEdges || [])
    .filter(
      edge =>
        visibleTags.has(edge.sourceTag) && visibleTags.has(edge.targetTag),
    )
    .map(edge => ({
      ...edge,
      type: 'human',
      source: `tag:${edge.sourceTag}`,
      target: `tag:${edge.targetTag}`,
    }));

  const nodes = [...tagNodes, ...quoteNodes];
  const nodeById = new Map(nodes.map(node => [node.id, node]));

  state.graph = {
    width,
    height,
    nodes,
    tagNodes,
    quoteNodes,
    autoEdges,
    humanEdges,
    nodeById,
    visibleTags,
  };
}

function edgePath(source, target) {
  const startX =
    source.type === 'quote'
      ? source.x - QUOTE_WIDTH / 2
      : source.x + TAG_NODE_RADIUS;
  const endX =
    target.type === 'quote'
      ? target.x - QUOTE_WIDTH / 2
      : target.x - TAG_NODE_RADIUS;
  const startY = source.y;
  const endY = target.y;
  const dx = Math.max(80, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
}

function renderEdges(group) {
  for (const edge of state.graph.autoEdges) {
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    group.append(
      svgEl('path', {
        class: 'edge-auto',
        d: edgePath(source, target),
      }),
    );
  }

  for (const edge of state.graph.humanEdges) {
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const pathId = `path-${edge.id}`;
    const path = svgEl('path', {
      id: pathId,
      class: 'edge-human',
      d: edgePath(source, target),
    });
    group.append(path);

    if (edge.label) {
      const label = svgEl('text', { class: 'edge-label' });
      const textPath = svgEl('textPath', {
        href: `#${pathId}`,
        startOffset: '50%',
        'text-anchor': 'middle',
      });
      textPath.textContent = edge.label;
      label.append(textPath);
      group.append(label);
    }
  }
}

function startDrag(event, node) {
  event.preventDefault();
  event.stopPropagation();
  const point = graphPoint(event);
  state.dragging = {
    id: node.id,
    offsetX: point.x - node.x,
    offsetY: point.y - node.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function graphPoint(event) {
  const rect = els.svg.getBoundingClientRect();
  const viewBox = els.svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function handleDrag(event) {
  if (!state.dragging) {
    return;
  }
  const node = state.graph.nodeById.get(state.dragging.id);
  if (!node) {
    return;
  }
  const point = graphPoint(event);
  node.x = point.x - state.dragging.offsetX;
  node.y = point.y - state.dragging.offsetY;

  state.edits.layout.nodes[node.id] = {
    x: Math.round(node.x),
    y: Math.round(node.y),
  };
  renderGraph();
  scheduleSave();
}

function stopDrag() {
  state.dragging = null;
}

function renderTagNode(group, node) {
  const g = svgEl('g', {
    class: `node tag-node ${node.id === state.selectedNodeId ? 'selected-node' : ''}`,
    transform: `translate(${node.x} ${node.y})`,
  });
  g.append(svgEl('circle', { r: TAG_NODE_RADIUS, fill: node.color }));

  const text = svgEl('text');
  const label = shortText(node.tag, 18);
  text.textContent = label;
  g.append(text);

  g.addEventListener('pointerdown', event => startDrag(event, node));
  g.addEventListener('click', () => selectNode(node.id));
  group.append(g);
}

function renderQuoteNode(group, node) {
  const x = node.x - QUOTE_WIDTH / 2;
  const y = node.y - QUOTE_HEIGHT / 2;
  const g = svgEl('g', {
    class: `node quote-node ${node.id === state.selectedNodeId ? 'selected-node' : ''}`,
    transform: `translate(${x} ${y})`,
  });
  g.append(
    svgEl('rect', {
      width: QUOTE_WIDTH,
      height: QUOTE_HEIGHT,
      rx: 8,
      ry: 8,
    }),
  );

  const title = svgEl('text', {
    class: 'quote-title',
    x: 12,
    y: 18,
  });
  title.textContent = shortText(
    node.annotation.documentTitle || node.annotation.uri,
    34,
  );
  g.append(title);

  const lines = wrapLines(node.annotation.quote, 34, 3);
  lines.forEach((line, index) => {
    const text = svgEl('text', {
      x: 12,
      y: 40 + index * 15,
    });
    text.textContent = line;
    g.append(text);
  });

  g.addEventListener('pointerdown', event => startDrag(event, node));
  g.addEventListener('click', () => selectNode(node.id));
  group.append(g);
}

function renderGraph() {
  if (!state.graph) {
    buildGraph();
  }

  els.svg.replaceChildren();
  els.svg.setAttribute('width', state.graph.width);
  els.svg.setAttribute('height', state.graph.height);
  els.svg.setAttribute(
    'viewBox',
    `0 0 ${state.graph.width} ${state.graph.height}`,
  );

  const edges = svgEl('g', { class: 'edges' });
  const nodes = svgEl('g', { class: 'nodes' });
  renderEdges(edges);
  for (const node of state.graph.nodes) {
    if (node.type === 'tag') {
      renderTagNode(nodes, node);
    } else {
      renderQuoteNode(nodes, node);
    }
  }
  els.svg.append(edges, nodes);
  renderSelection();
  renderEdgeList();
}

function selectNode(id) {
  state.selectedNodeId = id;
  renderGraph();
}

function renderSelection() {
  const node = state.selectedNodeId
    ? state.graph?.nodeById.get(state.selectedNodeId)
    : null;
  if (!node) {
    els.selectionPanel.className = 'empty-panel';
    els.selectionPanel.textContent = 'Select a tag or quote node.';
    return;
  }

  els.selectionPanel.className = '';
  if (node.type === 'tag') {
    const relatedQuotes = state.graph.quoteNodes.filter(quote =>
      quote.tags.includes(node.tag),
    );
    els.selectionPanel.innerHTML = `
      <div class="selection-title">${escapeHtml(node.tag)}</div>
      <div class="selection-copy">${relatedQuotes.length} linked quotes</div>
      <div class="tag-chip-row">
        <span class="tag-chip">${node.count} annotations</span>
      </div>
    `;
    return;
  }

  const ann = node.annotation;
  const sourceUrl = ann.links?.incontext || ann.links?.html || ann.uri;
  els.selectionPanel.innerHTML = `
    <div class="selection-title">${escapeHtml(shortText(ann.documentTitle || ann.uri, 70))}</div>
    <div class="selection-copy">${escapeHtml(ann.quote)}</div>
    <div class="tag-chip-row">
      ${node.tags.map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
    </div>
    <div class="meta-list">
      <div class="meta-row"><span>Source</span><span>${escapeHtml(shortText(ann.uri, 54))}</span></div>
      <div class="meta-row"><span>Updated</span><span>${escapeHtml(formatDate(ann.updated))}</span></div>
      <div class="meta-row"><span>Id</span><span>${escapeHtml(ann.id || '')}</span></div>
    </div>
    <button id="openSourceBtn" class="button primary full-width">Open Source</button>
  `;
  document.querySelector('#openSourceBtn')?.addEventListener('click', () => {
    window.open(sourceUrl, '_blank', 'noopener');
  });
}

function renderEdgeList() {
  const edges = state.edits?.tagEdges || [];
  if (!edges.length) {
    els.edgeList.innerHTML =
      '<div class="empty-panel">No human tag edges yet.</div>';
    return;
  }

  els.edgeList.replaceChildren();
  for (const edge of edges) {
    const isVisible =
      state.graph.visibleTags.has(edge.sourceTag) &&
      state.graph.visibleTags.has(edge.targetTag);
    const item = document.createElement('div');
    item.className = `edge-item ${isVisible ? '' : 'hidden-edge'}`;
    item.innerHTML = `
      <div class="edge-tags">
        <span>${escapeHtml(edge.sourceTag)}</span>
        <span>${escapeHtml(edge.targetTag)}</span>
      </div>
      <input type="text" value="${escapeAttr(edge.label || '')}" aria-label="Edge label" />
      <div class="edge-actions">
        <span>${isVisible ? 'Visible' : 'Hidden until both tags exist'}</span>
        <button class="ghost-button danger" type="button">Delete</button>
      </div>
    `;
    const input = item.querySelector('input');
    const deleteButton = item.querySelector('button');
    input.addEventListener('change', () => {
      edge.label = input.value.trim();
      edge.updatedAt = new Date().toISOString();
      saveEditsNow();
      renderGraph();
    });
    deleteButton.addEventListener('click', () => {
      state.edits.tagEdges = state.edits.tagEdges.filter(
        itemEdge => itemEdge.id !== edge.id,
      );
      saveEditsNow();
      renderGraph();
    });
    els.edgeList.append(item);
  }
}

function populateEdgeSelects() {
  const tags = state.graph?.tagNodes.map(node => node.tag) || [];
  for (const select of [els.edgeSource, els.edgeTarget]) {
    select.replaceChildren();
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag;
      option.textContent = tag;
      select.append(option);
    }
  }
}

function openEdgeEditor() {
  populateEdgeSelects();
  els.edgeEditor.hidden = false;
  els.edgeLabel.value = '';
}

function closeEdgeEditor() {
  els.edgeEditor.hidden = true;
}

function saveNewEdge() {
  const sourceTag = els.edgeSource.value;
  const targetTag = els.edgeTarget.value;
  const label = els.edgeLabel.value.trim();
  if (!sourceTag || !targetTag || sourceTag === targetTag) {
    showNotice('Choose two different tags before saving the edge.');
    return;
  }

  showNotice('');
  const now = new Date().toISOString();
  state.edits.tagEdges.push({
    id: `edge:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    sourceTag,
    targetTag,
    label,
    createdAt: now,
    updatedAt: now,
    createdBy: 'human',
  });
  closeEdgeEditor();
  saveEditsNow();
  buildGraph();
  renderGraph();
}

function scheduleSave() {
  setSaveState('Saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveEditsNow, 350);
}

async function saveEditsNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSaveState('Saving');
  try {
    state.edits = await api('/api/edits', {
      method: 'PUT',
      body: state.edits,
    });
    setSaveState('Saved');
  } catch (err) {
    setSaveState('Save failed');
    showNotice(err.message);
  }
}

async function login() {
  showNotice('');
  const popup = window.open(
    'about:blank',
    'Hypothesis Login',
    'width=475,height=630',
  );
  if (!popup) {
    showNotice('The login popup was blocked.');
    return;
  }

  const { authUrl, state: oauthState } = await api('/api/oauth/start');
  const code = await new Promise((resolve, reject) => {
    const closedInterval = setInterval(() => {
      if (popup.closed) {
        clearTimeout(timeout);
        clearInterval(closedInterval);
        window.removeEventListener('message', listener);
        reject(
          new Error('Login window closed before authorization completed.'),
        );
      }
    }, 500);

    const timeout = setTimeout(() => {
      clearInterval(closedInterval);
      window.removeEventListener('message', listener);
      reject(new Error('Login timed out.'));
    }, 180_000);

    function listener(event) {
      if (!event.data || event.data.state !== oauthState) {
        return;
      }
      if (event.data.type === 'authorization_response') {
        clearTimeout(timeout);
        clearInterval(closedInterval);
        window.removeEventListener('message', listener);
        resolve(event.data.code);
      } else if (event.data.type === 'authorization_canceled') {
        clearTimeout(timeout);
        clearInterval(closedInterval);
        window.removeEventListener('message', listener);
        reject(new Error('Login was canceled.'));
      }
    }

    window.addEventListener('message', listener);
    popup.location.href = authUrl;
  });

  state.session = await api('/api/oauth/exchange', {
    method: 'POST',
    body: { code, state: oauthState },
  });
  await loadGroups();
  updateControls();
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  state.session = { authenticated: false, profile: null };
  state.groups = [];
  updateControls();
}

async function loadStatus() {
  state.session = await api('/api/status');
  updateControls();
}

async function loadGroups() {
  if (!state.session?.authenticated) {
    return;
  }
  state.groups = await api('/api/groups');
  updateGroupSelect();
}

async function loadGraph() {
  const { snapshot, edits } = await api('/api/graph');
  state.snapshot = snapshot;
  state.edits = edits;
  updateGroupSelect();
  buildGraph();
  renderGraph();
  updateGraphHeader();
  updateControls();
}

async function refreshSnapshot() {
  const groupId = els.groupSelect.value;
  const group = state.groups.find(item => item.id === groupId);
  if (!groupId) {
    showNotice('Choose a group first.');
    return;
  }

  showNotice('');
  els.refreshBtn.disabled = true;
  els.graphStats.textContent = 'Refreshing annotations...';
  try {
    state.snapshot = await api('/api/refresh', {
      method: 'POST',
      body: { groupId, group },
    });
    const { edits } = await api('/api/graph');
    state.edits = edits;
    buildGraph();
    renderGraph();
    updateGraphHeader();
  } catch (err) {
    showNotice(err.message);
  } finally {
    updateControls();
  }
}

function updateGroupSelect() {
  const current =
    state.edits?.selectedGroupId ||
    state.snapshot?.source?.group?.id ||
    els.groupSelect.value;
  els.groupSelect.replaceChildren();
  if (!state.groups.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = state.session?.authenticated
      ? 'No groups found'
      : 'Log in first';
    els.groupSelect.append(option);
    return;
  }

  for (const group of state.groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.organization
      ? `${group.name} (${group.organization})`
      : group.name;
    els.groupSelect.append(option);
  }
  if (current && state.groups.some(group => group.id === current)) {
    els.groupSelect.value = current;
  }
}

function updateControls() {
  const authenticated = Boolean(state.session?.authenticated);
  els.sessionLabel.textContent = authenticated
    ? `Signed in as ${state.session.profile?.displayName || state.session.profile?.userid}`
    : 'Not signed in';
  els.loginBtn.textContent = authenticated ? 'Log out' : 'Log in';
  els.groupSelect.disabled = !authenticated || !state.groups.length;
  els.refreshBtn.disabled = !authenticated || !els.groupSelect.value;
  els.newEdgeBtn.disabled = !state.graph?.tagNodes.length;
}

function updateGraphHeader() {
  const snapshot = state.snapshot || {};
  const groupName = snapshot.source?.group?.name || 'No snapshot loaded';
  const refreshed = snapshot.refreshedAt
    ? formatDate(snapshot.refreshedAt)
    : 'Never';
  const tags = state.graph?.tagNodes.length || 0;
  const quotes = state.graph?.quoteNodes.length || 0;
  const humanEdges = state.graph?.humanEdges.length || 0;
  els.graphTitle.textContent = groupName;
  els.graphStats.textContent = `${tags} tags / ${quotes} quotes / ${humanEdges} human edges. Refreshed ${refreshed}.`;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

async function init() {
  els.loginBtn.addEventListener('click', () => {
    if (state.session?.authenticated) {
      logout().catch(err => showNotice(err.message));
    } else {
      login().catch(err => showNotice(err.message));
    }
  });
  els.refreshBtn.addEventListener('click', () => {
    refreshSnapshot().catch(err => showNotice(err.message));
  });
  els.newEdgeBtn.addEventListener('click', openEdgeEditor);
  els.cancelEdgeBtn.addEventListener('click', closeEdgeEditor);
  els.saveEdgeBtn.addEventListener('click', saveNewEdge);
  els.groupSelect.addEventListener('change', () => {
    state.edits.selectedGroupId = els.groupSelect.value || null;
    saveEditsNow().catch(err => showNotice(err.message));
  });
  els.svg.addEventListener('pointermove', handleDrag);
  els.svg.addEventListener('pointerup', stopDrag);
  els.svg.addEventListener('pointerleave', stopDrag);

  try {
    await loadStatus();
    await loadGroups();
    await loadGraph();
  } catch (err) {
    showNotice(err.message);
  }
}

init();
