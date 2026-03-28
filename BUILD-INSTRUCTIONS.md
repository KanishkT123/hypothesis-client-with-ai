# Additional Instructions

## Before You Start

Clone both repos side by side into the same parent directory:

```
some-folder/
  hypothesis-client-with-ai/          # this repo
  hypothesis-browser-extension-with-AI/  # https://github.com/<org>/hypothesis-browser-extension-with-AI
```

```bash
cd some-folder
git clone <client-repo-url> hypothesis-client-with-ai
git clone <extension-repo-url> hypothesis-browser-extension-with-AI
```

The browser extension depends on the client via a `portal:` path in its `package.json`. Make sure the `hypothesis` entry in `hypothesis-browser-extension-with-AI/package.json` uses this relative path:

```json
"hypothesis": "portal:../hypothesis-client-with-ai"
```

## Install Dependencies

```bash
cd hypothesis-client-with-ai
yarn install

cd ../hypothesis-browser-extension-with-AI
yarn install
```

## Build

1. **Build the client:**

   ```bash
   cd hypothesis-client-with-ai
   npm run build
   ```

2. **Build the browser extension:**

   ```bash
   cd ../hypothesis-browser-extension-with-AI
   make build SETTINGS_FILE=settings/chrome-dev-remote.json
   ```

   If you omit `SETTINGS_FILE`, it defaults to `chrome-dev.json` which points to `localhost` and will show a "localhost denied" error.

3. **Load in Chrome:**

   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked" and select the `build/` directory inside `hypothesis-browser-extension-with-AI/`
   - If already loaded, click the refresh icon on the extension card

## Rebuilding After Code Changes

Re-run build steps 1 and 2, then refresh the extension in Chrome.

## Experiment Log

The HCI experiment log is stored in `localStorage` under **`hypothesis.aiSearch.experimentLog`**. The document is a single-participant, flat JSON object: `version` (currently `1`), `events` (array), and `annotationStatuses` (object keyed by annotation id).

- **Download:** Use **Download experiment log** in the sidebar top bar (after Help; not gated on login). This saves a JSON file (filename like `experiment-log-YYYY-MM-DD.json`).
- **Clear:** Use **Clear experiment log** next to it; you must confirm before the log is wiped. Other tabs pick up the empty state via the same `storage` sync used for AI search history.

To inspect a downloaded log (or merge several exports into one stream):

```bash
python scripts/inspect-experiment-log.py experiment-log-2026-03-27.json
```

Supports merging multiple log files (events concatenated and sorted by timestamp; `annotationStatuses` merged with later files overriding keys):

```bash
python scripts/inspect-experiment-log.py log1.json log2.json
```
