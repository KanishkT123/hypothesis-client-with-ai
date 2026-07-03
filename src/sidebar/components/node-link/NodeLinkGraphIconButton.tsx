import type { JSX } from 'preact';
import { useCallback } from 'preact/hooks';

import type { SidebarSettings } from '../../../types/config';
import { withServices } from '../../service-context';
import { useSidebarStore } from '../../store';
import TopBarToggleButton from '../TopBarToggleButton';

export type NodeLinkGraphIconButtonProps = {
  settings: SidebarSettings;
};

function NodeLinkIcon(props: JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M4.2 4.8 7.6 8m0 0 4.2-4.1M7.6 8l3.6 3.7M7.6 8l-3.4 3.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <circle cx="3.2" cy="3.9" r="2" fill="currentColor" />
      <circle cx="12.8" cy="3" r="2" fill="currentColor" />
      <circle cx="12.3" cy="12.8" r="2" fill="currentColor" />
      <circle cx="3.2" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function extensionNodeLinkUrl() {
  const url = new URL(window.location.href);
  if (url.protocol !== 'chrome-extension:') {
    return null;
  }
  return new URL('node-link.html', url).toString();
}

function NodeLinkGraphIconButton({ settings }: NodeLinkGraphIconButtonProps) {
  const store = useSidebarStore();
  const groupId = store.focusedGroupId();
  const documentUri = store.searchUris()[0] || store.mainFrame()?.uri || '';
  const nodeLinkAppUrl = settings.nodeLinkAppUrl || extensionNodeLinkUrl();

  const openGraph = useCallback(() => {
    if (!nodeLinkAppUrl) {
      return;
    }

    const url = new URL(nodeLinkAppUrl);
    if (groupId) {
      url.searchParams.set('group', groupId);
    }
    if (documentUri) {
      url.searchParams.set('uri', documentUri);
    }
    window.open(url.toString(), '_blank', 'noopener');
  }, [documentUri, groupId, nodeLinkAppUrl]);

  if (!nodeLinkAppUrl) {
    return null;
  }

  return (
    <TopBarToggleButton
      icon={NodeLinkIcon}
      expanded={false}
      pressed={false}
      onClick={openGraph}
      title="Open node-link graph in a new tab"
      data-testid="node-link-graph-icon-button"
    />
  );
}

export default withServices(NodeLinkGraphIconButton, ['settings']);
