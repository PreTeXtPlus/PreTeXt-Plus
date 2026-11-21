import { Controller } from "@hotwired/stimulus"

/**
 * The build settings' XML view: this level's publication XML, checked on the server before
 * it is saved.
 *
 * Mounted on the modal's form rather than on the view, because the one thing that makes it
 * necessary is the submit: XML the server would refuse is otherwise reported in a flash
 * after the modal -- and everything the author typed into it -- is gone. So a save with
 * changed XML is held, checked, and let through only if nothing would be refused.
 *
 * Only a save. The buttons that switch between the settings and the XML submit the same
 * form somewhere else (formaction), and the server answers those by drawing the modal
 * again with any problems in it.
 *
 * In the settings view there is no text to check -- the XML rides along in a hidden field
 * -- and every method here that needs the text finds no target and steps aside.
 */
export default class extends Controller {
  static targets = ["input", "issues", "status", "preview"]
  static values = { url: String }

  connect() {
    // What the server last said yes to. A submit whose XML still matches goes straight
    // through: unchanged text was already accepted when it was saved.
    this.accepted = this.hasInputTarget ? this.inputTarget.value : null
  }

  edited() {
    this.statusTarget.textContent = ""
  }

  async check() {
    await this.run()
  }

  async guard(event) {
    if (event.submitter?.hasAttribute("formaction")) return
    if (!this.hasInputTarget || this.inputTarget.value === this.accepted) return

    event.preventDefault()
    const result = await this.run()
    if (!result) return

    if (result.errors.length === 0) {
      this.accepted = this.inputTarget.value
      this.element.requestSubmit(event.submitter)
    } else {
      this.inputTarget.focus()
    }
  }

  // Answers with the server's verdict, or null if it could not be reached -- in which case
  // the status says so and nothing is submitted, since a save would only meet the same
  // trouble with the author's text in a flash instead of on screen.
  async run() {
    const body = new FormData(this.element)
    // The form is a PATCH (Rails' hidden _method); check is a POST of its own. Its token is
    // per-form -- good for that PATCH and nothing else -- so the page's goes in a header.
    body.delete("_method")
    body.delete("authenticity_token")
    const token = document.querySelector("meta[name=csrf-token]")?.content
    this.statusTarget.textContent = "Checking…"

    let result
    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        body,
        headers: { Accept: "application/json", "X-CSRF-Token": token },
        credentials: "same-origin",
      })
      if (!response.ok) throw new Error(`${response.status}`)
      result = await response.json()
    } catch {
      this.statusTarget.textContent = "Couldn't check the XML just now. Try again in a moment."
      return null
    }

    this.render(result)
    return result
  }

  render({ errors, warnings, preview }) {
    this.issuesTarget.replaceChildren(
      ...errors.map((issue) => this.item(issue, "text-red-700")),
      ...warnings.map((issue) => this.item(issue, "text-amber-700")),
    )
    this.previewTarget.textContent = preview

    if (errors.length) {
      this.statusTarget.textContent = `Not saved: ${this.count(errors.length, "problem")} to fix.`
    } else if (warnings.length) {
      this.statusTarget.textContent = `OK, with ${this.count(warnings.length, "warning")}.`
    } else {
      this.statusTarget.textContent = "Looks good."
    }
  }

  // textContent, never innerHTML: these messages quote what the author typed.
  item({ message, line }, color) {
    const li = document.createElement("li")
    li.className = color
    li.textContent = line ? `Line ${line}: ${message}` : message
    return li
  }

  count(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`
  }
}
