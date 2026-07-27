import { Controller } from "@hotwired/stimulus"

/**
 * Drives the three-card new-project chooser: each card opens a native
 * <dialog> (empty-document form, template picker, or import wizard). Dialogs
 * are matched by a `data-dialog-name` that the card's action param selects.
 *
 * @extends {Controller}
 */
export default class extends Controller {
  static targets = ["dialog"]

  connect() {
    // If the server re-rendered `new` with validation errors (a failed empty-
    // document create), reopen that dialog so the user sees the messages.
    if (this.element.dataset.openDialog) {
      this.showByName(this.element.dataset.openDialog)
    }
  }

  /** Open the dialog named by the `dialog` action param. */
  open(event) {
    this.showByName(event.params.dialog)
  }

  /** Close the dialog the clicked control lives in. */
  close(event) {
    event.target.closest("dialog")?.close()
  }

  showByName(name) {
    const dialog = this.dialogTargets.find((d) => d.dataset.dialogName === name)
    dialog?.showModal()
  }
}
