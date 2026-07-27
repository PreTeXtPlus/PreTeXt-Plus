import { Controller } from "@hotwired/stimulus"

/**
 * Closes the target drawer by emptying the turbo frame it was loaded into, so backing
 * out costs one Escape rather than a browser Back that would leave the dashboard.
 */
export default class extends Controller {
  connect() {
    this.onKeydown = (event) => {
      if (event.key === "Escape") this.close()
    }
    document.addEventListener("keydown", this.onKeydown)
  }

  disconnect() {
    document.removeEventListener("keydown", this.onKeydown)
  }

  close() {
    const frame = this.element.closest("turbo-frame")
    // Emptying the frame is safe in both places the drawer is rendered: the dashboard's
    // own frame, and the one projects/show renders inline when the URL is a target's.
    // Either way the project is underneath. Removing just the panel is the fallback for
    // a frameless render, which nothing currently does.
    if (frame) {
      frame.innerHTML = ""
      frame.removeAttribute("src")
    } else {
      this.element.remove()
    }
  }
}
