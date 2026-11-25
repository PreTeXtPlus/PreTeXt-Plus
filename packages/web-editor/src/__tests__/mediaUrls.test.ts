import { describe, it, expect } from "vitest";
import { mediaElement, parseMediaLink } from "../mediaUrls";

describe("parseMediaLink", () => {
  it.each([
    ["https://www.desmos.com/calculator/jvnxfq0n4e", { kind: "desmos", id: "jvnxfq0n4e" }],
    ["  https://desmos.com/calculator/jvnxfq0n4e?lang=en\n", { kind: "desmos", id: "jvnxfq0n4e" }],
    ["https://www.geogebra.org/m/jybewqhg", { kind: "geogebra", id: "jybewqhg" }],
    ["https://www.geogebra.org/calculator/jybewqhg", { kind: "geogebra", id: "jybewqhg" }],
    ["https://ggbm.at/jybewqhg", { kind: "geogebra", id: "jybewqhg" }],
    ["https://www.geogebra.org/material/show/id/jybewqhg", { kind: "geogebra", id: "jybewqhg" }],
    ["https://www.geogebra.org/material/iframe/id/jybewqhg/width/800/height/600", { kind: "geogebra", id: "jybewqhg" }],
    ["https://www.youtube.com/watch?v=M7lc1UVf-VE", { kind: "youtube", id: "M7lc1UVf-VE" }],
    ["https://m.youtube.com/watch?v=M7lc1UVf-VE&list=PL123", { kind: "youtube", id: "M7lc1UVf-VE" }],
    ["https://youtu.be/M7lc1UVf-VE?si=abc", { kind: "youtube", id: "M7lc1UVf-VE" }],
    ["https://youtu.be/M7lc1UVf-VE?t=90", { kind: "youtube", id: "M7lc1UVf-VE", start: 90 }],
    ["https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1m30s", { kind: "youtube", id: "M7lc1UVf-VE", start: 90 }],
    ["https://www.youtube.com/embed/M7lc1UVf-VE?start=12", { kind: "youtube", id: "M7lc1UVf-VE", start: 12 }],
    ["https://www.youtube.com/shorts/M7lc1UVf-VE", { kind: "youtube", id: "M7lc1UVf-VE" }],
    ["https://doenet.org/embed/ogp7kp5cGaCUCEYyWeQ8mF", { kind: "doenet", id: "ogp7kp5cGaCUCEYyWeQ8mF" }],
    ["https://www.doenet.org/embed/ogp7kp5cGaCUCEYyWeQ8mF", { kind: "doenet", id: "ogp7kp5cGaCUCEYyWeQ8mF" }],
    // A site's embed code is read as the link in its src.
    [
      '<iframe src="https://doenet.org/embed/ogp7kp5cGaCUCEYyWeQ8mF" width="100%" height="800" style="border: 0"></iframe>',
      { kind: "doenet", id: "ogp7kp5cGaCUCEYyWeQ8mF" },
    ],
    [
      '  <iframe width="560" height="315" src="https://www.youtube.com/embed/M7lc1UVf-VE?si=x&amp;start=12" ' +
        'title="YouTube video player" frameborder="0" allowfullscreen></iframe>\n',
      { kind: "youtube", id: "M7lc1UVf-VE", start: 12 },
    ],
    ["<IFRAME SRC='https://www.desmos.com/calculator/jvnxfq0n4e?embed'/>", { kind: "desmos", id: "jvnxfq0n4e" }],
  ])("reads %s", (text, link) => {
    expect(parseMediaLink(text)).toEqual(link);
  });

  it.each([
    "See https://www.desmos.com/calculator/jvnxfq0n4e for the graph",
    "https://www.desmos.com/calculator/jvnxfq0n4e https://youtu.be/M7lc1UVf-VE",
    "https://www.desmos.com/calculator", // a blank calculator, not a saved graph
    "https://www.desmos.com/3d/abcdef1234", // `@desmos` cannot frame the 3D calculator
    "https://www.geogebra.org/u/someone",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=tooshort",
    'https://www.youtube.com/watch?v=M7lc1UVf-V"',
    "https://example.org/watch?v=M7lc1UVf-VE",
    "https://notdesmos.com/calculator/jvnxfq0n4e",
    "desmos.com/calculator/jvnxfq0n4e",
    "https://doenet.org/activityViewer/ogp7kp5cGaCUCEYyWeQ8mF", // only the embed page reports its height
    "https://doenet.org/embed/short",
    '<iframe src="https://doenet.org/embed/ogp7kp5cGaCUCEYyWeQ8mF"></iframe><p>And more.</p>',
    '<iframe src="https://example.org/page"></iframe>',
    "<iframe></iframe>",
    "",
  ])("leaves %s alone", (text) => {
    expect(parseMediaLink(text)).toBeUndefined();
  });
});

describe("mediaElement", () => {
  it("writes the element the Insert menu writes, without an id of its own", () => {
    expect(mediaElement({ kind: "desmos", id: "jvnxfq0n4e" })).toBe(
      '<interactive desmos="jvnxfq0n4e" width="80%" aspect="4:3"/>',
    );
    expect(mediaElement({ kind: "geogebra", id: "jybewqhg" })).toBe(
      '<interactive geogebra="jybewqhg" width="80%" aspect="4:3"/>',
    );
    expect(mediaElement({ kind: "youtube", id: "M7lc1UVf-VE", start: 90 })).toBe(
      '<video youtube="M7lc1UVf-VE" start="90" width="80%"/>',
    );
  });

  it("frames a doenet.org activity at full width, its height following the activity", () => {
    expect(mediaElement({ kind: "doenet", id: "ogp7kp5cGaCUCEYyWeQ8mF" })).toBe(
      '<interactive iframe="https://doenet.org/embed/ogp7kp5cGaCUCEYyWeQ8mF" width="100%" resize-behavior="responsive"/>',
    );
  });
});
