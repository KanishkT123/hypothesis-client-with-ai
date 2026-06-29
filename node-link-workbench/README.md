# Hypothesis Node-Link Workbench

Standalone local graph workspace for Hypothesis annotations.

## Run

```sh
npm run node-link
```

Open `http://127.0.0.1:8787`.

## Flow

1. Log in with Hypothesis OAuth.
2. Choose a group from the dropdown.
3. Click `Refresh` to pull that group's annotations from Hypothesis.
4. Drag tag or quote nodes to arrange the graph.
5. Add human-authored tag-to-tag edges with labels.

Tag-to-quote edges are regenerated from the latest annotation snapshot. Human tag-to-tag edges and node positions are saved separately.

## Local Data

Runtime data is stored under `node-link-workbench/data/` and ignored by git:

- `auth.json`: local OAuth token cache.
- `annotations.snapshot.json`: latest pulled group annotation snapshot.
- `graph.edits.json`: human graph layout and tag-to-tag edges.

If a later refresh no longer contains a tag used by a human edge, the edge remains in `graph.edits.json` but is hidden in the graph until both tags are present again.
