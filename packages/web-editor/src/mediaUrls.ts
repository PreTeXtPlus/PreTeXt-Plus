/**
 * Recognising a pasted link to something PreTeXt can frame, and writing the
 * element for it.
 *
 * An author who copies a Desmos graph's share link, a GeoGebra activity's or a
 * YouTube video's address wants that thing in the document, and what PreTeXt
 * wants is not the link but the id inside it. Pasted where a block belongs,
 * such a link arrives as the element (see `pasteConvert.ts`); pasted into
 * running text, or with Ctrl+Shift+V, it stays the link it is.
 *
 * Only a paste that is *nothing but* one such link is recognised: a link in the
 * middle of a sentence is prose. And only addresses whose id is certain — an
 * address this does not know is left alone rather than guessed at.
 */

/** What a link points at, as PreTeXt names it. */
export type MediaKind = "desmos" | "geogebra" | "youtube";

export interface MediaLink {
  kind: MediaKind;
  /** The graph, material or video id. */
  id: string;
  /** Where a video should start, in whole seconds, when the link said. */
  start?: number;
}

/** Ids are spliced into an attribute, so only what the services really use. */
const DESMOS_ID = /^[a-z0-9]{6,20}$/;
const GEOGEBRA_ID = /^[A-Za-z0-9]{6,12}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** GeoGebra's apps, each of which opens a material at `/<app>/<id>`. */
const GEOGEBRA_APPS = new Set([
  "m", "calculator", "classic", "graphing", "geometry", "3d", "cas", "scientific", "suite",
]);

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds; undefined for anything else. */
function seconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!parts || !parts[0]) return undefined;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/**
 * What `text` links to, when it is exactly one link to a Desmos graph, a
 * GeoGebra material or a YouTube video — else undefined.
 */
export function parseMediaLink(text: string): MediaLink | undefined {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const path = url.pathname.split("/").filter(Boolean);

  if (host === "desmos.com") {
    // Only the graphing calculator: `@desmos` always frames `/calculator/<id>`.
    if (path.length === 2 && path[0] === "calculator" && DESMOS_ID.test(path[1])) {
      return { kind: "desmos", id: path[1] };
    }
    return undefined;
  }

  if (host === "geogebra.org" || host === "ggbm.at") {
    let id: string | undefined;
    if (host === "ggbm.at") {
      if (path.length === 1) id = path[0];
    } else if (path.length === 2 && GEOGEBRA_APPS.has(path[0])) {
      id = path[1];
    } else if (path[0] === "material" && path[2] === "id") {
      // `/material/show/id/<id>` and `/material/iframe/id/<id>/…`.
      id = path[3];
    }
    return id && GEOGEBRA_ID.test(id) ? { kind: "geogebra", id } : undefined;
  }

  let video: string | undefined;
  if (host === "youtu.be") {
    if (path.length === 1) video = path[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (path.length === 1 && path[0] === "watch") {
      video = url.searchParams.get("v") ?? undefined;
    } else if (path.length === 2 && ["embed", "shorts", "live", "v"].includes(path[0])) {
      video = path[1];
    }
  }
  if (!video || !YOUTUBE_ID.test(video)) return undefined;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { kind: "youtube", id: video, ...(start ? { start } : {}) };
}

/**
 * The PreTeXt element for `link`, sized as the Insert menu's are. No
 * `xml:id`: PreTeXt names the element itself, and an invented one could
 * collide with an id the project already uses.
 */
export function mediaElement(link: MediaLink): string {
  switch (link.kind) {
    case "desmos":
      return `<interactive desmos="${link.id}" width="80%" aspect="4:3"/>`;
    case "geogebra":
      return `<interactive geogebra="${link.id}" width="80%" aspect="4:3"/>`;
    case "youtube":
      return `<video youtube="${link.id}"${link.start ? ` start="${link.start}"` : ""} width="80%"/>`;
  }
}
