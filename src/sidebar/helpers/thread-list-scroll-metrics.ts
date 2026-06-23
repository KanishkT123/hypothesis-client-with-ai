// The precision of the `scrollPosition` value in pixels; values will be rounded
// down to the nearest multiple of this scale value
export const THREAD_LIST_SCROLL_PRECISION = 50;

export function roundThreadListScrollPosition(pos: number) {
  return Math.max(pos - (pos % THREAD_LIST_SCROLL_PRECISION), 0);
}

export type ThreadListScrollMetrics = {
  scrollPosition: number;
  viewportHeight: number;
  listTopOffset: number;
};

export function measureThreadListScrollMetrics(
  scrollContainer: Element,
  listRoot: Element | null,
): ThreadListScrollMetrics {
  const container = scrollContainer as HTMLElement;
  const rootScrollTop = container.scrollTop;
  const containerRect = container.getBoundingClientRect();
  const listTopWithinContainer =
    listRoot === null
      ? 0
      : listRoot.getBoundingClientRect().top - containerRect.top;
  const listTopOffset = Math.max(0, listTopWithinContainer + rootScrollTop);

  // For virtualization math, use list-relative scroll offsets. This keeps
  // visibility calculations stable when widgets above the list grow/shrink.
  const effectiveScrollPosition = Math.max(0, rootScrollTop - listTopOffset);
  const visibleHeight = Math.max(
    0,
    container.clientHeight - Math.max(0, listTopWithinContainer),
  );

  return {
    scrollPosition: roundThreadListScrollPosition(effectiveScrollPosition),
    viewportHeight: visibleHeight,
    listTopOffset,
  };
}
