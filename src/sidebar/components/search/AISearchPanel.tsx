import { Card, CardContent, Input } from '@hypothesis/frontend-shared';
import { useRef, useState } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import SidebarPanel from '../SidebarPanel';
import FilterControls from './FilterControls';
import SearchField from './SearchField';

import { withServices } from '../../service-context';
import type { ReductoService } from '../../services/reducto';
import type { APIService } from '../../services/api';
import type { ToastMessengerService } from '../../services/toast-messenger';
import { sharedPermissions } from '../../helpers/permissions';

/* export type StreamViewProps = {
    // injected
    api: APIService;
    toastMessenger: ToastMessengerService;
}; */

type AISearchPanelProps = {
    // injected
    reducto: ReductoService;
    api: APIService;
    toastMessenger: ToastMessengerService;
};

function AISearchPanel({ reducto, api, toastMessenger }: AISearchPanelProps) {
  const store = useSidebarStore();
  const filterQuery = store.filterQuery();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasSelection = store.hasSelectedAnnotations();
  const [reductoAPIKey, setReductoAPIKey] = useState('');

  const clearSearch = () => {
    store.closeSidebarPanel('aiSearchAnnotations');
  };

//   const firstPDFURI = (candidateURIs: string[]): string | null => {
//     for (const uri of candidateURIs) {
//       if (uri.toLowerCase().endsWith('.pdf')) {
//         return uri;
//       }
//     }
//     return null;
//   };

  async function onAISearch(query: string) {
    try {
    const reductoResult = await reducto.AISearchDocument({
        query,
        candidateURIs: store.searchUris(),
        apiKey: reductoAPIKey,
    });
    console.log('reductoResult', reductoResult);

    const userid = store.profile().userid;
    const groupId = store.focusedGroupId();
    const documentURL = reducto.firstPDFURI(store.searchUris());

    console.log('userid, groupId, documentURL', userid, groupId, documentURL);
    
    if (!userid || !groupId || !documentURL) {
        toastMessenger.error('Missing user, group, or PDF URL');
        return;
    }

    const quotes = ((reductoResult.answer as any).result?.[0]?.quotes ?? []) as
      Array<{ text?: string }>;
    console.log('quotes', quotes);

    const created = [];
    for (const quote of quotes) {
      if (!quote.text?.trim()) {
        continue;
      }
      console.log('quote.text', quote.text);
      const payload = {
        group: groupId,
        uri: documentURL,
        target: [{ source: documentURL, selector: [{ type: 'TextQuoteSelector', exact: quote.text }] }],
        text: query,
        tags: ['ai',],
        permissions: sharedPermissions(userid, groupId),
      };
      const ann = await api.annotation.create({}, payload);
      created.push(ann);
      console.log('created', created);
    }
    if (created.length) {
      store.addAnnotations(created);
    }
    toastMessenger.success(`Created ${created.length} annotation(s) from AI results.`);
    // const hypResults = await api.search({
    //   any: query,            // or use a quote from reductoResult
    //   uri: pdfURI,
    //   limit: 20,
    //   offset: 0,
    // });
    // console.log('hypothesisSearchResults', hypResults);
    } catch (error) {
      console.error('Error creating annotations from AI results:', error);
      toastMessenger.error('Failed to create annotations from AI results.');
    }
  }

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
          <div className="flex flex-col gap-y-3">
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
            //   onSearch={query => reducto.AISearchDocument({
            //     query,
            //     candidateURIs: store.searchUris(),
            //     apiKey: reductoAPIKey,
            //   })} 
              onSearch={onAISearch}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  clearSearch();
                }
              }}
            />
            <Input
              aria-label="Reducto API key"
              classes="text-base touch:text-touch-base"
              data-testid="reducto-api-key-input"
              dir="auto"
              name="reducto-api-key"
              placeholder="REDUCTO_API_KEY"
              type="password"
              value={reductoAPIKey}
              onInput={(e: Event) =>
                setReductoAPIKey((e.target as HTMLInputElement).value)
              }
            />
          </div>
          <FilterControls />
        </CardContent>
      </Card>
    </SidebarPanel>
  );
}

export default withServices(AISearchPanel, ['reducto', 'api', 'toastMessenger']);