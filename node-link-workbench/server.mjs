#!/usr/bin/env node

/* global Buffer, process */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const authPath = path.join(dataDir, 'auth.json');
const authDebugPath = path.join(dataDir, 'auth.debug.json');
const snapshotPath = path.join(dataDir, 'annotations.snapshot.json');
const editsPath = path.join(dataDir, 'graph.edits.json');

const loadedEnvFiles = [];

await loadEnvFiles([
  path.resolve(__dirname, '..', '..', '.env'),
  path.resolve(__dirname, '..', '.env'),
]);

const host = process.env.NODE_LINK_HOST || '127.0.0.1';
const port = Number(process.env.NODE_LINK_PORT || 8787);
const origin = `http://${host}:${port}`;

const serviceUrl = process.env.HYPOTHESIS_SERVICE_URL || 'https://hypothes.is/';
const apiUrl = process.env.HYPOTHESIS_API_URL || 'https://hypothes.is/api/';
const apiToken =
  process.env.HYPOTHESIS_API_TOKEN || process.env.API_TOKEN || '';
const apiTokenSource = process.env.HYPOTHESIS_API_TOKEN
  ? 'HYPOTHESIS_API_TOKEN'
  : process.env.API_TOKEN
    ? 'API_TOKEN'
    : null;
const oauthClientId =
  process.env.HYPOTHESIS_OAUTH_CLIENT_ID ||
  'fd23fe2e-7792-11e7-8e16-23e47a1799d4';

const GROUP_ANNOTATIONS_PAGE_SIZE = 100;
const MAX_GROUP_ANNOTATION_PAGES = 1000;
const TOKEN_REFRESH_SLOP_MS = 30_000;
const OAUTH_STATE_TTL_MS = 5 * 60_000;
const MAX_AUTH_DEBUG_EVENTS = 150;

const pendingOAuthStates = new Set();
let routeMapPromise = null;
let linksPromise = null;
let authDebugWritePromise = Promise.resolve();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function emptySnapshot() {
  return {
    schemaVersion: 1,
    refreshedAt: null,
    source: {
      serviceUrl,
      apiUrl,
      group: null,
      total: 0,
      fetched: 0,
    },
    annotations: [],
  };
}

function emptyEdits() {
  // Local-only workbench state. Hypothesis remains the source of annotation
  // evidence; this file stores the graph metadata that Hypothesis does not.
  return {
    schemaVersion: 1,
    updatedAt: null,
    selectedGroupId: null,
    layout: {
      version: 2,
      nodes: {},
    },
    descriptiveTags: [],
    tagEdges: [],
  };
}

function emptyAuthDebug() {
  return {
    schemaVersion: 1,
    events: [],
  };
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      continue;
    }

    loadedEnvFiles.push(filePath);
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      if (process.env[key] === undefined) {
        process.env[key] = parseEnvValue(rawValue);
      }
    }
  }
}

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJsonFile(snapshotPath, emptySnapshot());
  await ensureJsonFile(editsPath, emptyEdits());
}

async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJson(filePath, fallback);
  }
}

async function readJson(filePath, fallback = null) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function shortId(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function sanitizeForDebug(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForDebug);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey === 'code' ||
      lowerKey === 'authorization'
    ) {
      sanitized[key] = item ? '[redacted]' : item;
    } else if (lowerKey === 'state') {
      sanitized[key] = shortId(item);
    } else {
      sanitized[key] = sanitizeForDebug(item);
    }
  }
  return sanitized;
}

function errorDetails(err) {
  return sanitizeForDebug({
    message: err?.message || String(err),
    status: err?.status || null,
    body: err?.body || null,
  });
}

async function readAuthDebug() {
  try {
    return await readJson(authDebugPath, emptyAuthDebug());
  } catch (err) {
    console.warn('Unable to read auth debug log; starting a fresh log', err);
    return emptyAuthDebug();
  }
}

function recordAuthEvent(event, details = {}) {
  authDebugWritePromise = authDebugWritePromise
    .catch(() => {})
    .then(async () => {
      const debug = await readAuthDebug();
      debug.events.push({
        at: new Date().toISOString(),
        event,
        details: sanitizeForDebug(details),
      });
      debug.events = debug.events.slice(-MAX_AUTH_DEBUG_EVENTS);
      await writeJson(authDebugPath, debug);
    })
    .catch(err => {
      console.warn('Unable to write auth debug event', err);
    });
  return authDebugWritePromise;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { error: message, details });
}

