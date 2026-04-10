/**
 * Assembles the source payload sent to the build server for live preview.
 *
 * For latex projects the editor performs a client-side conversion and stores
 * the resulting PreTeXt fragment in `pretextSource`.  For pretext projects
 * `content` is already in PreTeXt.  In both cases, when a `docinfo` block is
 * present the fragment is wrapped in a full `<pretext>` document so the build
 * server receives valid, complete XML.
 *
 * @param {Object} opts
 * @param {string} opts.content       - Raw editor content (may be latex or pretext fragment).
 * @param {string} opts.sourceFormat  - "pretext" | "latex" | "pmd"
 * @param {string} [opts.pretextSource] - Client-converted PreTeXt body for latex projects.
 * @param {string} [opts.docinfo]     - Optional <docinfo> block string.
 * @returns {string} Assembled source ready to POST to the build server.
 */
export function assemblePreviewSource({ content, title, sourceFormat, pretextSource, docinfo }) {
  const previewBody = sourceFormat === "latex" && pretextSource
    ? pretextSource
    : content;

  return docinfo
    ? `<pretext>\n${docinfo}\n<article label="article">\n<title>${title}</title>${previewBody}</article>\n</pretext>`
    : previewBody;
}
