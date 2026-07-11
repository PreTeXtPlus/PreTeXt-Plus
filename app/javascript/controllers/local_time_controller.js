import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="local-time"
// Rewrites a <time datetime="..."> element's visible text to the browser's
// local timezone (including the zone abbreviation). The UTC tooltip is
// rendered server-side in the `title` attribute since it doesn't depend on
// the browser's timezone.
export default class extends Controller {
  static values = { dateOnly: Boolean }

  connect() {
    const date = new Date(this.element.getAttribute("datetime"))
    if (Number.isNaN(date.getTime())) return

    if (this.dateOnlyValue) {
      this.element.textContent = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
      })
      return
    }

    const formatted = date.toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    })
    const zone = this.zoneAbbreviation(date)

    this.element.textContent = zone ? `${formatted} ${zone}` : formatted
  }

  zoneAbbreviation(date) {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")
    return part?.value ?? ""
  }
}