function requestOrigin(req) {
  return `http://${req.headers.host || `${host}:${port}`}`;
}

function assertWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid static asset path');
  }
}

async function serveStatic(req, res, pathname) {
  const filePath =
    pathname === '/'
      ? path.join(publicDir, 'index.html')
      : path.join(publicDir, pathname);
  assertWithin(publicDir, filePath);

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      sendError(res, 404, 'Not found');
      return;
    }
    throw err;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' && body?.reason
        ? body.reason
        : `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function getRouteMap() {
  if (!routeMapPromise) {
    routeMapPromise = fetchJson(apiUrl).then(index => index.links);
  }
  return routeMapPromise;
}

async function getLinks() {
  if (!linksPromise) {
    linksPromise = fetchJson(new URL('links', apiUrl).toString());
  }
  return linksPromise;
}

function isRouteMetadata(value) {
  return value && typeof value === 'object' && 'url' in value;
}

async function routeMetadata(routeName) {
  const routeMap = await getRouteMap();
  let cursor = routeMap;
  for (const segment of routeName.split('.')) {
    cursor = cursor?.[segment];
    if (!cursor) {
      break;
    }
  }
  if (!isRouteMetadata(cursor)) {
    throw new Error(`Missing Hypothesis API route: ${routeName}`);
  }
  return cursor;
}

async function routeUrl(routeName, params = {}) {
  const descriptor = await routeMetadata(routeName);
  const usedParams = new Set();
  const urlText = descriptor.url.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, key) => {
      if (!(key in params)) {
        throw new Error(`Missing route param: ${key}`);
      }
      usedParams.add(key);
      return encodeURIComponent(params[key]);
    },
  );

  const url = new URL(urlText);
  for (const [key, value] of Object.entries(params)) {
    if (usedParams.has(key) || value === undefined || value === null) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      url.searchParams.append(key, String(item));
    }
  }

  return { method: descriptor.method, url };
}

async function readAuth() {
  return readJson(authPath, null);
}

async function saveAuth(tokenInfo) {
  await writeJson(authPath, tokenInfo);
}

async function clearAuth() {
  try {
    await fs.unlink(authPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

async function tokenEndpoint() {
  return new URL('token', apiUrl).toString();
}

async function formPost(url, data) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    body.set(key, value);
  }
  body.sort();

  const response = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + (response.expires_in - 10) * 1000,
  };
}

async function exchangeAuthCode(code) {
  try {
    const tokenInfo = await formPost(await tokenEndpoint(), {
      client_id: oauthClientId,
      code,
      grant_type: 'authorization_code',
    });
    await saveAuth(tokenInfo);
    await recordAuthEvent('server.oauth.token_saved', {
      expiresAt: tokenInfo.expiresAt,
      hasRefreshToken: Boolean(tokenInfo.refreshToken),
    });
    return tokenInfo;
  } catch (err) {
    await recordAuthEvent('server.oauth.token_error', errorDetails(err));
    throw err;
  }
}

async function refreshToken(auth) {
  try {
    const tokenInfo = await formPost(await tokenEndpoint(), {
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
    });
    await saveAuth(tokenInfo);
    await recordAuthEvent('server.oauth.token_refreshed', {
      expiresAt: tokenInfo.expiresAt,
      hasRefreshToken: Boolean(tokenInfo.refreshToken),
    });
    return tokenInfo;
  } catch (err) {
    await recordAuthEvent('server.oauth.refresh_error', errorDetails(err));
    throw err;
  }
}

async function accessToken() {
  if (apiToken) {
    return apiToken;
  }

  let auth = await readAuth();
  if (!auth?.accessToken) {
    return null;
  }
  if (Date.now() + TOKEN_REFRESH_SLOP_MS > auth.expiresAt) {
    auth = await refreshToken(auth);
  }
  return auth.accessToken;
}

async function authorizedApiCall(routeName, params = {}, options = {}) {
  const token = await accessToken();
  if (!token) {
    const err = new Error('Not authenticated');
    err.status = 401;
    throw err;
  }

  const { method, url } = await routeUrl(routeName, params);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Hypothesis-Client-Version': 'node-link-workbench',
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  return fetchJson(url.toString(), {
    method: options.method || method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

function firstSelector(annotation, type) {
  for (const target of annotation.target || []) {
    for (const selector of target.selector || []) {
      if (selector.type === type) {
        return selector;
      }
    }
  }
  return null;
}

function extractQuote(annotation) {
  const textQuote = firstSelector(annotation, 'TextQuoteSelector');
  if (textQuote?.exact) {
    return textQuote.exact;
  }

  const shape = firstSelector(annotation, 'ShapeSelector');
  if (shape?.text) {
    return shape.text;
  }

  for (const target of annotation.target || []) {
    if (target.description) {
      return target.description;
    }
  }

  return '';
}

function normalizeAnnotation(annotation) {
  const textQuote = firstSelector(annotation, 'TextQuoteSelector');
  const position = firstSelector(annotation, 'TextPositionSelector');
  const quote = extractQuote(annotation);

  return {
    id: annotation.id,
    created: annotation.created,
    updated: annotation.updated,
    group: annotation.group,
    hidden: Boolean(annotation.hidden),
    isReply:
      Array.isArray(annotation.references) && annotation.references.length > 0,
    references: annotation.references || [],
    uri: annotation.uri,
    user: annotation.user,
    text: annotation.text || '',
    tags: annotation.tags || [],
    documentTitle:
      annotation.document?.title?.[0] ||
      annotation.document?.title ||
      annotation.uri,
    quote,
    quoteContext: {
      prefix: textQuote?.prefix || '',
      suffix: textQuote?.suffix || '',
      start: position?.start ?? null,
      end: position?.end ?? null,
    },
    target: annotation.target || [],
    links: {
      html: annotation.links?.html || '',
      incontext: annotation.links?.incontext || '',
    },
  };
}

async function fetchAllGroupAnnotations(pubid, groupInfo) {
  const annotations = [];
  let pageAfter;

  for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page += 1) {
    const params = {
      pubid,
      'page[size]': GROUP_ANNOTATIONS_PAGE_SIZE,
    };
    if (pageAfter) {
      params['page[after]'] = pageAfter;
    }

    const result = await authorizedApiCall('group.annotations.read', params);
    const data = result.data || [];
    annotations.push(...data.map(normalizeAnnotation));

    if (data.length < GROUP_ANNOTATIONS_PAGE_SIZE) {
      break;
    }

    const nextCursor = data[data.length - 1]?.created;
    if (!nextCursor || nextCursor === pageAfter) {
      break;
    }
    pageAfter = nextCursor;
  }

  const snapshot = {
    schemaVersion: 1,
    refreshedAt: new Date().toISOString(),
    source: {
      serviceUrl,
      apiUrl,
      group: groupInfo
        ? {
            id: groupInfo.id,
            name: groupInfo.name,
            type: groupInfo.type,
            links: groupInfo.links || {},
          }
        : { id: pubid },
      total: annotations.length,
      fetched: annotations.length,
    },
    annotations,
  };

  await writeJson(snapshotPath, snapshot);

  const edits = await readJson(editsPath, emptyEdits());
  edits.selectedGroupId = pubid;
  edits.updatedAt = new Date().toISOString();
  await writeJson(editsPath, edits);

  return snapshot;
}

async function apiStatus() {
  const token = await accessToken().catch(() => null);
  if (!token) {
    return {
      authenticated: false,
      authMethod: null,
      profile: null,
    };
  }

  try {
    const profile = await authorizedApiCall('profile.read');
    await recordAuthEvent('server.profile.loaded', {
      userid: profile.userid,
      hasDisplayName: Boolean(profile.user_info?.display_name),
      authMethod: apiToken ? 'apiToken' : 'oauth',
    });
    return {
      authenticated: true,
      authMethod: apiToken ? 'apiToken' : 'oauth',
      profile: {
        userid: profile.userid,
        displayName: profile.user_info?.display_name || profile.userid,
      },
    };
  } catch (err) {
    await recordAuthEvent('server.profile.error', errorDetails(err));
    return {
      authenticated: false,
      authMethod: apiToken ? 'apiToken' : null,
      profile: null,
    };
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/debug/auth') {
    const auth = await readAuth();
    await authDebugWritePromise.catch(() => {});
    const debug = await readAuthDebug();
    sendJson(res, 200, {
      authenticatedCache: {
        hasAuthFile: Boolean(auth),
        hasAccessToken: Boolean(auth?.accessToken),
        hasRefreshToken: Boolean(auth?.refreshToken),
        expiresAt: auth?.expiresAt || null,
      },
      settings: {
        serviceUrl,
        apiUrl,
        oauthClientId,
        hasApiToken: Boolean(apiToken),
        apiTokenSource,
        loadedEnvFiles,
      },
      pendingOAuthStateCount: pendingOAuthStates.size,
      events: debug.events || [],
    });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/debug/auth') {
    pendingOAuthStates.clear();
    await writeJson(authDebugPath, emptyAuthDebug());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/debug/auth-event') {
    const body = await readRequestBody(req);
    await recordAuthEvent(
      `browser.${body.event || 'event'}`,
      body.details || {},
    );
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, await apiStatus());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/oauth/start') {
    const links = await getLinks();
    const state = crypto.randomBytes(16).toString('hex');
    pendingOAuthStates.add(state);
    setTimeout(() => {
      pendingOAuthStates.delete(state);
    }, OAUTH_STATE_TTL_MS).unref();
    const oauthOrigin = requestOrigin(req);

    const authUrl = new URL(links['oauth.authorize']);
    authUrl.searchParams.set('client_id', oauthClientId);
    authUrl.searchParams.set('origin', oauthOrigin);
    authUrl.searchParams.set('response_mode', 'web_message');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set(
      'action',
      url.searchParams.get('action') || 'login',
    );

    await recordAuthEvent('server.oauth.start', {
      origin: oauthOrigin,
      clientId: oauthClientId,
      state,
      authEndpoint: links['oauth.authorize'],
    });

    sendJson(res, 200, {
      authUrl: authUrl.toString(),
      origin: oauthOrigin,
      state,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/oauth/exchange') {
    const body = await readRequestBody(req);
    const stateKnown = Boolean(
      body.state && pendingOAuthStates.has(body.state),
    );
    await recordAuthEvent('server.oauth.exchange_received', {
      hasCode: Boolean(body.code),
      state: body.state,
      stateKnown,
    });
    if (!body.code || !body.state || !stateKnown) {
      sendError(res, 400, 'Invalid OAuth response');
      return;
    }

    pendingOAuthStates.delete(body.state);
    await exchangeAuthCode(body.code);
    sendJson(res, 200, await apiStatus());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    await clearAuth();
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/groups') {
    let groups;
    try {
      groups = await authorizedApiCall('profile.groups.read', {
        expand: ['organization', 'scopes'],
      });
    } catch (err) {
      await recordAuthEvent('server.groups.error', errorDetails(err));
      throw err;
    }
    await recordAuthEvent('server.groups.loaded', {
      count: groups.length,
    });
    groups.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    sendJson(
      res,
      200,
      groups.map(group => ({
        id: group.id,
        name: group.name || group.id,
        type: group.type,
        organization: group.organization?.name || '',
        links: group.links || {},
      })),
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/graph') {
    const [snapshot, edits] = await Promise.all([
      readJson(snapshotPath, emptySnapshot()),
      readJson(editsPath, emptyEdits()),
    ]);
    sendJson(res, 200, { snapshot, edits });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/edits') {
    const body = await readRequestBody(req);
    const edits = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      selectedGroupId: body.selectedGroupId || null,
      layout: {
        version: body.layout?.version || 1,
        nodes: body.layout?.nodes || {},
      },
      descriptiveTags: Array.isArray(body.descriptiveTags)
        ? body.descriptiveTags
        : [],
      tagEdges: Array.isArray(body.tagEdges) ? body.tagEdges : [],
    };
    await writeJson(editsPath, edits);
    sendJson(res, 200, edits);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/refresh') {
    const body = await readRequestBody(req);
    if (!body.groupId) {
      sendError(res, 400, 'Missing groupId');
      return;
    }
    const groupInfo = body.group || { id: body.groupId };
    const snapshot = await fetchAllGroupAnnotations(body.groupId, groupInfo);
    sendJson(res, 200, snapshot);
    return;
  }

  sendError(res, 404, 'Unknown API route');
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    const status = err.status || 500;
    console.error(err);
    sendError(res, status, err.message || 'Server error', err.body);
  }
}

await ensureDataFiles();

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(port, host, () => {
  console.warn(`Node-link workbench listening at ${origin}`);
});
