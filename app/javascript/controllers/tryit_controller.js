import { Controller } from "@hotwired/stimulus"
import { assemblePreviewSource } from "./preview_source.js"

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

    // Load initial state directly from the hidden fields (no API - tryit has no project)
    const current = {
      title: titleField.value ?? "",
      source: contentField.value ?? "",
      sourceFormat: "pretext",
      pretextSource: "",
      docinfo: "",
    };
    console.log("Initial editor state:", current);

    const onPreviewRebuild = async (content, title, postToIframe) => {
      const assembledSource = assemblePreviewSource({
        content,
        title: current.title,
        sourceFormat: current.sourceFormat,
        pretextSource: current.pretextSource,
        docinfo: current.docinfo,
      });
      const authenticityToken = document.querySelector("meta[name='csrf-token']").getAttribute("content");
      postToIframe("/projects/preview", { source: assembledSource, title, authenticity_token: authenticityToken });
    }

    const onSaveButton = () => {
      window.location.href = "/users/new";
    }

    const onCancelButton = () => {
      window.location.href = "/session/new";
    }

    const props = {
      source: current.source,
      sourceFormat: current.sourceFormat,
      pretextSource: current.pretextSource || undefined,
      docinfo: current.docinfo || undefined,
      onContentChange: (v, meta) => {
        current.source = v ?? "";
        if (meta?.sourceFormat) current.sourceFormat = meta.sourceFormat;
        if (meta?.pretextSource !== undefined) current.pretextSource = meta.pretextSource;
        if (meta?.docinfo !== undefined) current.docinfo = meta.docinfo;
      },
      title: current.title,
      onTitleChange: (v) => { current.title = v ?? ""; },
      onSaveButton,
      saveButtonLabel: "Create your account!",
      onCancelButton,
      cancelButtonLabel: "Sign in",
      onPreviewRebuild,
    };

    this.component.render(root, props);
  }

  disconnect() {
    const root = this.targets.find("root");

    this.component.destroy(root);
  }
}
