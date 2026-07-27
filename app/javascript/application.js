/** Rails/esbuild entry point: wires up Turbo and registers all Stimulus controllers. */
import "@hotwired/turbo-rails"
import "./turbo/stream_actions"
import "./controllers"
