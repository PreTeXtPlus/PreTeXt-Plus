import { Controller } from "@hotwired/stimulus"

/**
 * Thin mount point for the React editor.  All data fetching, saving, autosave,
 * and preview/copy/feedback logic now lives in ./react/editor (powered by
 * TanStack Query).  This controller only mounts the React app, hands it the
 * config it needs, and unmounts on disconnect.
 *
 * @extends {Controller}
 */
export default class extends Controller {
  static values = { projectId: String, editorStateUrl: String }

  /** Load the React bundle as soon as the controller initializes.
   * @returns {void}
   */
  initialize() {
    /** @type {Promise<typeof import("./react/editor")>} */
    this.componentPromise = import("./react/editor")
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
      projectId: this.projectIdValue,
      apiBase: this.editorStateUrlValue,
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
