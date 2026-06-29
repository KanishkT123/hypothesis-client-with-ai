# Node-Link Workbench Data

Runtime files are written here by `node-link-workbench/server.mjs`.

- `auth.json` stores local OAuth tokens.
- `annotations.snapshot.json` stores the latest pulled Hypothesis annotations for the selected group.
- `graph.edits.json` stores human-authored graph layout and tag-to-tag edges.

These files are intentionally ignored because they can contain private annotation text and credentials.
