import { Controller } from "@hotwired/stimulus"

/**
 * Warns before switching a project to Private, since Project#unpublish_targets_if_private
 * fires the moment this form saves and takes every published output's public link down
 * with it. turbo_confirm can't express a warning that depends on which option the select
 * currently holds, so this intercepts submit instead.
 */
export default class extends Controller {
  static targets = [ "select" ]
  static values = { publishedCount: Number }

  confirm(event) {
    if (this.selectTarget.value !== "private" || this.publishedCountValue === 0) return

    const count = this.publishedCountValue
    const message = `Setting this project to Private will unpublish ${count} ` +
      `output${count === 1 ? "" : "s"} and break their public link${count === 1 ? "" : "s"}. Continue?`

    if (!window.confirm(message)) event.preventDefault()
  }
}
