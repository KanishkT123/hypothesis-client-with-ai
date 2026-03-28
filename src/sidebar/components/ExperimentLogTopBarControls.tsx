import { confirm } from '@hypothesis/frontend-shared';

import { withServices } from '../service-context';
import type { ExperimentLogService } from '../services/experiment-log';

type Props = {
  experimentLog: ExperimentLogService;
};

/**
 * Experiment log download + clear (plan: TopBar, immediately before account / login).
 */
function ExperimentLogTopBarControls({ experimentLog }: Props) {
  return (
    <div
      className="flex items-center gap-x-2 px-1"
      data-testid="experiment-log-topbar"
    >
      <button
        type="button"
        className="text-[11px] text-grey-7 hover:text-grey-9 underline"
        title="Download experiment log as JSON"
        data-testid="experiment-log-download"
        onClick={() => experimentLog.downloadLog()}
      >
        Download log
      </button>
      <button
        type="button"
        className="text-[11px] text-grey-7 hover:text-grey-9 underline"
        title="Clear experiment log"
        data-testid="experiment-log-clear"
        onClick={async () => {
          const ok = await confirm({
            title: 'Clear experiment log?',
            message:
              'Are you sure you want to clear the experiment log? This cannot be undone.',
            confirmAction: 'Clear log',
          });
          if (ok) {
            experimentLog.clearLog();
          }
        }}
      >
        Clear log
      </button>
    </div>
  );
}

export default withServices(ExperimentLogTopBarControls, ['experimentLog']);
