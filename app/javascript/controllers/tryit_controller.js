import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    content: String,
    title: String,
    docinfo: String,
    sourceFormat: String,
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
      content: this.contentValue,
      title: this.titleValue,
      docinfo: this.docinfoValue,
      sourceFormat: this.sourceFormatValue,
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content,
    })

    this.notifyLayoutChange()
  }

  disconnect() {
    const root = this.targets.find("root")
    this.component?.destroy(root)
  }
}
