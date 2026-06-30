const SYSTEM_TAGS = new Set(['ai-pending', 'ai-user-approved']);
const TAG_NODE_RADIUS = 34;
const QUOTE_WIDTH = 250;
const QUOTE_HEIGHT = 86;

const els = {
  sessionLabel: document.querySelector('#sessionLabel'),
  groupSelect: document.querySelector('#groupSelect'),
  documentSelect: document.querySelector('#documentSelect'),
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
  edgeExplanation: document.querySelector('#edgeExplanation'),
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
  documentFilter: 'all',
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
    const detail =
      typeof data.details === 'string'
        ? data.details
        : data.details?.reason || data.details?.message || '';
    const message = data.error || `Request failed: ${response.status}`;
    throw new Error(
      detail && detail !== message ? `${message}: ${detail}` : message,
    );
  }
  return data;
}

function debugAuth(event, details = {}) {
  fetch('/api/debug/auth-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event, details }),
  }).catch(() => {});
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

function annotationDocumentId(annotation) {
  return annotation?.uri || '';
}

function documentLabelFromUrl(uri) {
  try {
    const url = new URL(uri);
    const file = url.pathname.split('/').filter(Boolean).pop();
    if (file) {
      return decodeURIComponent(file).replace(/[-_]+/g, ' ');
    }
    return url.hostname;
  } catch {
    return uri || 'Untitled document';
  }
}

function annotationDocumentLabel(annotation) {
  const title = annotation?.documentTitle || '';
  if (title && title !== annotation?.uri) {
    return title;
  }
  return documentLabelFromUrl(annotationDocumentId(annotation));
}

