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
    // Falls back to removing the panel itself when rendered outside a frame
    // (a direct link to the drawer URL with JS enabled).
    if (frame) {
      frame.innerHTML = ""
      frame.removeAttribute("src")
    } else {
      this.element.remove()
    }
  }
}
