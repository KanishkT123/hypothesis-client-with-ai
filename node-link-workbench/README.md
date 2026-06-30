# Hypothesis Node-Link Workbench

Standalone local graph workspace for Hypothesis annotations.

## Run

```sh
npm run node-link
```

Open `http://127.0.0.1:8787`.

For local token auth, add one of these variables to `../.env` or this repo's
`.env` before starting the server:

```sh
API_TOKEN=your-hypothesis-api-token
```

or:

```sh
HYPOTHESIS_API_TOKEN=your-hypothesis-api-token
```

The server uses the token directly as a bearer token and does not copy it into
`node-link-workbench/data/auth.json`.

## Flow

1. Start the server with `API_TOKEN` or `HYPOTHESIS_API_TOKEN` available.
2. Choose a group from the dropdown.
3. Click `Refresh` to pull that group's annotations from Hypothesis.
4. Use the document dropdown to show all documents or one source document.
5. Use the color dropdown to view tag color, document focus, cross-document
   bridge tags, or density.
6. Toggle tag-only view when you want to hide quote cards and inspect tag-tag
   structure directly.
7. Toggle implicit connections to show generated same-document tag suggestions.
   Click a dashed implicit edge to promote it into a real human edge with a
   connection type and purpose.
8. Toggle selection-first edges to dim unrelated edges until a node is selected.
9. Drag tag or quote nodes to arrange the graph.
10. Use the zoom controls to inspect the full graph or fit it to the canvas.
11. Add human-authored tag-to-tag edges with connection types and purposes.

Tag-to-quote edges are regenerated from the latest annotation snapshot. Implicit
tag-to-tag edges are generated from visible tags that appear in the same
document. Human tag-to-tag edges and node positions are saved separately. If a
document filter hides either endpoint tag, that human edge is hidden until both
tags are visible again.

The graph uses a versioned layout. `Reset` clears saved node positions for the current layout version without deleting annotations or human tag-to-tag edges.

## Seed Test Annotations

The HCI/Gestalt test corpus for `TestGroup1` is stored in
`node-link-workbench/seed/hci-gestalt-sentences.json`.

Validate the local sample documents and Hypothesis API access without creating
annotations:

```sh
npm run node-link:seed -- --dry-run
```

Create any missing seed annotations:

```sh
npm run node-link:seed
```

The script deduplicates by document URL, exact sentence quote, and tag. It uses
the same group-shared permissions shape as the Hypothesis client.

## Local Data

Runtime data is stored under `node-link-workbench/data/` and ignored by git:

- `auth.json`: local OAuth token cache.
- `auth.debug.json`: local auth-flow diagnostics with codes and tokens redacted.
- `annotations.snapshot.json`: latest pulled group annotation snapshot.
- `graph.edits.json`: human graph layout and promoted/manual tag-to-tag edges.

If a later refresh no longer contains a tag used by a human edge, the edge remains in `graph.edits.json` but is hidden in the graph until both tags are present again.

## Auth Troubleshooting

- `GET /api/debug/auth` shows the local OAuth settings, token-cache presence,
  API-token presence, pending OAuth state count, and recent browser/server auth
  events.
- `DELETE /api/debug/auth` clears the diagnostics log.

OAuth is still present, but the standalone workbench needs a Hypothesis OAuth
client registered for its local origin. The browser extension client ID is not
enough for `http://127.0.0.1:8787`.
