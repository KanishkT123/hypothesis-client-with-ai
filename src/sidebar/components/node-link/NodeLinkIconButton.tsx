import { GraphIcon } from '@hypothesis/frontend-shared';
import { useCallback } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import TopBarToggleButton from '../TopBarToggleButton';

export default function NodeLinkIconButton() {
  const store = useSidebarStore();
  const isPanelOpen = store.isSidebarPanelOpen('nodeLinkAnnotations');

  const togglePanel = useCallback(() => {
    store.toggleSidebarPanel('nodeLinkAnnotations');
  }, [store]);

  return (
    <TopBarToggleButton
      icon={GraphIcon}
      expanded={isPanelOpen}
      pressed={isPanelOpen}
      onClick={togglePanel}
      title="Show node-link panel"
    />
  );
}
