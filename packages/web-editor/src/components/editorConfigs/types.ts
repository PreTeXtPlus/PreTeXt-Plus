/** Per-format Monaco editor configuration. */
export interface FormatEditorConfig {
  /** Monaco language identifier for syntax highlighting. */
  language: string;
  /**
   * Called once when the Monaco instance is ready (and again when the format
   * changes).  Register language extensions — completions, diagnostics, hover
   * providers, syntax tokens, etc. — and return a disposable so they can be
   * torn down when the format changes or the editor unmounts.
   *
   * `editor` is supplied because diagnostics attach to the editor's *model*
   * (they listen for its content changes and publish markers against it),
   * unlike completions which are registered globally per language id.
   */
  registerMonacoExtensions?: (
    monaco: any,
    editor: any,
  ) => { dispose: () => void } | null;
}
