import { Controller } from "@hotwired/stimulus"
import { session } from "@hotwired/turbo"

/**
 * Attached to a `turbo_stream_from` source. Action Cable does not replay a broadcast
 * missed while a subscription is down (see BuildRecheckJob's comment for the long
 * version), so a build that finishes during a drop -- a deploy restarting this app's
 * container, a laptop waking from sleep, a flaky network -- leaves the dashboard
 * showing whatever it last rendered until something else nudges it. BuildRecheckJob
 * covers that server-side by re-broadcasting for a while, but only for a while, and
 * only for builds; this covers it client-side, for anything the stream carries, by
 * asking Turbo to morph the page back in from the server the moment the subscription
 * that just dropped comes back.
 *
 * `<turbo-cable-stream-source>` (turbo-rails) toggles a `connected` attribute itself
 * as its Action Cable subscription connects and disconnects, so a MutationObserver on
 * that attribute is a reconnect signal for free -- no custom channel work needed. The
 * first time it appears is just the page loading, not a reconnect, so that one is
 * skipped; every appearance after a disappearance is treated as a reconnect.
 */
export default class extends Controller {
  connect() {
    this.hasConnectedBefore = false
    this.observer = new MutationObserver(this.connectionChanged.bind(this))
    this.observer.observe(this.element, { attributes: true, attributeFilter: [ "connected" ] })
  }

  disconnect() {
    this.observer?.disconnect()
  }

  connectionChanged() {
    if (!this.element.hasAttribute("connected")) return

    if (this.hasConnectedBefore) {
      // Same repair the drawer frame performs on itself in stream_actions.js, sized up
      // to the whole page: morph, so nothing not related to this stream's data moves.
      session.refresh(document.baseURI, { method: "morph", scroll: "preserve" })
    }
    this.hasConnectedBefore = true
  }
}
