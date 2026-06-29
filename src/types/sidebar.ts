/**
 * Type definitions for the sidebar
 */

/**
 * Defined panel components available in the sidebar.
 */
export type PanelName =
  | 'help'
  | 'loginPrompt'
  | 'shareGroupAnnotations'
  | 'searchAnnotations'
  | 'aiSearchAnnotations'
  | 'nodeLinkAnnotations'
  | 'emptyPanel';

/**
 * The top-level tabs in the sidebar interface. Used to reference which tab
 * is currently selected (active/visible).
 */
export type TabName = 'annotation' | 'note' | 'orphan';
