import "./App.css";
import Editors from "./components/Editors";
import CollabDemo from "./CollabDemo";
import { useMemo, useState } from "react";
import type {
  Asset,
  EditorContentChange,
  FeedbackSubmission,
  SourceFormat,
} from "./types/editor";
import type { Division, DivisionType } from "./types/sections";
import { assembleProjectSource } from "./sectionUtils";

/** A self-contained placeholder image (no network dependency) for demo image assets. */
function demoImageDataUrl(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="20" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// Initial divisions for the article demo
// ---------------------------------------------------------------------------
const DEMO_DIVISIONS: Division[] = [
  {
    id: "demo-root",
    xmlId: "demo-article",
    title: "",
    type: "article",
    sourceFormat: "pretext",
    source: `<article xml:id="demo-article">
  <title>Divisions Mode Demo for Article</title>
  
  <plus:introduction ref="sec-intro"/>
  <plus:section ref="sec-background"/>
  <plus:section ref="sec-results"/>
  <plus:section ref="sec-latex"/>
  <plus:section ref="sec-markdown"/>
</article>

`,
  },
  {
    id: "demo-intro",
    xmlId: "sec-intro",
    title: "",
    type: "introduction",
    sourceFormat: "pretext",
    source: `<introduction xml:id="sec-intro">
  <p>
    Each section is a separate <c>Division</c> record in a flat pool. The TOC reads their order from <c>plus:section</c> placeholder tags embedded in this root division's content.
  </p>

  <p>
    Divisions can mix source formats: most sections below are authored in PreTeXt, but <c>sec-latex</c> is authored in LaTeX and <c>sec-markdown</c> in Markdown. Each is converted to PreTeXt for the preview. Both nest a child subsection: the Markdown section via a <c>::subsection{ref="..."}</c> directive and the LaTeX section via a <c>\\plus{subsection}{...}</c> macro.
  </p>

  <p> 
    In the divisions model every structural element—article, chapter, section, worksheet—is a flat <c>Division</c> record. Hierarchy is expressed by <c>plus:section</c> placeholder tags inside a parent division's content.
  </p>
  
  <p>
    Click a section in the TOC to edit it. Drag sections to reorder them—reordering updates the placeholder order in the parent's content rather than a database sort column.
  </p>
</introduction>`,
  },
  {
    id: "demo-background",
    xmlId: "sec-background",
    title: "",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="sec-background">
  <title>Background</title>
  
  <p>
    Previously, sections were either stored merged into one document blob or kept in order via a database sort column. In divisions mode each division owns its own content independently and parent divisions reference children by <attr>xml:id</attr>.
  </p>

  <p>
    This means the XML source is the authoritative record of structure—not the database.
  </p>
</section>`,
  },
  {
    id: "demo-results",
    xmlId: "sec-results",
    title: "Results",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="sec-results">
  <title>Results</title>
  
  <p>
    The TOC reads the ordered list of <c>plus:section ref="..."</c> tags from the root division's content and displays them in that order. Drag-to-reorder rewrites those placeholder tags in-place.
  </p>
</section>`,
  },
  {
    id: "demo-latex",
    xmlId: "sec-latex",
    title: "A LaTeX Section",
    type: "section",
    sourceFormat: "latex",
    // LaTeX divisions are stored as raw LaTeX. The leading
    // `\section{title}\label{xml:id}` line is the structural header: the code
    // editor locks it (click it to edit the title/xml:id from the TOC), and
    // the `\label` becomes the division's `xml:id` on conversion. Body
    // content is converted to PreTeXt for the preview.
    source: `\\section{A LaTeX Section}\\label{sec-latex}

This section is authored in \\LaTeX{} rather than PreTeXt. The editor locks the
leading \\verb|\\section{...}| line; edit its title and xml:id from the TOC.

Inline math like $E = mc^2$ and display math both convert to PreTeXt:
\\[
  \\int_0^1 x^2 \\, dx = \\frac{1}{3}.
\\]

\\begin{itemize}
  \\item LaTeX lists become PreTeXt lists.
  \\item \\textbf{Bold} and \\emph{emphasis} convert too.
\\end{itemize}

Assets embed with the \\verb|\\plus| macro — the line below becomes a
\\verb|<plus:image ref="..."/>| placeholder, shows up in the TOC's asset panel,
and resolves to the project asset when the source is assembled:

\\plus{image}{euler-formula.png}

A LaTeX division can also embed a child division: the macro below is converted
to a \\verb|<plus:subsection ref="..."/>| placeholder, so the TOC shows it
nested here and the child is expanded into place when the source is assembled.

\\plus{subsection}{sec-latex-child}`,
  },
  {
    id: "demo-latex-child",
    xmlId: "sec-latex-child",
    title: "A Nested LaTeX Subsection",
    type: "subsection",
    sourceFormat: "latex",
    // Child of the LaTeX section above, referenced from its body as
    // `\plus{subsection}{sec-latex-child}`. Rename its xml:id from the TOC and
    // the parent's `\plus{...}{...}` macro is rewritten to match, just like a
    // PreTeXt `plus:` placeholder or a Markdown `::` directive.
    source: `\\subsection{A Nested LaTeX Subsection}\\label{sec-latex-child}

This subsection is authored in \\LaTeX{} and pulled into the parent LaTeX
section by its \\verb|\\plus{subsection}{sec-latex-child}| macro.`,
  },
  {
    id: "demo-markdown",
    xmlId: "sec-markdown",
    title: "A Markdown Section",
    type: "section",
    sourceFormat: "markdown",
    // Markdown divisions are real markdown files: a YAML frontmatter block
    // (division/id/label — shown locked in the code editor) followed by the
    // markdown body. The remark-pretext converter turns the whole file into the
    // proper <section xml:id="...">…</section> element.
    source: `---
division: section
title: A Markdown Section
id: sec-markdown
---

This section is authored in **Markdown**, which is auto-converted to PreTeXt.

You can use *emphasis*, \`inline code\`, and inline math such as $a^2 + b^2 = c^2$.

- Markdown bullet lists become PreTeXt lists.
- A second item to show structure.

1. Ordered lists work too.
2. And convert on preview.

Assets embed the same way — the directive below becomes a
\`<plus:image ref="..."/>\` placeholder, shows up in the TOC's asset panel, and
resolves to the project asset when the source is assembled:

::image{ref="euler-formula.png"}

A Markdown division can also embed a child division: the leaf directive below
is converted to a \`<plus:subsection ref="..."/>\` placeholder, so the TOC shows
it nested here and the child is expanded into place when the source is assembled.

::subsection{ref="sec-md-child"}`,
  },
  {
    id: "demo-md-child",
    xmlId: "sec-md-child",
    title: "A Nested Subsection",
    type: "subsection",
    sourceFormat: "pretext",
    // Child of the Markdown section above, referenced from its markdown body as
    // `::subsection{ref="sec-md-child"}`. The child itself can be any format —
    // here PreTeXt — showing a Markdown parent nesting a PreTeXt child.
    source: `<subsection xml:id="sec-md-child">
  <title>A Nested Subsection</title>

  <p>
    This subsection is referenced from the Markdown section's body. Rename its
    <c>xml:id</c> from the TOC and the parent's <c>::subsection{ref="..."}</c>
    directive is rewritten to match, just like a PreTeXt <c>plus:</c> placeholder.
  </p>
</subsection>`,
  },
  {
    id: "demo-orphan",
    xmlId: "sec-orphan",
    title: "",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="sec-orphan">
  <title>Unplaced Section</title>

  <p>
  This section is not referenced by any parent division, so it appears in the <q>Unplaced divisions</q> group at the bottom of the TOC. Add a <c>plus:section ref="sec-orphan"</c> tag inside the root article's content to place it.</p>
</section>`,
  },
];

// ---------------------------------------------------------------------------
// Initial divisions for the BOOK divisions-mode demo (multi-level nesting)
// ---------------------------------------------------------------------------
const DEMO_BOOK_DIVISIONS: Division[] = [
  {
    id: "book-root",
    xmlId: "demo-book",
    title: "A Demo Book",
    type: "book",
    sourceFormat: "pretext",
    source: `<book xml:id="demo-book">
<title>A Demo Book</title>
<plus:chapter ref="ch-one"/>
<plus:chapter ref="ch-two"/>
</book>`,
  },
  {
    id: "book-ch1",
    xmlId: "ch-one",
    title: "Foundations",
    type: "chapter",
    sourceFormat: "pretext",
    source: `<chapter xml:id="ch-one">
<title>Foundations</title>
<introduction>
<p>This chapter is a <c>Division</c> of type <c>chapter</c>. Its sections are separate divisions referenced by <c>plus:section</c> placeholders below.</p>
</introduction>
<plus:section ref="ch1-sec1"/>
<plus:section ref="ch1-sec2"/>
</chapter>`,
  },
  {
    id: "book-ch1-s1",
    xmlId: "ch1-sec1",
    title: "First Principles",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="ch1-sec1">
<title>First Principles</title>
<p>A section nested two levels under the book root. Drag it within or between chapters to move it; the move rewrites <c>plus:section</c> refs in the relevant chapter's content.</p>
</section>`,
  },
  {
    id: "book-ch1-s2",
    xmlId: "ch1-sec2",
    title: "Notation",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="ch1-sec2">
<title>Notation</title>
<p>Another section in chapter one.</p>
</section>`,
  },
  {
    id: "book-ch2",
    xmlId: "ch-two",
    title: "Applications",
    type: "chapter",
    sourceFormat: "pretext",
    source: `<chapter xml:id="ch-two"> 
  <title>Applications</title>
  
  <plus:section ref="ch2-sec1"/>
</chapter>`,
  },
  {
    id: "book-ch2-s1",
    xmlId: "ch2-sec1",
    title: "Worked Examples",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="ch2-sec1">
  <title>Worked Examples</title>
  <p>
    The only section in chapter two — try dragging a section from chapter one into here.
  </p>
</section>`,
  },
  {
    id: "book-orphan-ch",
    xmlId: "ch-appendix",
    title: "Appendix (unplaced)",
    type: "chapter",
    sourceFormat: "pretext",
    source: `<chapter xml:id="ch-appendix">
  <title>Appendix (unplaced)</title>
  <plus:section ref="appendix-sec"/>
</chapter>`,
  },
  {
    id: "book-orphan-sec",
    xmlId: "appendix-sec",
    title: "Appendix Section",
    type: "section",
    sourceFormat: "pretext",
    source: `<section xml:id="appendix-sec">
  <title>Appendix Section</title>
  <p>
    This section belongs to the unplaced appendix chapter, so it appears nested under it in the <q>Unplaced divisions</q> group. Use the <c>+</c> button on the appendix to attach the whole subtree to the book.
  </p>
</section>


`,
  },
];

// ---------------------------------------------------------------------------
// Single-division demos for the non-PreTeXt source formats — a single root
// `article` division authored entirely in LaTeX or Markdown, so the whole
// document goes through the per-division convert-to-PreTeXt path rather than
// having LaTeX/Markdown nested as leaf sections under a PreTeXt root.
// ---------------------------------------------------------------------------
const LATEX_DEMO_DIVISIONS: Division[] = [
  {
    id: "latex-root",
    xmlId: "latex-demo",
    title: "Testing LaTeX Source Mode",
    type: "article",
    sourceFormat: "latex",
    source: String.raw`\article{Testing LaTeX Source Mode}\label{latex-demo}
    This paragraph appears before the first section, so it becomes the
introduction when converted to PreTeXt.

\section{Background}

This is the first proper section. It contains inline math like $a^2 + b^2 = c^2$
and displayed math:
\[
  E = mc^2
\]

\section{Methods}

Here is the second section. You can add \textbf{bold} text, \emph{emphasis},
and environments like \texttt{verbatim}.

\section{Results}

The third section can contain whatever you like.

The macro below embeds a child section — it shows up nested in the TOC and is
expanded into place when the full document source is assembled.

\plus{section}{latex-demo-sec}
`,
  },
  {
    id: "latex-demo-sec",
    xmlId: "latex-demo-sec",
    title: "A Referenced Section",
    type: "section",
    sourceFormat: "latex",
    // A LaTeX child of the LaTeX root, referenced from the root's body as
    // `\plus{section}{latex-demo-sec}`.
    source: String.raw`\section{A Referenced Section}\label{latex-demo-sec}

This whole section lives in its own LaTeX division and is pulled in by the
root's \verb|\plus{section}{latex-demo-sec}| macro.`,
  },
];

const MARKDOWN_DEMO_DIVISIONS: Division[] = [
  {
    id: "markdown-root",
    xmlId: "markdown-demo",
    title: "Testing Markdown Source Mode",
    type: "article",
    sourceFormat: "markdown",
    source: `---
division: article
title: Markdown Demo
id: markdown-demo
---


This demo lets you test the **markdown** source mode in the code editor.

# Features To Try

- Heading and paragraph editing
- Lists and inline code like \`inline code\`
- Fenced code blocks

# Example Math-like Text

Inline math such as $E = mc^2$ converts to PreTeXt.

# Blocks and environments

Theorem:
  This is the theorem.

  Proof:
    This is the proof.

More text.

The directive below embeds a child section — it shows up nested in the TOC and
is expanded into place when the full document source is assembled.

::section{ref="md-demo-sec"}
`,
  },
  {
    id: "markdown-demo-sec",
    xmlId: "md-demo-sec",
    title: "A Referenced Section",
    type: "section",
    sourceFormat: "markdown",
    // A Markdown child of the Markdown root, referenced from the root's body as
    // `::section{ref="md-demo-sec"}`.
    source: `---
division: section
title: A Referenced Section
id: md-demo-sec
---

This whole section lives in its own Markdown division and is pulled in by the
root's \`::section{ref="md-demo-sec"}\` directive.
`,
  },
];

// ---------------------------------------------------------------------------
// Full-build payload assembly (demo-only)
//
// `onPreviewRebuild` only ever receives the *active division's* converted
// content (see Editors.tsx's `previewContent`), so it can't show what a real
// "full build" would send: the whole document with every `<plus:* ref="..."/>`
// placeholder resolved and every LaTeX/Markdown division converted to PreTeXt.
// `assembleProjectSource` (from the library) reproduces that assembly from the
// `divisions` pool so the payload panel below can show it live, independent
// of the (broken, tokenless) preview iframe.
// ---------------------------------------------------------------------------

const handlePreviewRebuild = async (
  source: string,
  title: string,
  postToIframe: (url: string, data: any) => void,
) => {
  const token = import.meta.env.VITE_BUILD_TOKEN || "demo";
  const postData = { source: source, title: title, token: token };
  console.log("Posting full build payload to preview iframe:", postData);
  postToIframe("https://build.pretext.plus", postData);
};

function App() {
  const [title, setTitle] = useState("Divisions Mode Demo");
  // ---------------------------------------------------------------------------
  // Divisions state — the host always provides a list of divisions.
  // ---------------------------------------------------------------------------
  const [divisions, setDivisions] = useState<Division[]>(DEMO_DIVISIONS);
  const [activeDivisionId, setActiveDivisionId] = useState<string | null>(
    "sec-intro",
  );

  // ---------------------------------------------------------------------------
  // Asset demo state
  // ---------------------------------------------------------------------------
  // A single flat per-project asset pool, mirroring the Rails single-Asset
  // model where each project has-many assets. Seed assets carry an `id`
  // (already persisted); a freshly created asset has none until the project is
  // saved and the server mints one via nested `assets_attributes`.
  const [projectAssets, setProjectAssets] = useState<Asset[]>([
    {
      id: "asset-1",
      title: "Euler Formula",
      ref: "euler-formula",
      kind: "image",
      isFile: true,
      url: demoImageDataUrl("Euler Formula", "#0e639c"),
      contentType: "image/svg+xml",
      source: "<shortdescription>Euler's formula relating complex exponentials to trigonometric functions.</shortdescription>",
    },
    {
      id: "asset-2",
      title: "Markdown Logo",
      ref: "markdown-logo",
      kind: "image",
      isFile: true,
      url: demoImageDataUrl("Markdown Logo", "#0f766e"),
      contentType: "image/svg+xml",
      source: "<shortdescription>The Markdown logo.</shortdescription>",
    },
    {
      id: "asset-3",
      title: "PreTeXt Logo",
      ref: "pretext-logo",
      kind: "image",
      isFile: true,
      url: demoImageDataUrl("PreTeXt Logo", "#7c3aed"),
      contentType: "image/svg+xml",
      source: "<shortdescription>The PreTeXt logo.</shortdescription>",
    },
  ]);

  const [projectType, setProjectType] = useState<"article" | "book">("article");
  const [demoLabel, setDemoLabel] = useState("Article");
  // Collaboration demo: two editors sharing one (in-memory-relayed) Y.Doc.
  // Keyed so each entry builds a fresh session pair.
  const [collabKey, setCollabKey] = useState(0);
  const [showCollab, setShowCollab] = useState(false);

  // ---------------------------------------------------------------------------
  // Full-build payload panel (demo-only debug tool)
  // ---------------------------------------------------------------------------
  const [showBuildPayload, setShowBuildPayload] = useState(false);

  const rootDivision = divisions.find(
    (d) => d.type === "book" || d.type === "article" || d.type === "slideshow",
  ) ?? divisions[0];

  const fullBuildPayload = useMemo(() => {
    if (!rootDivision) return null;
    return {
      source: assembleProjectSource(divisions, rootDivision.xmlId, projectAssets),
      title,
      token: "demo",
    };
  }, [divisions, rootDivision, title, projectAssets]);

  // ---------------------------------------------------------------------------
  // Demo loaders
  // ---------------------------------------------------------------------------

  const loadDivisionsDemo = () => {
    setDivisions(DEMO_DIVISIONS);
    setActiveDivisionId("sec-intro");
    setTitle("Divisions Mode Demo");
    setProjectType("article");
    setDemoLabel("Article");
  };

  const loadBookDemo = () => {
    setDivisions(DEMO_BOOK_DIVISIONS);
    setActiveDivisionId("ch1-sec1");
    setTitle("A Demo Book");
    setProjectType("book");
    setDemoLabel("Book");
  };

  const loadLatexDemo = () => {
    setDivisions(LATEX_DEMO_DIVISIONS);
    setActiveDivisionId("latex-demo");
    setTitle("Testing LaTeX Source Mode");
    setProjectType("article");
    setDemoLabel("LaTeX");
  };

  const loadMarkdownDemo = () => {
    setDivisions(MARKDOWN_DEMO_DIVISIONS);
    setActiveDivisionId("markdown-demo");
    setTitle("Testing Markdown Source Mode");
    setProjectType("article");
    setDemoLabel("Markdown");
  };

  // ---------------------------------------------------------------------------
  // Division handlers
  // ---------------------------------------------------------------------------

  const handleDivisionSelect = (xmlId: string) => {
    setActiveDivisionId(xmlId);
  };

  // Unified content-change handler: every change (division edit, structural
  // reorder, or docinfo edit) arrives keyed by the affected division's xmlId.
  const handleContentChange = (change: EditorContentChange) => {
    setDivisions((prev) =>
      prev.map((d) =>
        d.xmlId === change.xmlId
          ? { ...d, source: change.source }
          : d,
      ),
    );
  };

  const handleDivisionAdd = (division: Division) => {
    // The division arrives with no id — it's new until the project is saved.
    // A real host sends it through the project's nested `divisions_attributes`
    // (no id = insert) and the server mints one on save, which then flows back
    // via the `divisions` prop (matched by `xmlId`).
    setDivisions((prev) => [...prev, division]);
    setActiveDivisionId(division.xmlId);
    console.log("New division added (no id yet):", division.xmlId);
  };

  const handleDivisionRemove = (xmlId: string) => {
    setDivisions((prev) => prev.filter((d) => d.xmlId !== xmlId));
  };

  const handleDivisionUpdate = (
    xmlId: string,
    changes: {
      title?: string;
      type?: DivisionType;
      xmlId?: string | null;
      sourceFormat?: SourceFormat;
      label?: string | null;
    },
  ) => {
    setDivisions((prev) =>
      prev.map((d) =>
        d.xmlId === xmlId
          ? {
              ...d,
              ...(changes.title !== undefined && { title: changes.title }),
              ...(changes.type !== undefined && { type: changes.type }),
              ...(changes.xmlId != null && { xmlId: changes.xmlId }),
              ...(changes.sourceFormat !== undefined && {
                sourceFormat: changes.sourceFormat,
              }),
            }
          : d,
      ),
    );
  };

  // ---------------------------------------------------------------------------
  // Feedback / assets
  // ---------------------------------------------------------------------------

  const handleFeedbackSubmit = async (feedback: FeedbackSubmission) => {
    console.log("Feedback submitted:", feedback);
  };

  const handleAssetInsert = (asset: Asset) => {
    console.log("Asset inserted:", asset.ref);
  };

  const handleAssetUpload = async (file: File, title?: string): Promise<Asset> => {
    console.log("Asset upload started:", file.name, file.type, file.size, "title:", title);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const newAsset: Asset = {
      // No `id`: a freshly uploaded asset is new until the project is saved.
      // A real host sends it through the project's nested `assets_attributes`
      // (no id = insert) and the server mints one on save.
      title: title?.trim() || file.name.replace(/\.[^.]+$/, ""),
      ref: file.name,
      kind: "image",
      isFile: true,
      url: URL.createObjectURL(file),
      contentType: file.type,
    };
    setProjectAssets((prev) => [...prev, newAsset]);
    return newAsset;
  };

  const handleAssetFetchUrl = async (url: string): Promise<File> => {
    console.log("Fetching URL on the user's behalf (demo stand-in for a server-side proxy):", url);
    const filename = url.split("/").pop()?.split("?")[0] ?? "image.png";
    // A real host fetches `url` server-side (avoiding CORS) and streams the
    // bytes back; it must not persist anything here — persistence happens
    // when the returned file is passed to onAssetUpload. As a demo stand-in we
    // fetch client-side, which works for the blob:/same-origin URLs uploads
    // produce here (so Duplicate yields a real image); fall back to an empty
    // file when a cross-origin fetch is blocked.
    try {
      const blob = await (await fetch(url)).blob();
      return new File([blob], filename, { type: blob.type || "image/png" });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return new File([], filename, { type: "image/png" });
    }
  };

  const handleCreateDoenet = async (title: string, ref: string): Promise<Asset> => {
    console.log("Creating Doenet activity:", title, ref);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // No `id` — same new-asset convention as uploads.
    const newAsset: Asset = { title, ref, kind: "doenet" };
    setProjectAssets((prev) => [...prev, newAsset]);
    return newAsset;
  };

  // Assets are keyed by kind+ref, not id — a new asset may not have an id yet.
  const handleAssetRemove = (asset: Asset) => {
    console.log("Removing asset from project:", asset.ref);
    setProjectAssets((prev) =>
      prev.filter((a) => !(a.kind === asset.kind && a.ref === asset.ref)),
    );
  };

  const handleAssetUpdate = async (asset: Asset) => {
    console.log("Updating asset:", asset.ref, asset.source);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setProjectAssets((prev) =>
      prev.map((a) => (a.kind === asset.kind && a.ref === asset.ref ? asset : a)),
    );
  };

  // ---------------------------------------------------------------------------
  // Toolbar label
  // ---------------------------------------------------------------------------

  const toolbarLabel = `Demo: ${demoLabel}`;

  return (
    <>
      <div className="app-demo-toolbar">
        <span className="app-demo-toolbar__label">{toolbarLabel}</span>
        <button
          className="app-demo-toolbar__button"
          onClick={loadDivisionsDemo}
        >
          Load Article Demo
        </button>
        <button className="app-demo-toolbar__button" onClick={loadBookDemo}>
          Load Book Demo
        </button>
        <button className="app-demo-toolbar__button" onClick={loadLatexDemo}>
          Load LaTeX Demo
        </button>
        <button
          className="app-demo-toolbar__button"
          onClick={loadMarkdownDemo}
        >
          Load Markdown Demo
        </button>
        <button
          className="app-demo-toolbar__button"
          onClick={() => {
            setShowCollab((v) => !v);
            setCollabKey((k) => k + 1);
            setDemoLabel(showCollab ? "Article" : "Collab (two clients)");
          }}
        >
          {showCollab ? "Exit Collab Demo" : "Load Collab Demo"}
        </button>
        <button
          className="app-demo-toolbar__button"
          onClick={() => setShowBuildPayload((v) => !v)}
        >
          {showBuildPayload ? "Hide Build Payload" : "Show Build Payload"}
        </button>
      </div>
      {showBuildPayload && fullBuildPayload && (
        <div className="app-build-payload-overlay">
          <div className="app-build-payload-overlay__header">
            <span>Full Build Payload (live, updates as divisions change)</span>
            <div className="app-build-payload-overlay__actions">
              <button
                className="app-demo-toolbar__button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(fullBuildPayload, null, 2),
                  )
                }
              >
                Copy JSON
              </button>
              <button
                className="app-demo-toolbar__button"
                onClick={() => setShowBuildPayload(false)}
              >
                Close
              </button>
            </div>
          </div>
          <pre className="app-build-payload-overlay__body">
            {JSON.stringify(fullBuildPayload, null, 2)}
          </pre>
        </div>
      )}
      {showCollab ? (
        <CollabDemo
          key={collabKey}
          divisions={DEMO_DIVISIONS}
          title="Collab Demo"
        />
      ) : (
      <Editors
        onContentChange={handleContentChange}
        title={title}
        onTitleChange={(value) => setTitle(value || "Document Title")}
        onSaveButton={() => console.log("Save clicked")}
        saveButtonLabel="Save and ..."
        onCancelButton={() => console.log("Cancel clicked")}
        cancelButtonLabel="Cancel"
        onFeedbackSubmit={handleFeedbackSubmit}
        projectUrl="https://example.com/projects/demo"
        onSave={() => console.log("Save triggered via keyboard")}
        onPreviewRebuild={handlePreviewRebuild}
        projectType={projectType}
        projectAssets={projectAssets}
        onAssetInsert={handleAssetInsert}
        onAssetUpload={handleAssetUpload}
        onAssetFetchUrl={handleAssetFetchUrl}
        onCreateDoenet={handleCreateDoenet}
        onAssetRemove={handleAssetRemove}
        onAssetUpdate={handleAssetUpdate}
        divisions={divisions}
        activeDivisionId={activeDivisionId}
        onDivisionSelect={handleDivisionSelect}
        onDivisionAdd={handleDivisionAdd}
        onDivisionRemove={handleDivisionRemove}
        onDivisionUpdate={handleDivisionUpdate}
        hideAssets={false}
      />
      )}
    </>
  );
}

export default App;
