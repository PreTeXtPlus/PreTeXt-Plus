import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  initialize() {
    this.componentPromise = import("./react/feedback");
  }

  async connect() {
    this.component = await this.componentPromise;

    const root = this.targets.find("root");
    const projectId = this.element.dataset.feedbackProjectIdValue || null;

    this.component.render(root, { projectId });
  }

  disconnect() {
    const root = this.targets.find("root");
    this.component?.destroy(root);
  }
}
