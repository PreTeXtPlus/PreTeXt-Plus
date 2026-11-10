import { createContext } from "react";

/**
 * The element a dialog opened from somewhere cramped — the top bar, or inside
 * another dialog — portals its overlay into, so it covers the whole editor.
 * `DialogOverlay` is `absolute inset-0`, so rendered in place it only covers
 * its nearest positioned ancestor. `Editors` provides its root; with no
 * provider (a standalone component) the dialog renders in place.
 */
export const DialogHostContext = createContext<HTMLElement | null>(null);