function documentOptions() {
  const byUri = new Map();
  for (const ann of state.snapshot?.annotations || []) {
    if (ann.hidden || ann.isReply || !ann.quote) {
      continue;
    }
    const uri = annotationDocumentId(ann);
    if (!uri) {
      continue;
    }
    const option = byUri.get(uri) || {
      uri,
      label: annotationDocumentLabel(ann),
      count: 0,
    };
    option.count += 1;
    byUri.set(uri, option);
  }
  return [...byUri.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function selectedDocumentLabel() {
  if (state.documentFilter === 'all') {
    return 'All documents';
  }
  return (
    documentOptions().find(option => option.uri === state.documentFilter)
      ?.label || documentLabelFromUrl(state.documentFilter)
  );
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

  const annotations = (snapshot.annotations || []).filter(ann => {
    if (ann.hidden || ann.isReply) {
      return false;
    }
    return (
      state.documentFilter === 'all' ||
      annotationDocumentId(ann) === state.documentFilter
    );
  });

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
    annotations,
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
  title.textContent = shortText(annotationDocumentLabel(node.annotation), 34);
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
  updateGraphHeader();
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
    <div class="selection-title">${escapeHtml(shortText(annotationDocumentLabel(ann), 70))}</div>
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
      <textarea aria-label="Edge explanation">${escapeHtml(edge.explanation || '')}</textarea>
      <div class="edge-actions">
        <span>${isVisible ? 'Visible' : 'Hidden until both tags exist'}</span>
        <button class="ghost-button danger" type="button">Delete</button>
      </div>
    `;
    const input = item.querySelector('input');
    const textarea = item.querySelector('textarea');
    const deleteButton = item.querySelector('button');
    input.addEventListener('change', () => {
      edge.label = input.value.trim();
      edge.updatedAt = new Date().toISOString();
      saveEditsNow();
      buildGraph();
      renderGraph();
    });
    textarea.addEventListener('change', () => {
      edge.explanation = textarea.value.trim();
      edge.updatedAt = new Date().toISOString();
      saveEditsNow();
    });
    deleteButton.addEventListener('click', () => {
      state.edits.tagEdges = state.edits.tagEdges.filter(
        itemEdge => itemEdge.id !== edge.id,
      );
      saveEditsNow();
      buildGraph();
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
  els.edgeExplanation.value = '';
}

function closeEdgeEditor() {
  els.edgeEditor.hidden = true;
}

function saveNewEdge() {
  const sourceTag = els.edgeSource.value;
  const targetTag = els.edgeTarget.value;
  const label = els.edgeLabel.value.trim();
  const explanation = els.edgeExplanation.value.trim();
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
    explanation,
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
  debugAuth('login.started', { origin: window.location.origin });
  const popup = window.open(
    'about:blank',
    'Hypothesis Login',
    'width=475,height=630',
  );
  if (!popup) {
    debugAuth('login.popup_blocked');
    showNotice('The login popup was blocked.');
    return;
  }
  debugAuth('login.popup_opened');

  let authStart;
  try {
    authStart = await api('/api/oauth/start');
  } catch (err) {
    debugAuth('login.start_error', { message: err.message });
    popup.close();
    throw err;
  }

  const { authUrl, state: oauthState, origin: oauthOrigin } = authStart;
  debugAuth('login.auth_url_loaded', {
    oauthOrigin,
    state: oauthState,
  });
  const code = await new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
    }

    function finish(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    }

    timeout = setTimeout(() => {
      debugAuth('login.timeout', { state: oauthState });
      finish(reject, new Error('Login timed out.'));
    }, 180_000);

    function listener(event) {
      const data =
        event.data && typeof event.data === 'object' ? event.data : null;
      debugAuth('login.message_received', {
        origin: event.origin,
        sourceMatchesPopup: event.source === popup,
        dataType: typeof event.data,
        messageType: data?.type || null,
        state: data?.state || null,
        stateMatches: data?.state === oauthState,
        keys: data ? Object.keys(data) : [],
        hasCode: Boolean(data?.code),
      });

      if (!data || data.state !== oauthState) {
        return;
      }
      if (data.type === 'authorization_response') {
        finish(resolve, data.code);
      } else if (data.type === 'authorization_canceled') {
        finish(reject, new Error('Login was canceled.'));
      }
    }

    window.addEventListener('message', listener);
    popup.location.href = authUrl;
    debugAuth('login.popup_navigated', { state: oauthState });
  });

  debugAuth('login.code_received', {
    hasCode: Boolean(code),
    state: oauthState,
  });
  try {
    state.session = await api('/api/oauth/exchange', {
      method: 'POST',
      body: { code, state: oauthState },
    });
  } catch (err) {
    debugAuth('login.exchange_error', { message: err.message });
    throw err;
  }
  debugAuth('login.exchange_completed', {
    authenticated: Boolean(state.session?.authenticated),
    userid: state.session?.profile?.userid || null,
  });
  updateControls();

  if (!state.session?.authenticated) {
    showNotice('Login returned, but the profile request did not authenticate.');
    return;
  }

  try {
    await loadGroups();
  } catch (err) {
    state.groups = [];
    updateGroupSelect();
    showNotice(`Signed in, but groups did not load: ${err.message}`);
    debugAuth('groups.load_error', { message: err.message });
  }
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
  debugAuth('groups.loaded', { count: state.groups.length });
  updateGroupSelect();
}

async function loadGraph() {
  const { snapshot, edits } = await api('/api/graph');
  state.snapshot = snapshot;
  state.edits = edits;
  updateGroupSelect();
  updateDocumentSelect();
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
    updateDocumentSelect();
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

function updateDocumentSelect() {
  const options = documentOptions();
  const current = state.documentFilter;

  els.documentSelect.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = options.length
    ? `All documents (${options.reduce((sum, option) => sum + option.count, 0)})`
    : 'All documents';
  els.documentSelect.append(allOption);

  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.uri;
    item.textContent = `${option.label} (${option.count})`;
    els.documentSelect.append(item);
  }

  if (current !== 'all' && options.some(option => option.uri === current)) {
    els.documentSelect.value = current;
  } else {
    state.documentFilter = 'all';
    els.documentSelect.value = 'all';
  }
}

function updateControls() {
  const authenticated = Boolean(state.session?.authenticated);
  const tokenAuth = state.session?.authMethod === 'apiToken';
  els.sessionLabel.textContent = authenticated
    ? tokenAuth
      ? `API token: ${state.session.profile?.displayName || state.session.profile?.userid}`
      : `Signed in as ${state.session.profile?.displayName || state.session.profile?.userid}`
    : 'Not signed in';
  els.loginBtn.textContent = tokenAuth
    ? 'API token'
    : authenticated
      ? 'Log out'
      : 'Log in';
  els.loginBtn.disabled = tokenAuth;
  els.groupSelect.disabled = !authenticated || !state.groups.length;
  els.documentSelect.disabled = !state.snapshot?.annotations?.length;
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
  els.graphStats.textContent = `${selectedDocumentLabel()}: ${tags} tags / ${quotes} quotes / ${humanEdges} human edges. Refreshed ${refreshed}.`;
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
  els.documentSelect.addEventListener('change', () => {
    state.documentFilter = els.documentSelect.value || 'all';
    buildGraph();
    if (
      state.selectedNodeId &&
      !state.graph.nodeById.has(state.selectedNodeId)
    ) {
      state.selectedNodeId = null;
    }
    renderGraph();
    updateGraphHeader();
    updateControls();
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
