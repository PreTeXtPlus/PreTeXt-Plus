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

    const onCancelButton = () => {
      if (confirm("Cancel without saving?")) {
        window.location.href = "/projects";
      }
    }

    const onSaveButton = () => {
      railsForm.submit();
    }

    const onSave = async () => {
      try {
        // 4. Send the POST request asynchronously
        const response = await fetch(railsForm.getAttribute("action"), {
          method: "POST",
          body: new FormData(railsForm),
        });

        if (!response.ok) {
          throw new Error(`Error saving document! Status: ${response.status}`);
        }

        console.log("Success saving document!");

      } catch (error) {
        console.error("Error:", error);
        alert("An error occurred during submission.");
      }
    }

    // run onSave every 10 seconds to auto-save the document
    setInterval(onSave, 10000);

    const onPreviewRebuild = async (content, title, postToIframe) => {
      const buildHost = "/projects/preview";
      const authenticityToken = document.querySelector("meta[name='csrf-token']").getAttribute("content");
      const postData = { source: content, title: title, authenticity_token: authenticityToken };
      postToIframe(buildHost, postData);
    }

    const props = {
      content: contentField.value,
      onContentChange: (v) => contentField.value = v,
      title: titleField.value,
      onTitleChange: (v) => titleField.value = v,
      onSaveButton: onSaveButton,
      onSave: onSave,
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
