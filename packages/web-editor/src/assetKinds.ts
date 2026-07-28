import type { AssetKind } from "./types/editor";

/**
 * Feature flag: Doenet assets are not yet fully implemented, so they are
 * hidden from the UI for now. Flip to `true` to re-enable creating and
 * browsing Doenet activities throughout the editor.
 *
 * Note: this only gates the user-facing entry points. The underlying
 * plumbing (asset transforms, `<plus:doenet>` placeholder parsing, the
 * `AssetKind` type) stays intact so existing documents still round-trip.
 */
export const SHOW_DOENET = false;

/** Display labels for each asset kind, used in pickers and grouping headers. */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  image: "Images",
  doenet: "Doenet",
};

/** Canonical display order of every asset kind. */
const ALL_ASSET_KINDS: AssetKind[] = ["image", "doenet"];

/**
 * Asset kinds that should be surfaced in the UI, honoring feature flags such
 * as {@link SHOW_DOENET}. Use this anywhere you list or group asset kinds for
 * the user, rather than hard-coding the full set.
 */
export const VISIBLE_ASSET_KINDS: AssetKind[] = ALL_ASSET_KINDS.filter(
  (kind) => kind !== "doenet" || SHOW_DOENET,
);
