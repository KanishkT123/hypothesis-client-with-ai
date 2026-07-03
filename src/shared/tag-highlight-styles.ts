import { highlightTagClass } from './highlight-tag-class';

/**
 * Injected `<style>` for tag-based highlight colors (HTML + PDF SVG).
 *
 * Call {@link applyTagHighlightPalette} with the full map whenever it changes.
 */

const STYLE_ID = 'hypothesis-dynamic-tag-highlight-rules';

function normalizePDFHighlightCompositing(targetDocument: Document): void {
  let layerCount = 0;
  for (const layer of targetDocument.querySelectorAll(
    '.hypothesis-highlight-layer, .hypothesis-tag-highlight-layer',
  )) {
    (layer as SVGElement).style.mixBlendMode = 'normal';
    layerCount += 1;
  }
  // #region agent log
  if (layerCount > 0) {
    const w = window as Window & { __h1f2N?: { n: number; t: number } };
    const s = w.__h1f2N ?? (w.__h1f2N = { n: 0, t: Date.now() });
    s.n += layerCount;
    const now = Date.now();
    if (now - s.t >= 3000) {
      fetch('http://127.0.0.1:7435/ingest/74e7273a-8561-44e5-a847-987878e88c59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1f2ec9'},body:JSON.stringify({sessionId:'1f2ec9',location:'tag-highlight-styles.ts:normalizePDFHighlightCompositing',message:'compositing-batch',data:{layerTouches:s.n},timestamp:now,hypothesisId:'F',runId:'rest-flicker-1'})}).catch(()=>{});
      s.n = 0;
      s.t = now;
    }
  }
  // #endregion
}

/**
 * Portion of `--highlight-color` mixed with black for `--highlight-color-focused`
 * (darker when selected / easier to see on light PDFs). Higher → closer to base;
 * lower → more black. ~70–82 is typical.
 * Uses CSS `color-mix()` (no JS color parsing). Requires modern browsers.
 */
const FOCUS_COLOR_MIX_PERCENT = 78;
// TODO: Restore clustered mode toggle once clustered highlight styling and
// multi-tag PDF overlays are compatible.
// const clusteredModeActive = false;

/**
 * Replaces the injected stylesheet from this map only. Tags omitted from the map
 * are not overridden (cluster defaults from `highlights.scss` apply), as long as
 * you don’t add empty rules—here we only emit rules for each palette entry.
 */
export function applyTagHighlightPalette(
  targetDocument: Document,
  palette: Record<string, string>,
): void {
  let style = targetDocument.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = targetDocument.createElement('style');
    style.id = STYLE_ID;
    targetDocument.head.appendChild(style);
  }

  const lines: string[] = [
    `.hypothesis-highlights-always-on .hypothesis-highlight.h-row-hidden,` +
    ` .hypothesis-highlights-always-on .hypothesis-svg-highlight.h-row-hidden,` +
    ` .hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.h-row-hidden` +
    ` { opacity: 0 !important; pointer-events: none !important; }`,
  ];
  for (const [rawTag, rgba] of Object.entries(palette).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const tag = rawTag.trim();
    if (!tag || !rgba?.trim()) {
      continue;
    }
    const cls = highlightTagClass(tag);
    const legacySelector = [
      `.hypothesis-highlights-always-on .hypothesis-highlight.${cls}`,
      `.hypothesis-highlights-always-on .hypothesis-svg-highlight.${cls}`,
    ].join(', ');
    const base = rgba.trim();
    lines.push(
      `${legacySelector} { --highlight-color: ${base}; --highlight-color-focused: color-mix(in srgb, var(--highlight-color) ${FOCUS_COLOR_MIX_PERCENT}%, black); }`,
    );

    // TODO: Restore clustered mode branch once clustered highlight styling and
    // multi-tag PDF overlays are compatible.
    // if (!clusteredModeActive) {
    //   lines.push(
    //     `.hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.${cls} { --highlight-overlay-color: ${base}; fill: var(--highlight-overlay-color); }`,
    //   );
    // }
    lines.push(
      `.hypothesis-highlights-always-on .hypothesis-svg-highlight-overlay.${cls} { --highlight-overlay-color: ${base}; fill: var(--highlight-overlay-color); }`,
    );
  }
  const css = lines.join('\n');
  if (style.textContent === css) {
    // #region agent log
    {const w=window as Window&{__h1f2P?:{s:number,t:number}};const s=w.__h1f2P??(w.__h1f2P={s:0,t:Date.now()});s.s+=1;const now=Date.now();if(now-s.t>=3000){fetch('http://127.0.0.1:7435/ingest/74e7273a-8561-44e5-a847-987878e88c59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1f2ec9'},body:JSON.stringify({sessionId:'1f2ec9',location:'tag-highlight-styles.ts:applyTagHighlightPalette',message:'palette-skipped-batch',data:{skipped:s.s},timestamp:now,hypothesisId:'A',runId:'rest-flicker-1'})}).catch(()=>{});s.s=0;s.t=now}}
    // #endregion
    normalizePDFHighlightCompositing(targetDocument);
    return;
  }
  style.textContent = css;
  // #region agent log
  {const w=window as Window&{__h1f2A?:{a:number,t:number}};const s=w.__h1f2A??(w.__h1f2A={a:0,t:Date.now()});s.a+=1;const now=Date.now();if(now-s.t>=3000){fetch('http://127.0.0.1:7435/ingest/74e7273a-8561-44e5-a847-987878e88c59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1f2ec9'},body:JSON.stringify({sessionId:'1f2ec9',location:'tag-highlight-styles.ts:applyTagHighlightPalette',message:'palette-applied-batch',data:{applied:s.a},timestamp:now,hypothesisId:'A',runId:'rest-flicker-1'})}).catch(()=>{});s.a=0;s.t=now}}
  // #endregion

  normalizePDFHighlightCompositing(targetDocument);
}
