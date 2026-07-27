import { StreamActions } from "@hotwired/turbo"

/**
 * `reload_drawer`: tells whoever has a given target's drawer open to go and re-fetch it.
 *
 * Target#broadcast_drawer sends this instead of the drawer's HTML. The drawer carries a
 * build log and a history table, neither of which has an upper bound -- FullBuildLogJob
 * replaces the 4000-char tail with the *whole* server-side log once a build finishes --
 * and pushing that through Action Cable means a multi-megabyte message on a hot path. In
 * development it means no message at all: cable.yml uses Postgres LISTEN/NOTIFY there,
 * which rejects any payload over ~8000 bytes, inside a background job, silently.
 *
 * So the broadcast is a signal, and the content comes back over ordinary HTTP: no size
 * limit, gzipped, and -- unlike a background render -- with the author's own session, so
 * the drawer can go on using `request` and could use `can?` if it ever needs to.
 *
 * The stream's target is the panel's per-target id rather than the frame's, because every
 * dashboard watching a project carries a "drawer" frame and only some of them have *this*
 * target open. Missing id -> empty targetElements -> no-op, which is exactly the wanted
 * behaviour for a closed drawer or one showing a different output.
 */
StreamActions.reload_drawer = function () {
  this.targetElements.forEach((panel) => {
    const frame = panel.closest("turbo-frame")
    if (!frame) return

    if (frame.src) {
      // reload() re-fetches the frame's src, and morphs rather than replaces because the
      // frame is marked refresh="morph" -- so the panel's elements survive the refresh
      // instead of being rebuilt, and a scroll position inside it (the build log has its
      // own scroll box, and is exactly what an author is reading when the next status
      // arrives) is still where they left it. Note that morphing a *frame* does not
      // preserve the value of a focused input the way a full-page morph refresh does:
      // Turbo passes ignoreActiveValue only on the latter.
      frame.reload()
    } else if (panel.dataset.drawerUrl) {
      // No src to reload: something re-rendered the frame element and dropped it, which
      // would otherwise leave this drawer deaf to every later build. Setting src is
      // itself a load, so this both repairs the frame and performs the refresh -- as a
      // plain render rather than a morph, which is the right trade for a path that
      // should not be reached.
      frame.src = panel.dataset.drawerUrl
    }
  })
}
