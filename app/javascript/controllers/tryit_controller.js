import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    project: Object,
  }

  initialize() {
    this.componentPromise = import("./react/tryit")
  }

  notifyLayoutChange() {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"))
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"))
      })
    })
  }

  async connect() {
    this.component = await this.componentPromise

    const root = this.targets.find("root")
    this.component.render(root, {
      project: this.projectValue,
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content,
    })

    this.notifyLayoutChange()
  }

  disconnect() {
    const root = this.targets.find("root")
    this.component?.destroy(root)
  }
}
