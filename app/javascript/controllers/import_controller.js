import { Controller } from "@hotwired/stimulus"

/**
 * Thin mount point for the React @pretextbook/import wizard used on the
 * new-project page. Mirrors editor_controller/tryit_controller's mount shape:
 * dynamically import the React bundle, render into the `root` target, and
 * unmount on disconnect.
 *
 * @extends {Controller}
 */
export default class extends Controller {
  static targets = ["root"]
  static values = { createUrl: String }

  /** @returns {void} */
  initialize() {
    /** @type {Promise<typeof import("./react/import")>} */
    this.componentPromise = import("./react/import")
  }

  /** @returns {Promise<void>} */
  async connect() {
    this.component = await this.componentPromise
    this.component.render(this.rootTarget, {
      createUrl: this.createUrlValue,
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content,
    })
  }

  /** @returns {void} */
  disconnect() {
    this.component?.destroy(this.rootTarget)
  }
}
