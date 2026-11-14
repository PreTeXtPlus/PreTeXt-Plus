/**
 * Multi-file assembly (`assembleProjectFiles`): the project an author
 * downloads. The property everything else rests on is that processing the
 * `xi:include`s gives back the single-file document a build is handed, so
 * each case here expands the files and compares.
 */
import { describe, it, expect } from "vitest";
import {
  XINCLUDE_NAMESPACE,
  assembleFullProjectSource,
  assembleProjectFiles,
  withExternalDirectory,
  type SourceFile,
} from "../sectionUtils";
import { escapeText } from "../xmlUtils";
import type { Asset, Exercise, Snippet } from "../types/editor";
import type { Division } from "../types/sections";

const division = (
  xmlId: string,
  type: Division["type"],
  source: string,
  extra: Partial<Division> = {},
): Division => ({
  id: xmlId,
  xmlId,
  type,
  title: xmlId,
  source,
  sourceFormat: "pretext",
  ...extra,
} as Division);

const doenet = (ref: string, source: string): Exercise => ({
  id: ref,
  ref,
  title: "Try it",
  source,
  sourceFormat: "doenetml",
  attrs: { width: "100%" },
});

const fileMap = (files: SourceFile[]) => new Map(files.map((f) => [f.path, f.content]));

/**
 * A minimal XInclude processor for the two forms assembly writes. Text
 * includes come back as a CDATA section, which is how the single file spells
 * the same text.
 */
function expand(files: Map<string, string>, path = "main.ptx"): string {
  const content = files.get(path);
  if (content === undefined) throw new Error(`no file ${path}`);
  return content
    .replace(/^<\?xml[^>]*\?>\n/, "")
    .replace(/\n$/, "")
    .replace(/<xi:include href="([^"]+)"( parse="text")?\/>/g, (_m, href: string, text?: string) => {
      // A PreFigure file declares the namespace its element inherited inline.
      if (!text) return expand(files, href).replace(' xmlns="https://prefigure.org"', "");
      const body = files.get(href);
      if (body === undefined) throw new Error(`no file ${href}`);
      // The single file spells a Doenet source as CDATA and a generator's as escaped text.
      return href.startsWith("doenet/") ? `<![CDATA[${body}]]>` : escapeText(body);
    })
    .split(` xmlns:xi="${XINCLUDE_NAMESPACE}"`)
    .join("");
}

const DOCINFO = "<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>";

function both(
  divisions: Division[],
  exercises: Exercise[] = [],
  snippets: Snippet[] = [],
  assets: Asset[] = [],
) {
  const single = assembleFullProjectSource(divisions, "book", DOCINFO, assets, "en-US", snippets, exercises);
  const files = assembleProjectFiles(divisions, "book", DOCINFO, assets, "en-US", snippets, exercises);
  return { single, files, map: fileMap(files) };
}

describe("withExternalDirectory", () => {
  it("adds a directories element to a docinfo that has none", () => {
    expect(withExternalDirectory("<docinfo><macros>\\x</macros></docinfo>", "../assets")).toBe(
      '<docinfo><macros>\\x</macros>\n  <directories external="../assets"/>\n</docinfo>',
    );
    expect(withExternalDirectory("", "../assets")).toBe(
      '<docinfo>\n  <directories external="../assets"/>\n</docinfo>',
    );
  });

  it("sets the attribute on an element already there, keeping its others", () => {
    expect(withExternalDirectory('<docinfo><directories data="data"/></docinfo>', "../assets")).toBe(
      '<docinfo><directories data="data" external="../assets"/></docinfo>',
    );
    expect(withExternalDirectory('<docinfo><directories external="x"/></docinfo>', "../assets")).toBe(
      '<docinfo><directories external="../assets"/></docinfo>',
    );
  });
});

