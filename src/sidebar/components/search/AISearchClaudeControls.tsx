import { CancelIcon } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useMemo, useState } from 'preact/hooks';

import {
  abortAllClaudeRuns,
  getClaudeRunsSnapshot,
  subscribeClaudeRuns,
} from './ai-search-claude-runs';

function formatElapsedMs(anchorMs: number, nowMs: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - anchorMs) / 1000));
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Timer + Stop to the left of the AI Search panel icon; visible only while
 * waiting on Claude.
 */
export default function AISearchClaudeControls() {
  const snapshot = useSyncExternalStore(
    subscribeClaudeRuns,
    getClaudeRunsSnapshot,
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (snapshot.activeClaudeCount === 0) {
      return undefined;
    }
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [snapshot.activeClaudeCount]);

  const elapsedLabel = useMemo(() => {
    if (snapshot.activeClaudeCount === 0 || snapshot.timerAnchorMs === 0) {
      return '';
    }
    return formatElapsedMs(snapshot.timerAnchorMs, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives recompute every second
  }, [snapshot.activeClaudeCount, snapshot.timerAnchorMs, tick]);

  if (snapshot.activeClaudeCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 mr-0.5">
      <span
        className="tabular-nums text-xs text-color-text-light min-w-[2.5rem] text-right"
        aria-live="polite"
        aria-atomic="true"
      >
        {elapsedLabel}
      </span>
      <button
        type="button"
        className={classnames(
          'touch:min-w-touch-minimum p-1 rounded',
          'text-grey-7 hover:text-color-text hover:bg-grey-2',
          'transition-colors duration-200 focus-visible-ring',
        )}
        title="Stop AI search"
        aria-label="Stop AI search"
        onClick={() => abortAllClaudeRuns()}
      >
        <CancelIcon className="w-em h-em" />
      </button>
    </div>
  );
}
