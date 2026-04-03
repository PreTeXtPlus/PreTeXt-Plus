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
    const sourceFormatField = this.targets.find("sourceFormatField")
    const pretextSourceField = this.targets.find("pretextSourceField")
    const tokenField = this.targets.find("tokenField")
    const hostField = this.targets.find("hostField")

    const onCancelButton = () => {
      if (confirm("Cancel without saving?")) {
        window.location.href = "/projects";
      }
    }

    const onSaveButton = () => {
      railsForm.submit();
    }

    let lastSavedContent = contentField.value;
    let lastSavedTitle = titleField.value;
    let lastSavedPretextSource = pretextSourceField.value;

    const isDirty = () =>
      contentField.value !== lastSavedContent ||
      titleField.value !== lastSavedTitle ||
      pretextSourceField.value !== lastSavedPretextSource;

    const onSave = async () => {
      if (!isDirty()) return;

      try {
        const response = await fetch(railsForm.getAttribute("action"), {
          method: "PATCH",
          headers: { "Accept": "application/json" },
          body: new FormData(railsForm),
        });

        if (!response.ok) {
          throw new Error(`Error saving document! Status: ${response.status}`);
        }

        lastSavedContent = contentField.value;
        lastSavedTitle = titleField.value;
        lastSavedPretextSource = pretextSourceField.value;
        console.log("Success saving document!");

      } catch (error) {
        console.error("Error:", error);
        alert("An error occurred during submission.");
      }
    }

    // run onSave every 10 seconds; only fires if content has changed since last save
    this.saveInterval = setInterval(onSave, 10000);

    const onPreviewRebuild = async (content, title, postToIframe) => {
      const buildToken = tokenField.value;
      const buildHost = hostField.value;
      const postData = { source: content, title: title, token: buildToken };
      postToIframe(`https://${buildHost}`, postData);
    }

    const props = {
      content: contentField.value,
      sourceFormat: sourceFormatField.value,
      pretextSource: pretextSourceField.value || undefined,
      onContentChange: (v, meta) => {
        contentField.value = v;
        if (meta?.sourceFormat) sourceFormatField.value = meta.sourceFormat;
        if (meta?.pretextSource) pretextSourceField.value = meta.pretextSource;
      },
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
    clearInterval(this.saveInterval);

    const root = this.targets.find("root");
    this.component.destroy(root);
  }
}
