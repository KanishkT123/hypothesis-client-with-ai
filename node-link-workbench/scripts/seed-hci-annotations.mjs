#!/usr/bin/env node

/* global process */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(workbenchDir, '..');
const seedPath = path.join(workbenchDir, 'seed', 'hci-gestalt-sentences.json');

await loadEnvFiles([
  path.resolve(repoDir, '..', '.env'),
  path.resolve(repoDir, '.env'),
]);

const apiUrl = process.env.HYPOTHESIS_API_URL || 'https://hypothes.is/api/';
const apiToken =
  process.env.HYPOTHESIS_API_TOKEN || process.env.API_TOKEN || '';
const dryRun = process.argv.includes('--dry-run');
const groupArg = process.argv
  .find(arg => arg.startsWith('--group='))
  ?.slice('--group='.length);

if (!apiToken) {
  throw new Error(
    'Missing HYPOTHESIS_API_TOKEN or API_TOKEN. Put it in the parent .env file.',
  );
}

const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
const groupId = groupArg || seed.groupId;

if (!groupId) {
  throw new Error(
    'Missing group id. Add groupId to the seed file or pass --group=<id>.',
  );
}

const profile = await fetchJson(new URL('profile', apiUrl));
await validateSeedQuotes(seed);

const existingAnnotations = await fetchAllGroupAnnotations(groupId);
const existingKeys = new Set();
for (const ann of existingAnnotations) {
  const quote = firstTextQuote(ann);
  for (const tag of ann.tags || []) {
    existingKeys.add(annotationKey(ann.uri, quote, tag));
  }
}

const summary = {
  created: 0,
  skipped: 0,
  documents: {},
};

for (const doc of seed.documents || []) {
  summary.documents[doc.id] = { created: 0, skipped: 0 };
  for (const item of doc.items || []) {
    const key = annotationKey(doc.uri, item.quote, item.tag);
    if (existingKeys.has(key)) {
      summary.skipped += 1;
      summary.documents[doc.id].skipped += 1;
      continue;
    }

    if (!dryRun) {
      await createAnnotation({
        groupId,
        profile,
        doc,
        item,
      });
      existingKeys.add(key);
    }

    summary.created += 1;
    summary.documents[doc.id].created += 1;
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      groupId,
      user: profile.userid,
      totalSeedItems: seed.documents.reduce(
        (sum, doc) => sum + (doc.items?.length || 0),
        0,
      ),
      ...summary,
    },
    null,
    2,
  ),
);

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

function authHeaders(body = false) {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Hypothesis-Client-Version': 'node-link-workbench-seed',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(Boolean(options.body)),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof data === 'object' && data
        ? data.reason || data.message || JSON.stringify(data)
        : data || response.statusText;
    throw new Error(`Hypothesis API ${response.status}: ${detail}`);
  }

  return data;
}

async function fetchAllGroupAnnotations(pubid) {
  const annotations = [];
  let pageAfter = null;

  for (let page = 0; page < 1000; page += 1) {
    const url = new URL(
      `groups/${encodeURIComponent(pubid)}/annotations`,
      apiUrl,
    );
    url.searchParams.set('page[size]', '100');
    if (pageAfter) {
      url.searchParams.set('page[after]', pageAfter);
    }

    const result = await fetchJson(url);
    const data = result.data || [];
    annotations.push(...data);
    if (data.length < 100) {
      break;
    }

    const nextCursor = data[data.length - 1]?.created;
    if (!nextCursor || nextCursor === pageAfter) {
      break;
    }
    pageAfter = nextCursor;
  }

  return annotations;
}

function firstTextQuote(annotation) {
  for (const target of annotation.target || []) {
    for (const selector of target.selector || []) {
      if (selector.type === 'TextQuoteSelector') {
        return selector.exact || '';
      }
    }
  }
  return '';
}

function annotationKey(uri, quote, tag) {
  return `${uri}\n${normalizeText(quote)}\n${tag.trim()}`;
}

async function createAnnotation({ groupId, profile, doc, item }) {
  const url = new URL('annotations', apiUrl);
  return fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({
      group: groupId,
      uri: doc.uri,
      text: '',
      tags: [item.tag],
      permissions: sharedPermissions(profile.userid, groupId),
      document: {
        title: [doc.title],
      },
      target: [
        {
          source: doc.uri,
          selector: [
            {
              type: 'TextQuoteSelector',
              exact: item.quote,
            },
          ],
        },
      ],
    }),
  });
}

function sharedPermissions(userid, groupId) {
  return {
    read: [`group:${groupId}`],
    update: [userid],
    delete: [userid],
  };
}

async function validateSeedQuotes(seedData) {
  const missing = [];
  for (const doc of seedData.documents || []) {
    const response = await fetch(doc.uri);
    if (!response.ok) {
      throw new Error(`Unable to load ${doc.uri}: HTTP ${response.status}`);
    }
    const text = normalizeText(htmlToText(await response.text()));
    const seen = new Set();
    for (const item of doc.items || []) {
      const exact = normalizeText(item.quote);
      const key = `${item.tag}\n${exact}`;
      if (seen.has(key)) {
        missing.push(`${doc.id}: duplicate tag and sentence for ${item.tag}`);
      }
      seen.add(key);
      if (!text.includes(exact)) {
        missing.push(`${doc.id} / ${item.tag}: ${item.quote}`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      `Seed validation failed; these exact sentences were not found:\n${missing.join('\n')}`,
    );
  }
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeEntities(text) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const codePoint =
        entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    }
    return named[entity.toLowerCase()] ?? _;
  });
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}
