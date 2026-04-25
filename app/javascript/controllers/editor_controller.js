import { Controller } from "@hotwired/stimulus"
import { assemblePreviewSource } from "./preview_source.js"

export default class extends Controller {
  static values = { projectId: String, editorStateUrl: String }

  //Load the React code when we initialize
  initialize() {
    this.componentPromise = import("./react/editor");
  }

  async connect() {
    this.component = await this.componentPromise;

    const root = this.targets.find("root");
    const apiBase = this.editorStateUrlValue;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

    // Load initial editor state from the API
    let state;
    try {
      const response = await fetch(apiBase, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Failed to load editor state: ${response.status}`);
      state = await response.json();
    } catch (error) {
      console.error("Error loading editor state:", error);
      return;
    }

    // Track mutable current state for dirty-checking and autosave
    const current = {
      title: state.title ?? "",
      source: state.source ?? "",
      sourceFormat: state.source_format ?? "pretext",
      pretextSource: state.pretext_source ?? "",
      docinfo: state.docinfo ?? "",
      commonDocinfo: state.common_docinfo ?? "",
      useCommonDocinfo: state.use_common_docinfo ?? false,
    };
    const saved = { ...current };

    const isDirty = () =>
      current.source !== saved.source ||
      current.title !== saved.title ||
      current.pretextSource !== saved.pretextSource ||
      current.docinfo !== saved.docinfo ||
      current.commonDocinfo !== saved.commonDocinfo ||
      current.useCommonDocinfo !== saved.useCommonDocinfo;

    const onSave = async (force = false) => {
      if (!force && !isDirty()) return true;

      try {
        const response = await fetch(apiBase, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            project: {
              title: current.title,
              source: current.source,
              source_format: current.sourceFormat,
              pretext_source: current.pretextSource,
              docinfo: current.docinfo,
              use_common_docinfo: current.useCommonDocinfo,
              common_docinfo: current.commonDocinfo,
            }
          }),
        });

        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
        Object.assign(saved, current);
        console.log("Saved!");
        return true;
      } catch (error) {
        console.error("Error saving:", error);
        alert("An error occurred while saving.");
        return false;
      }
    };

    const onSaveButton = async () => {
      const savedSuccessfully = await onSave(true);
      if (!savedSuccessfully) return;

      window.location.href = `/projects/${this.projectIdValue}`;
    };

    const onCancelButton = () => {
      if (confirm("Cancel without saving?")) {
        window.location.href = `/projects/${this.projectIdValue}`;
      }
    };

    // run onSave every 10 seconds; only fires if content has changed since last save
    this.saveInterval = setInterval(onSave, 10000);

    const onPreviewRebuild = (content, title, postToIframe) => {
      // For non-pretext projects the editor passes the converted pretextSource as
      // `content`.  Keep current in sync so onSave has the latest value.
      if (current.sourceFormat !== "pretext") {
        current.pretextSource = content ?? "";
      }
      // Use the common docinfo when the project is set to use it.
      const effectiveDocinfo = current.useCommonDocinfo && current.commonDocinfo
        ? current.commonDocinfo
        : current.docinfo;
      const assembledSource = assemblePreviewSource({
        content,
        title: current.title,
        sourceFormat: current.sourceFormat,
        pretextSource: current.pretextSource,
        docinfo: effectiveDocinfo,
      });
      postToIframe("/projects/preview", {
        source: assembledSource,
        title,
        authenticity_token: csrfToken,
      });
    };

    const onCreatePretextProjectCopy = async (request) => {
      try {
        const savedSuccessfully = await onSave(true);
        if (!savedSuccessfully) throw new Error("Failed to save current project");

        const response = await fetch(
          `/projects/${this.projectIdValue}/copy_conversion`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-CSRF-Token": csrfToken,
            },
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to create converted copy: ${response.status}`);
        }

        const result = await response.json();
        // Redirect to the new project's editor
        window.location.href = result.project_url;
      } catch (error) {
        console.error("Error creating converted copy:", error);
        alert(`Failed to create converted copy:\n${error.message}`);
      }
    };

    const onFeedbackSubmit = async (feedback) => {
      try {
        const response = await fetch("/projects/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            context: feedback.context,
            message: feedback.message,
            email: feedback.email,
            project_url: feedback.projectUrl,
            current_source: feedback.currentSource,
            source_format: feedback.sourceFormat,
            title: feedback.title,
            submitted_at: feedback.submittedAt,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to submit feedback: ${response.status}`);
        }

        console.log("Feedback submitted successfully");
      } catch (error) {
        console.error("Error submitting feedback:", error);
        alert(`Failed to submit feedback: ${error.message}`);
      }
    };

    this.component.render(root, {
      source: current.source,
      sourceFormat: current.sourceFormat,
      pretextSource: current.pretextSource || undefined,
      docinfo: current.docinfo || undefined,
      commonDocinfo: current.commonDocinfo || undefined,
      useCommonDocinfo: current.useCommonDocinfo,
      onContentChange: (v, meta) => {
        current.source = v ?? "";
        if (meta?.sourceFormat) current.sourceFormat = meta.sourceFormat;
        if (meta?.pretextSource !== undefined) current.pretextSource = meta.pretextSource;
        // docinfo changes are delivered via meta when the DocinfoEditor saves
        if (meta?.docinfo !== undefined) current.docinfo = meta.docinfo;
        if (meta?.commonDocinfo !== undefined) current.commonDocinfo = meta.commonDocinfo;
        if (meta?.useCommonDocinfo !== undefined) current.useCommonDocinfo = meta.useCommonDocinfo;
      },
      onCommonDocinfoChange: (value) => { current.commonDocinfo = value ?? ""; onSave(); },
      onUseCommonDocinfoChange: (value) => { current.useCommonDocinfo = value === true; onSave(); },
      title: current.title,
      onTitleChange: (v) => { current.title = v ?? ""; },
      onSaveButton,
      onSave,
      saveButtonLabel: "Save",
      onCancelButton,
      cancelButtonLabel: "Cancel",
      onPreviewRebuild,
      onCreatePretextProjectCopy,
      onFeedbackSubmit,
    });
  }

  disconnect() {
    clearInterval(this.saveInterval);

    const root = this.targets.find("root");
    this.component?.destroy(root);
  }
}

