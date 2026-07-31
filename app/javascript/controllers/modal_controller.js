import { Controller } from "@hotwired/stimulus"

/**
 * The publisher-settings dialog. Closes by emptying the turbo frame it was loaded into --
 * the same trick drawer_controller uses, and separate from it because a modal takes focus
 * and a drawer does not.
 *
 * Focus moves to the first control on open so the dialog is usable from the keyboard, and
 * because leaving it on the button behind the backdrop means Escape and Tab both go
 * somewhere surprising.
 */
export default class extends Controller {
  connect() {
    this.onKeydown = (event) => {
      if (event.key === "Escape") this.close()
    }
    document.addEventListener("keydown", this.onKeydown)

    this.element.querySelector("select, input, button")?.focus()
  }

  disconnect() {
    document.removeEventListener("keydown", this.onKeydown)
  }

  close() {
    const frame = this.element.closest("turbo-frame")
    // Emptying rather than removing, so the frame stays in the layout ready for the next
    // open. Removing just the panel is the fallback for a frameless render, which nothing
    // currently does.
    if (frame) {
      frame.innerHTML = ""
      frame.removeAttribute("src")
    } else {
      this.element.remove()
    }
  }
}
