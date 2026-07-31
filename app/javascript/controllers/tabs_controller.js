import { Controller } from "@hotwired/stimulus"

/**
 * The publisher-settings tabs. Panels are hidden rather than unmounted, so every field
 * still submits with the form no matter which tab is open -- an author who sets a theme
 * and a page-sides option in one visit saves both.
 *
 * Selection lives entirely in aria-selected and the panels' `hidden`: Tailwind's
 * aria-selected: variant does the styling, so there is no class list here to keep in step
 * with the markup.
 */
export default class extends Controller {
  static targets = ["tab", "panel"]

  select(event) {
    this.show(this.tabTargets.indexOf(event.currentTarget))
  }

  // Arrow keys are what role="tablist" promises a keyboard user, and moving focus along
  // with the selection is what makes the promise good.
  navigate(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key]
    if (step === undefined) return

    event.preventDefault()
    const current = this.tabTargets.indexOf(event.currentTarget)
    const last = this.tabTargets.length - 1
    const next = Math.min(Math.max(current + step, 0), last)

    this.show(next)
    this.tabTargets[next].focus()
  }

  show(index) {
    this.tabTargets.forEach((tab, i) => {
      tab.setAttribute("aria-selected", i === index)
      // Roving tabindex: one Tab keystroke enters the tablist, arrows move within it.
      tab.tabIndex = i === index ? 0 : -1
    })
    this.panelTargets.forEach((panel, i) => { panel.hidden = i !== index })
  }
}
