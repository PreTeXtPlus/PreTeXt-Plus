import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { projectId: String }

  //Load the React code when we initialize
  initialize() {
    this.componentPromise = import("./react/editor");
  }

  async connect() {
    this.component = await this.componentPromise;

    const root = this.targets.find("root");
    const apiBase = `/projects/${this.projectIdValue}/editor_state`;
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

    const onSave = async () => {
      if (!isDirty()) return true;

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
      const savedSuccessfully = await onSave();
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
      postToIframe(`https://${state.build_host}`, {
        source: content,
        title,
        token: state.build_token,
        docinfo: current.docinfo,
      });
    };

    this.component.render(root, {
      source: current.source,
      sourceFormat: current.sourceFormat,
      pretextSource: current.pretextSource || undefined,
      docinfo: current.docinfo || undefined,
      onContentChange: (v, meta) => {
        current.source = v ?? "";
        if (meta?.sourceFormat) current.sourceFormat = meta.sourceFormat;
        if (meta?.pretextSource) current.pretextSource = meta.pretextSource;
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
    });
  }

  disconnect() {
    clearInterval(this.saveInterval);

    const root = this.targets.find("root");
    this.component?.destroy(root);
  }
}

