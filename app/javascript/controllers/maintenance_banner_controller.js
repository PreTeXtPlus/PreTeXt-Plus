import { Controller } from "@hotwired/stimulus"

const STORAGE_KEY = "maintenance-banner-dismissed"

/**
 * The bottom-of-screen warning for an upcoming maintenance window. Keeps the
 * "time remaining" current while a page stays open (the editor can sit for hours),
 * and remembers a dismissal so the banner doesn't come back on every page visit.
 *
 * The dismissal is stored against `key` (window id + start time), so rescheduling
 * the window, or scheduling the next one, shows the banner again.
 */
export default class extends Controller {
  static targets = ["remaining"]
  static values = { startsAt: String, key: String }

  connect() {
    if (this.#dismissedKey() === this.keyValue) {
      this.element.remove()
      return
    }
    this.#tick()
    this.timer = setInterval(() => this.#tick(), 30_000)
  }

  disconnect() {
    clearInterval(this.timer)
  }

  dismiss() {
    // Storage can throw (private windows, blocked site data); dismissing for just
    // this page is still better than not dismissing at all.
    try {
      localStorage.setItem(STORAGE_KEY, this.keyValue)
    } catch {}
    this.element.remove()
  }

  #dismissedKey() {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }

  #tick() {
    const ms = new Date(this.startsAtValue) - Date.now()
    this.remainingTarget.textContent = ms > 0 ? `in ${formatRemaining(ms)}` : "now underway"
  }
}

/** "1 day 3 hr", "4 hr 12 min", "12 min", or "under 1 min". */
export function formatRemaining(ms) {
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return hours > 0 ? `${days} day${days > 1 ? "s" : ""} ${hours} hr` : `${days} day${days > 1 ? "s" : ""}`
  if (hours > 0) return `${hours} hr ${minutes} min`
  if (minutes > 0) return `${minutes} min`
  return "under 1 min"
}
