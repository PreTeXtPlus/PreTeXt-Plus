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
    const railsForm = this.targets.find("form");
    const tokenField = this.targets.find("tokenField")

    const onCancelButton = () => {
      if (confirm("Cancel without saving?")) {
        window.location.href = "/projects";
      }
    }

    const onSaveButton = () => {
      railsForm.submit();
    }

    // Save with Ctrl+S or Cmd+S
    document.addEventListener("keydown", function(e) {
      if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (confirm("Save and exit?")) {
          railsForm.submit();
        }
      }
    }, false);

    const onPreviewRebuild = async (content, title, postToIframe) => {
      const token = tokenField.value;
      const postData = { source: content, title: title, token: token };
      postToIframe('https://build.pretext.plus', postData);
    }

    const props = {
      content: contentField.value,
      onContentChange: (v) => contentField.value = v,
      title: titleField.value,
      onTitleChange: (v) => titleField.value = v,
      onSaveButton: onSaveButton,
      saveButtonLabel: "Save and...",
      onCancelButton: onCancelButton,
      cancelButtonLabel: "Cancel",
      onPreviewRebuild: onPreviewRebuild
    };

    this.component.render(root, props);
  }

  disconnect() {
    const root = this.targets.find("root");

    this.component.destroy(root);
  }
}
