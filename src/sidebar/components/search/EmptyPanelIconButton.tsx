import { ListIcon } from '@hypothesis/frontend-shared';
import { useCallback } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import TopBarToggleButton from '../TopBarToggleButton';

export default function EmptyPanelIconButton() {
  const store = useSidebarStore();
  const isPanelOpen = store.isSidebarPanelOpen('emptyPanel');

  const togglePanel = useCallback(() => {
    store.toggleSidebarPanel('emptyPanel');
  }, [store]);

  return (
    <TopBarToggleButton
      icon={ListIcon}
      expanded={isPanelOpen}
      pressed={isPanelOpen}
      onClick={togglePanel}
      title="Show empty panel"
    />
  );
}
