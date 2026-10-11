import { PANEL_PX, SHEET_FRAC, WIDE_MIN_PX } from '../state/store';

/** Base vertical field of view; Warp punches it wider. */
export const BASE_FOV = 50;

/** HUD chrome that covers the canvas edges (CSS px): the top bar on every screen, the tab bar on phones. */
export const TOP_BAR_PX = 56;
export const TAB_BAR_PX = 64;

/** A rectangle of the canvas in CSS px, from its top-left corner. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let probe: HTMLDivElement | null = null;
/** Device safe-area insets (CSS px), which the HUD's phone bars grow by. Zero unless the page uses viewport-fit=cover. */
function safeArea(): { top: number; bottom: number } {
  if (typeof document === 'undefined' || !document.body) return { top: 0, bottom: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

/**
 * The part of a `width`×`height` canvas the HUD leaves visible: below the
 * top bar, left of the side panel on wide screens, and above the tab bar or
 * the open bottom sheet (which includes the tab bar) on phones. The camera
 * centres the rock in it and the comet flies inside it.
 */
export function visibleRect(width: number, height: number, sheet: boolean, out: ScreenRect = { x: 0, y: 0, w: 0, h: 0 }): ScreenRect {
  const wide = (typeof window !== 'undefined' ? window.innerWidth : width) >= WIDE_MIN_PX;
  const safe = wide ? { top: 0, bottom: 0 } : safeArea();
  const top = TOP_BAR_PX + safe.top;
  const right = wide ? PANEL_PX : 0;
  const bottom = wide ? 0 : Math.max(TAB_BAR_PX + safe.bottom, sheet ? height * SHEET_FRAC : 0);
  out.x = 0;
  out.y = top;
  // Never let the view collapse on tiny or landscape phone screens.
  out.w = Math.max(width * 0.3, width - right);
  out.h = Math.max(height * 0.18, height - top - bottom);
  return out;
}
