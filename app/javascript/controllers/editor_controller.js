import { Controller } from "@hotwired/stimulus"

const LATEX_CONVERTED_KEY = (projectId) => `latexConverted_${projectId}`;

function openFeedbackModal(detail = {}) {
  window.dispatchEvent(new CustomEvent("feedback:open", { detail }));
}

function notifyFeedback(message) {
  window.dispatchEvent(new CustomEvent("feedback:notify", { detail: { message } }));
}

function updateFeedbackSource(detail = {}) {
  if (!window.__feedbackPageSource) window.__feedbackPageSource = {};
  const store = window.__feedbackPageSource;
  if (detail.source !== undefined) store.source = detail.source;
  if (detail.latexSource) store.latexSource = detail.latexSource; // only update if truthy — preserve once set
  if (detail.projectId !== undefined) store.projectId = detail.projectId;
  window.dispatchEvent(new CustomEvent("feedback:source-update", { detail: { ...store } }));
}

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

    const projectId = this.element.dataset.editorProjectIdValue || null;

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
        openFeedbackModal({
          source: contentField.value,
          projectId,
          context: `I encountered a save error:\n\n${error.message}\n\n(Feel free to edit or replace this message.)`,
        });
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

    const onContentChange = (v, meta) => {
      const prevFormat = sourceFormatField.value;
      const prevContent = contentField.value; // capture original content before overwrite
      contentField.value = v;
      if (meta?.sourceFormat) sourceFormatField.value = meta.sourceFormat;
      if (meta?.pretextSource) pretextSourceField.value = meta.pretextSource;

      // Keep the feedback widget's source in sync with the editor
      updateFeedbackSource({
        source: meta?.pretextSource ?? pretextSourceField.value ?? v,
        projectId,
      });

      // Trigger notification on first-ever LaTeX→PreTeXt conversion for this project
      const justConverted =
        prevFormat === "latex" &&
        meta?.sourceFormat === "pretext" &&
        meta?.pretextSource;

      if (justConverted && projectId) {
        const storageKey = LATEX_CONVERTED_KEY(projectId);
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, "1");
          // prevContent is the original LaTeX before it was overwritten
          updateFeedbackSource({
            source: meta.pretextSource,
            latexSource: prevContent,
            projectId,
          });
          notifyFeedback("Converted to PreTeXt! Have feedback about how it went?");
        }
      }
    };

    const props = {
      source: contentField.value,
      sourceFormat: sourceFormatField.value,
      pretextSource: pretextSourceField.value || undefined,
      onContentChange,
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

    // Broadcast initial source so the feedback widget can offer "include source" from the start
    updateFeedbackSource({
      source: pretextSourceField.value || contentField.value || null,
      projectId,
    });
  }

  disconnect() {
    clearInterval(this.saveInterval);

    const root = this.targets.find("root");
    this.component.destroy(root);
  }
}

