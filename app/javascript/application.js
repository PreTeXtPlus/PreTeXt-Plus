/** Rails/esbuild entry point: wires up Turbo and registers all Stimulus controllers. */
import "@hotwired/turbo-rails"
import "./controllers"

// Detects the browser's IANA timezone and stores it in a cookie so the server can
// render times already localized (see ApplicationController#set_time_zone and
// ApplicationHelper#local_time_tag). Only re-visits the page when the zone is
// missing or has changed (first visit, or e.g. travel/DST-zone change).
document.addEventListener("turbo:load", () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const current = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1]
  if (zone && zone !== current) {
    document.cookie = `tz=${zone}; path=/; max-age=31536000; samesite=lax`
    Turbo.visit(window.location.href, { action: "replace" })
  }
})
