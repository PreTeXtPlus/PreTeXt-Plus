import { Controller } from "@hotwired/stimulus"

/**
 * Thin mount point for the read-only React editor used by the "share/source"
 * page. Unlike ./editor_controller.js, this never saves anything -- no
 * autosave, no PATCH, no collaboration -- so it fetches project state once
 * and mounts a lightweight host (./react/shared_source) around it.
 *
 * @extends {Controller}
 */
export default class extends Controller {
  static values = { projectId: String, sourceUrl: String, copyUrl: String }

  /** Load the React bundle as soon as the controller initializes.
   * @returns {void}
   */
  initialize() {
    /** @type {Promise<typeof import("./react/shared_source")>} */
    this.componentPromise = import("./react/shared_source")
  }

  /**
   * Fire a couple of `resize` events so layout libraries inside the mounted
   * React app (e.g. Monaco) re-measure themselves after mount.
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
      projectId: this.projectIdValue,
      sourceUrl: this.sourceUrlValue,
      copyUrl: this.copyUrlValue,
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
