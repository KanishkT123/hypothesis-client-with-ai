import { Card, CardContent } from '@hypothesis/frontend-shared';
import { useRef } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import SidebarPanel from '../SidebarPanel';
import FilterControls from './FilterControls';
import SearchField from './SearchField';

import { withServices } from '../../service-context';
import type { ReductoService } from '../../services/reducto';
import type { ToastMessengerService } from '../../services/toast-messenger';

/* export type StreamViewProps = {
    // injected
    api: APIService;
    toastMessenger: ToastMessengerService;
}; */

type AISearchPanelProps = {
    // injected
    reducto: ReductoService;
    toastMessenger: ToastMessengerService;
};

function AISearchPanel({ reducto, toastMessenger }: AISearchPanelProps) {
  const store = useSidebarStore();
  const filterQuery = store.filterQuery();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasSelection = store.hasSelectedAnnotations();

  const clearSearch = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };

  return (
    <SidebarPanel
      panelName="aiSearchAnnotations"
      label="AI search panel"
      initialFocus={inputRef}
      onActiveChanged={active => {
        if (!active) {
          store.setFilterQuery(null);
        }
      }}
    >
      <Card>
        <CardContent>
          <div className="flex gap-x-3">
            <SearchField
              inputRef={inputRef}
              classes="grow"
              // Disable the input when there is a selection, as the selection
              // replaces any other filters.
              disabled={hasSelection}
              query={filterQuery || null}
              onClearSearch={clearSearch}
              //onSearch={store.setFilterQuery}
              //onSearch={query => reducto.AISearchDocument({ documentURL: 'test', query })} //TODO: replace with actual document URL, check Reducto function call name
              onSearch={query => reducto.AISearchDocument({ query, candidateURIs: store.searchUris() })} 
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  clearSearch();
                }
              }}
            />
          </div>
          <FilterControls />
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(AISearchPanel, ['reducto', 'toastMessenger']);