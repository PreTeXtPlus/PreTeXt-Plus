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
    };
    const saved = { ...current };

    const isDirty = () =>
      current.source !== saved.source ||
      current.title !== saved.title ||
      current.pretextSource !== saved.pretextSource ||
      current.docinfo !== saved.docinfo;

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
      const assembledSource = assemblePreviewSource({
        content,
        title: current.title,
        sourceFormat: current.sourceFormat,
        pretextSource: current.pretextSource,
        docinfo: current.docinfo,
      });
      postToIframe("/projects/preview", {
        source: assembledSource,
        title,
        authenticity_token: csrfToken,
      });
    };

    const onCreatePretextProjectCopy = async (request) => {
      try {
        const response = await fetch(
          `/projects/${this.projectIdValue}/converted_copy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify({
              pretext_source: request.pretextSource,
              title: request.title,
            }),
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
        alert(`Failed to create converted copy: ${error.message}`);
      }
    };

    this.component.render(root, {
      source: current.source,
      sourceFormat: current.sourceFormat,
      pretextSource: current.pretextSource || undefined,
      docinfo: current.docinfo || undefined,
      onContentChange: (v, meta) => {
        current.source = v ?? "";
        if (meta?.sourceFormat) current.sourceFormat = meta.sourceFormat;
        if (meta?.pretextSource !== undefined) current.pretextSource = meta.pretextSource;
        // docinfo changes are delivered via meta when the DocinfoEditor saves
        if (meta?.docinfo !== undefined) current.docinfo = meta.docinfo;
      },
      title: current.title,
      onTitleChange: (v) => { current.title = v ?? ""; },
      onSaveButton,
      onSave,
      saveButtonLabel: "Save",
      onCancelButton,
      cancelButtonLabel: "Cancel",
      onPreviewRebuild,
      onCreatePretextProjectCopy,
    });
  }

  disconnect() {
    clearInterval(this.saveInterval);

    const root = this.targets.find("root");
    this.component?.destroy(root);
  }
}