describe("assembleProjectFiles", () => {
  const divisions = [
    division("book", "book", '<plus:chapter ref="ch-one"/>\n<plus:chapter ref="ch-two" component="extra"/>'),
    division("ch-one", "chapter", '<p>One.</p>\n<plus:section ref="sec-a"/>'),
    division("sec-a", "section", '<p>A.</p>\n<plus:exercise ref="act"/>'),
    division("ch-two", "chapter", "<p>Two.</p>"),
  ];
  const exercises = [doenet("act", '<p>Is <m>x < 2</m>?</p>\n<answer>yes</answer>')];

  it("writes main.ptx, docinfo.ptx, a file per division and a file per activity", () => {
    const { files, map } = both(divisions, exercises);

    expect(files[0].path).toBe("main.ptx");
    expect([...map.keys()].sort()).toEqual([
      "ch-one.ptx",
      "ch-two.ptx",
      "docinfo.ptx",
      "doenet/act.doenet",
      "main.ptx",
      "sec-a.ptx",
    ]);
    // The root division stays in the main file, around its includes.
    expect(map.get("main.ptx")).toContain(`<pretext xml:lang="en-US" xmlns:xi="${XINCLUDE_NAMESPACE}">`);
    expect(map.get("main.ptx")).toContain('<xi:include href="docinfo.ptx"/>');
    expect(map.get("main.ptx")).toContain('<xi:include href="ch-one.ptx"/>');
    expect(map.get("main.ptx")).not.toContain("<p>One.</p>");
  });

  it("declares the xi namespace on a file that includes another, and only there", () => {
    const { map } = both(divisions, exercises);

    expect(map.get("ch-one.ptx")).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<chapter [^>]*xmlns:xi=/);
    expect(map.get("ch-one.ptx")).toContain('<xi:include href="sec-a.ptx"/>');
    expect(map.get("ch-two.ptx")).not.toContain("xmlns:xi");
  });

  it("keeps DoenetML as typed in its own file, included as text", () => {
    const { map } = both(divisions, exercises);

    expect(map.get("doenet/act.doenet")).toBe('<p>Is <m>x < 2</m>?</p>\n<answer>yes</answer>');
    expect(map.get("sec-a.ptx")).toContain(
      '<slate surface="doenetml"><xi:include href="doenet/act.doenet" parse="text"/></slate>',
    );
    expect(map.get("sec-a.ptx")).not.toContain("CDATA");
    // The docinfo names a DoenetML version though no single file's body is the whole document.
    expect(map.get("docinfo.ptx")).toContain("<doenetml version=");
  });

  it("expands to the single-file document", () => {
    const { single, map } = both(divisions, exercises);
    expect(expand(map)).toBe(single);
  });

  it("writes a placement's attributes into its file", () => {
    const { map } = both(divisions, exercises);
    expect(map.get("ch-two.ptx")).toMatch(/<chapter [^>]*component="extra"/);
  });

  it("keeps an instance-qualified placement whole, in a file named for the instance", () => {
    const twice = [
      division("book", "book", '<plus:chapter ref="ch"/>\n<plus:chapter ref="ch" instance="again"/>'),
      division("ch", "chapter", '<p xml:id="para">P.</p>\n<plus:section ref="sec"/>'),
      division("sec", "section", "<p>S.</p>"),
    ];
    const { single, map } = both(twice);

    expect([...map.keys()].sort()).toEqual(["ch-again.ptx", "ch.ptx", "docinfo.ptx", "main.ptx", "sec.ptx"]);
    // Identifiers beneath the instance are qualified, so the section is inline there.
    expect(map.get("ch-again.ptx")).toContain('xml:id="sec-again"');
    expect(map.get("ch-again.ptx")).not.toContain("xi:include");
    expect(expand(map)).toBe(single);
  });

  it("leaves what cannot be a file inline", () => {
    const awkward = [
      division("book", "book", '<plus:chapter ref="gone"/>\n<plus:chapter ref="main"/>\n<plus:snippet ref="snip"/>'),
      division("main", "chapter", "<p>Named like the main file.</p>"),
    ];
    const snippets = [
      { id: "snip", ref: "snip", title: "", source: "<p>One.</p>\n<p>Two.</p>", sourceFormat: "pretext" },
    ] as Snippet[];
    const { single, map } = both(awkward, [], snippets);

    expect([...map.keys()].sort()).toEqual(["docinfo.ptx", "main-division.ptx", "main.ptx"]);
    expect(map.get("main.ptx")).toContain("<!-- missing division: gone -->");
    expect(map.get("main.ptx")).toContain("<p>One.</p>\n<p>Two.</p>");
    expect(expand(map)).toBe(single);
  });

  describe("generated assets", () => {
    const generated = (ref: string, sourceFormat: string, source: string): Asset =>
      ({ id: ref, ref, kind: "authored_asset", title: ref, sourceFormat, source }) as unknown as Asset;
    const assets = [
      generated("graph", "prefigure", '<diagram dimensions="(300,300)">\n  <coordinates bbox="(0,0,1,1)"/>\n</diagram>'),
      generated("plot", "tikz", "\\node {$a < b$} \\amp c & d;"),
      generated("curve", "asymptote", "draw((0,0)--(1,1));"),
      generated("surf", "sageplot", "plot(x^2, (x, 0, 1))"),
    ];
    const figures = [
      division(
        "book",
        "book",
        '<figure><plus:image ref="graph"/></figure>\n<figure><plus:image ref="graph" instance="again" width="50%"/></figure>\n' +
          '<plus:image ref="plot"/>\n<plus:image ref="curve"/>\n<plus:image ref="surf"/>',
      ),
    ];

    it("writes each source to a file named for its generator", () => {
      const { map } = both(figures, [], [], assets);

      expect([...map.keys()].sort()).toEqual([
        "asymptote/curve.asy",
        "docinfo.ptx",
        "main.ptx",
        "prefigure/graph.xml",
        "sageplot/surf.sage",
        "tikz/plot.tex",
      ]);
    });

    it("keeps TeX as typed, with no entities, included as text", () => {
      const { map } = both(figures, [], [], assets);

      expect(map.get("tikz/plot.tex")).toBe("\\node {$a < b$} \\amp c & d;");
      expect(map.get("main.ptx")).toContain(
        '<latex-image label="plot">\n<xi:include href="tikz/plot.tex" parse="text"/>\n</latex-image>',
      );
    });

    it("makes a PreFigure source a document in PreFigure's namespace", () => {
      const { map } = both(figures, [], [], assets);

      expect(map.get("prefigure/graph.xml")).toMatch(
        /^<\?xml version="1.0" encoding="UTF-8"\?>\n<diagram dimensions="\(300,300\)" xmlns="https:\/\/prefigure.org">/,
      );
      expect(map.get("main.ptx")).toContain(
        '<prefigure xmlns="https://prefigure.org" label="graph">\n<xi:include href="prefigure/graph.xml"/>\n</prefigure>',
      );
    });

    it("has every placement of an asset include the one file", () => {
      const { map } = both(figures, [], [], assets);
      const main = map.get("main.ptx") ?? "";

      expect(main).toContain('label="graph-again"');
      expect(main.split('<xi:include href="prefigure/graph.xml"/>')).toHaveLength(3);
    });

    it("expands to the single-file document", () => {
      const { single, map } = both(figures, [], [], assets);
      expect(expand(map)).toBe(single);
    });

    it("leaves a PreFigure source that is not one element inline", () => {
      const loose = [generated("graph", "prefigure", "<diagram/>\n<diagram/>")];
      const { single, map } = both([division("book", "book", '<plus:image ref="graph"/>')], [], [], loose);

      expect([...map.keys()].sort()).toEqual(["docinfo.ptx", "main.ptx"]);
      expect(expand(map)).toBe(single);
    });
  });

  it("converts a Markdown division on its way into a file", () => {
    const mixed = [
      division("book", "book", '<plus:chapter ref="md"/>'),
      division("md", "chapter", "Some *emphasis*.", { sourceFormat: "markdown" } as Partial<Division>),
    ];
    const { single, map } = both(mixed);

    expect(map.get("md.ptx")).toContain("<em>emphasis</em>");
    expect(expand(map)).toBe(single);
  });
});
