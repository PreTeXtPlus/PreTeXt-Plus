import { Controller } from "@hotwired/stimulus"
import { session } from "@hotwired/turbo"

/**
 * Refreshes the element it's attached to on a fixed interval, while `active`. This is
 * the dashboard's only way of noticing a build finished -- see Build#mark! and
 * BuildRecheckJob, neither of which broadcasts anymore, for why: everything about a
 * build used to reach the page by being pushed over Action Cable, and every hop in that
 * chain (a missed webhook, a stalled import, a dropped or silently-dead cable
 * subscription) was a place a row could go stale with nothing to notice. Asking the
 * server again on a timer sidesteps the whole chain rather than patching another link
 * in it.
 *
 * Attach inside a `<turbo-frame>` (the drawer's panel) and it reloads the nearest one,
 * which is what makes it morph rather than rebuild -- see refresh="morph" on that frame.
 * On the panel rather than the frame itself: a rebuild started from inside the drawer
 * re-renders the panel via turbo_stream.update, which never touches the frame element's
 * own attributes, so a value that has to come back fresh on every render has to live on
 * something that actually gets re-rendered (see targets/_drawer.html.erb).
 *
 * Attach anywhere else (the outputs list) and it asks Turbo to morph the whole page back
 * in from the server, the same call stream_reconnect_controller.js used to make on a
 * cable reconnect. Either way, `active` is expected to come back from the server with
 * each refresh -- once nothing is left building, the next render carries active="false"
 * and polling stops on its own.
 */
export default class extends Controller {
  static values = { active: Boolean, interval: { type: Number, default: 5000 } }

  connect() {
    this.syncTimer()
  }

  activeValueChanged() {
    this.syncTimer()
  }

  disconnect() {
    this.stopTimer()
  }

  syncTimer() {
    if (this.activeValue) {
      this.timer ??= setInterval(() => this.refresh(), this.intervalValue)
    } else {
      this.stopTimer()
    }
  }

  stopTimer() {
    clearInterval(this.timer)
    this.timer = null
  }

  refresh() {
    const frame = this.element.closest("turbo-frame")
    if (frame) {
      frame.reload()
    } else {
      session.refresh(document.baseURI, { method: "morph", scroll: "preserve" })
    }
  }
}
