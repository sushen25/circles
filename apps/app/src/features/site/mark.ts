import { t, type Copy } from '../../copy';
import { escapeHtml } from '../../data/preview';
import { MARK_MASTER, MARK_MASTER_FILL } from './mark.generated';

/** A key of the site's copy namespace. */
export type SiteKey = keyof Copy['site'];

/** Copy for the page: filled, then escaped, because it is going into HTML. */
export function text(key: SiteKey): string {
  return escapeHtml(t('site', key));
}

/**
 * The mark, from the master in `assets/brand/` (via `pnpm gen:brand`), at
 * `size` px and in `fill`. Recoloured the way `gen-brand-assets.ts` recolours
 * it for the dark icon; the geometry is never redrawn.
 */
export function markSvg(size: number, fill: string = MARK_MASTER_FILL): string {
  return MARK_MASTER.replaceAll(MARK_MASTER_FILL, fill)
    .replace(/ width="\d+" height="\d+"/, ` width="${size}" height="${size}"`)
    .replace('<svg ', '<svg focusable="false" aria-hidden="true" ');
}
