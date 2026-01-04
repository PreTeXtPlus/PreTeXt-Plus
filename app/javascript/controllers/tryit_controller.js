import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  //Load the React code when we initialize
  initialize() {
    this.componentPromise = import("./react/editor");
  }

  async connect() {
    this.component = await this.componentPromise;

    const root = this.targets.find("root");
    const contentField = this.targets.find("contentField");
    const titleField = this.targets.find("titleField");
    const tokenField = this.targets.find("tokenField");

    const onPreviewRebuild = async (content, title, postToIframe) => {
      const token = tokenField.value;
      const postData = { source: content, title: title, token: token };
      postToIframe('https://build.pretext.plus', postData);
    }

    const onSaveButton = () => {
      window.location.href = "/users/new";
    }

    const onCancelButton = () => {
      window.location.href = "/session/new";
    }

    const props = {
      content: contentField.value,
      onContentChange: (v) => contentField.value = v,
      title: titleField.value,
      onTitleChange: (v) => titleField.value = v,
      onSaveButton: onSaveButton,
      saveButtonLabel: "Create your account!",
      onCancelButton: onCancelButton,
      cancelButtonLabel: "Sign in",
      onPreviewRebuild: onPreviewRebuild
    };

    this.component.render(root, props);
  }

  disconnect() {
    const root = this.targets.find("root");

    this.component.destroy(root);
  }
}
