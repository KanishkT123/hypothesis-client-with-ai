/**
 * In-memory registry for in-flight Claude AISearchDocument calls only.
 * Used for timer, Stop, and AbortSignal — not for delete/create phases.
 */

type RunEntry = {
  startedAt: number;
  controller: AbortController;
};

const runs = new Map<string, RunEntry>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(fn => fn());
}

export type ClaudeRunSnapshot = {
  activeClaudeCount: number;
  /** Max startedAt among active runs; 0 if none */
  timerAnchorMs: number;
};

function computeSnapshot(): ClaudeRunSnapshot {
  if (runs.size === 0) {
    return { activeClaudeCount: 0, timerAnchorMs: 0 };
  }
  let maxStarted = 0;
  for (const { startedAt } of runs.values()) {
    if (startedAt > maxStarted) {
      maxStarted = startedAt;
    }
  }
  return { activeClaudeCount: runs.size, timerAnchorMs: maxStarted };
}

export function subscribeClaudeRuns(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getClaudeRunsSnapshot(): ClaudeRunSnapshot {
  return computeSnapshot();
}

/**
 * Register a Claude run immediately before AISearchDocument; call `finish` in `finally` after await.
 */
export function registerClaudeRun(): {
  runId: string;
  signal: AbortSignal;
  finish: () => void;
} {
  const runId = crypto.randomUUID();
  const controller = new AbortController();
  const startedAt = Date.now();
  runs.set(runId, { startedAt, controller });
  notify();

  const finish = () => {
    runs.delete(runId);
    notify();
  };

  return { runId, signal: controller.signal, finish };
}

/** Abort every in-flight Claude request and clear the registry. */
export function abortAllClaudeRuns() {
  for (const { controller } of runs.values()) {
    controller.abort();
  }
  runs.clear();
  notify();
}
