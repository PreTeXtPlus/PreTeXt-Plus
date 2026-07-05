import { Application } from "@hotwired/stimulus"

/** @type {import("@hotwired/stimulus").Application} The shared Stimulus application instance. */
const application = Application.start()

// Configure Stimulus development experience
application.debug = false
window.Stimulus   = application

export { application }
