import { useEffect } from 'preact/hooks';

import { PUBLIC_GROUP_ID } from '../../helpers/groups';
import { savedAnnotationsForCurrentDocument } from '../../services/tag-inventory-group-sync';
import type { TagInventoryGroupSyncService } from '../../services/tag-inventory-group-sync';
import { withServices } from '../../service-context';
import { useSidebarStore } from '../../store';
import SidebarPanel from '../SidebarPanel';

type EmptyPanelProps = {
  tagInventoryGroupSync: TagInventoryGroupSyncService;
};

function EmptyPanel({ tagInventoryGroupSync }: EmptyPanelProps) {
  const store = useSidebarStore();
  const focusedGroupId = store.focusedGroupId();
  const isPanelOpen = store.isSidebarPanelOpen('emptyPanel');

  useEffect(() => {
    if (!isPanelOpen || !focusedGroupId) {
      return;
    }
    if (focusedGroupId === PUBLIC_GROUP_ID) {
      const annotations = savedAnnotationsForCurrentDocument(
        store.savedAnnotations(),
        focusedGroupId,
        store.searchUris(),
      );
      console.log('EmptyPanel group annotations:', annotations);
    } else {
      tagInventoryGroupSync.getGroupAnnotations(focusedGroupId).then(annotations => {
        console.log('EmptyPanel group annotations:', annotations);
      }).catch(err => {
        console.error('EmptyPanel: failed to fetch group annotations', err);
      });
    }
  }, [isPanelOpen, focusedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SidebarPanel panelName="emptyPanel" label="Empty panel" />;
}

export default withServices(EmptyPanel, ['tagInventoryGroupSync']);
