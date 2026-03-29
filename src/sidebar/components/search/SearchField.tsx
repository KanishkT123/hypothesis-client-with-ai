import {
  Button,
  CancelIcon,
  IconButton,
  Input,
  SearchIcon,
  useSyncedRef,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import type { RefObject, JSX } from 'preact';
import { useState } from 'preact/hooks';

import { useShortcut } from '../../../shared/shortcut';
import { useShortcutsConfig } from '../../../shared/shortcut-config';
import { useSidebarStore } from '../../store';

export type SearchFieldProps = {
  /** The currently-active filter query */
  query: string | null;

  onClearSearch: () => void;

  /** Disable input editing or submitting the search field. */
  disabled?: boolean;

  /** Callback for when the current filter query changes */
  onSearch: (value: string) => void | Promise<void>;

  /** Callback for when a key is pressed in the input itself */
  onKeyDown?: JSX.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;

  /** The input or textarea ref object, in case it needs to be handled by consumers */
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;

  /** Classes to be added to the outermost element */
  classes?: string | string[];

  /** Placeholder when the field is empty and not loading */
  placeholder?: string;

  /** When true, use a multiline textarea instead of a single-line input. */
  multiline?: boolean;

  /** Visible rows for the textarea when `multiline` is true. Defaults to 4. */
  rows?: number;

  /**
   * When set, hides the left search icon and renders a full-width submit button
   * below the field with this label (e.g. AI search panel).
   */
  fullWidthSubmitLabel?: string;
};

/**
 * An input field for entering a query that filters annotations (in the sidebar)
 * or searches annotations (in the stream/single annotation view).
 */
export default function SearchField({
  classes,
  disabled = false,
  fullWidthSubmitLabel,
  inputRef,
  multiline = false,
  onClearSearch,
  onKeyDown,
  onSearch,
  placeholder = 'Search…',
  query,
  rows = 4,
}: SearchFieldProps) {
  const store = useSidebarStore();
  const isLoading = store.isLoading();
  const input = useSyncedRef(inputRef);
  const shortcuts = useShortcutsConfig();

  const useAiSubmitLayout = Boolean(fullWidthSubmitLabel);

  // The active filter query from the previous render.
  const [prevQuery, setPrevQuery] = useState(query);

  // The query that the user is currently typing, but may not yet have applied.
  const [pendingQuery, setPendingQuery] = useState(query);

  // As long as this input is mounted, pressing the "open search" shortcut
  // should make it recover focus
  useShortcut(shortcuts.openSearch, e => {
    if (document.activeElement !== input.current) {
      e.preventDefault();
      input.current?.focus();
    }
  });

  const commitSearch = () => {
    if (input.current?.value || prevQuery) {
      // Don't set an initial empty query, but allow a later empty query to
      // clear `prevQuery`
      onSearch(input.current?.value ?? '');
    }
  };

  const onSubmit = (e: Event) => {
    e.preventDefault();
    commitSearch();
  };

  const handleKeyDown = (
    e: JSX.TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) {
      return;
    }
    if (multiline && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitSearch();
    }
  };

  // When the active query changes outside of this component, update the input
  // field to match. This happens when clearing the current filter for example.
  if (query !== prevQuery) {
    setPendingQuery(query);
    setPrevQuery(query);
  }

  const fieldDisabled = disabled || isLoading;

  const textareaClasses = classnames(
    'w-full',
    useAiSubmitLayout ? 'pl-3 pr-10' : 'pl-8 pr-8',
    'disabled:text-grey-6',
    'text-base touch:text-touch-base',
    'min-h-[6rem] resize-y rounded border border-grey-3 bg-white py-2',
  );

  return (
    <form
      name="searchForm"
      onSubmit={onSubmit}
      className={classnames('space-y-3', classes)}
    >
      <div className="relative">
        {!useAiSubmitLayout && (
          <IconButton
            // Vertically center icon on left side of input. Increase the text
            // size to make it the same size as the top bar icons.
            classes="absolute left-0 text-[16px] top-[50%] translate-y-[-50%]"
            icon={SearchIcon}
            size="lg"
            title="Search"
            type="submit"
            disabled={disabled}
          />
        )}
        {multiline ? (
          <textarea
            aria-label="Search"
            className={textareaClasses}
            data-testid="search-input"
            dir="auto"
            name="query"
            placeholder={(isLoading && 'Loading…') || placeholder}
            disabled={fieldDisabled}
            ref={input as RefObject<HTMLTextAreaElement>}
            rows={rows}
            value={pendingQuery || ''}
            onInput={(e: Event) =>
              setPendingQuery((e.target as HTMLTextAreaElement).value)
            }
            onKeyDown={handleKeyDown}
          />
        ) : (
          <Input
            aria-label="Search"
            classes={classnames(
              'pl-8 pr-8',
              'disabled:text-grey-6',
              'text-base touch:text-touch-base',
            )}
            data-testid="search-input"
            dir="auto"
            name="query"
            placeholder={(isLoading && 'Loading…') || placeholder}
            disabled={fieldDisabled}
            elementRef={input as RefObject<HTMLInputElement>}
            value={pendingQuery || ''}
            onInput={(e: Event) =>
              setPendingQuery((e.target as HTMLInputElement).value)
            }
            onKeyDown={onKeyDown}
          />
        )}
        {pendingQuery && (
          <IconButton
            classes={classnames(
              'absolute right-0 text-[16px]',
              multiline ? 'top-2' : 'top-[50%] translate-y-[-50%]',
            )}
            size="lg"
            icon={CancelIcon}
            data-testid="clear-button"
            title="Clear search"
            onClick={onClearSearch}
            disabled={disabled}
          />
        )}
      </div>
      {useAiSubmitLayout && (
        <Button
          classes="w-full justify-center text-center"
          data-testid="search-submit-button"
          disabled={fieldDisabled}
          type="submit"
        >
          {fullWidthSubmitLabel}
        </Button>
      )}
    </form>
  );
}
