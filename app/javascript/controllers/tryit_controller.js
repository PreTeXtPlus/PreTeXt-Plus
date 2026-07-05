import { Controller } from "@hotwired/stimulus"

/**
 * Thin mount point for the anonymous /tryit demo editor (no persistence, no
 * assets). Mirrors editor_controller's mount/unmount shape.
 *
 * @extends {Controller}
 */
export default class extends Controller {
  static values = {
    project: Object,
  }

  /** Load the React bundle as soon as the controller initializes.
   * @returns {void}
   */
  initialize() {
    /** @type {Promise<typeof import("./react/tryit")>} */
    this.componentPromise = import("./react/tryit")
  }

  /**
   * Fire a couple of `resize` events so layout libraries inside the mounted
   * React app (e.g. CodeMirror) re-measure themselves after mount.
   * @returns {void}
   */
  notifyLayoutChange() {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"))
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"))
      })
    })
  }

  /** @returns {Promise<void>} */
  async connect() {
    this.component = await this.componentPromise

    const root = this.targets.find("root")
    this.component.render(root, {
      project: this.projectValue,
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content,
    })

    this.notifyLayoutChange()
  }

  /** @returns {void} */
  disconnect() {
    const root = this.targets.find("root")
    this.component?.destroy(root)
  }
}
