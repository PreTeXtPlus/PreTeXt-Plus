import { Controller } from "@hotwired/stimulus"

/**
 * Copies a value to the clipboard and says so, for the published URL in the target
 * drawer -- the one string on the page an author is there to take somewhere else.
 *
 * The button reverts to its original label after a moment rather than staying
 * confirmed, so a second copy still gives feedback.
 */
export default class extends Controller {
  static targets = ["source", "button"]
  static values = { revertAfter: { type: Number, default: 2000 } }

  copy() {
    const text = this.sourceTarget.textContent.trim()

    // navigator.clipboard is unavailable on insecure origins, and can reject if the
    // document is not focused. Either way the author still has the URL on screen to
    // select by hand, so failing quietly beats an alert.
    navigator.clipboard?.writeText(text).then(
      () => this.#confirm("Copied"),
      () => this.#confirm("Press ⌘C")
    )
  }

  #confirm(message) {
    if (!this.hasButtonTarget) return

    this.original ??= this.buttonTarget.textContent
    this.buttonTarget.textContent = message
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.buttonTarget.textContent = this.original
    }, this.revertAfterValue)
  }

  disconnect() {
    clearTimeout(this.timeout)
  }
}
