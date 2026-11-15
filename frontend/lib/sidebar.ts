/**
 * Desktop sidebar layout: its width (dragged by the edge handle) and whether it is collapsed to
 * an icon rail. Kept in localStorage per browser; every access is wrapped because storage can be
 * unavailable (private windows, blocked site data), in which case the defaults apply.
 */

export const SIDEBAR_STORAGE_KEY = "sp-sidebar";
export const SIDEBAR_DEFAULT_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_COLLAPSED_WIDTH = 68;
/** Arrow-key step for the resize handle. */
export const SIDEBAR_KEY_STEP = 16;

export type SidebarLayout = { width: number; collapsed: boolean };

export const DEFAULT_SIDEBAR: SidebarLayout = { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

export function readSidebar(): SidebarLayout {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SIDEBAR;
    const { width, collapsed } = parsed as { width?: unknown; collapsed?: unknown };
    return {
      width: typeof width === "number" ? clampSidebarWidth(width) : SIDEBAR_DEFAULT_WIDTH,
      collapsed: collapsed === true,
    };
  } catch {
    return DEFAULT_SIDEBAR;
  }
}

export function writeSidebar(layout: SidebarLayout): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ width: clampSidebarWidth(layout.width), collapsed: layout.collapsed }),
    );
  } catch {
    // Not persisted; the layout still applies for this page view.
  }
}
