import { describe, it, expect, vi } from "vitest";
import { IMPORT_SHARE_URL, buildImportShare } from "../importShare.js";
import { buildImportEngines } from "../importEngines.js";

/**
 * Both import UIs hand `buildImportShare` the same `ConversionShare` and rely on
 * it to reach `projects#import_share` in the shape that action reads. What is
 * worth pinning is that shape — the form fields, the CSRF header — and that a
 * failure comes back as a sentence, since the wizard shows it to the author.
 */

const ok = () => vi.fn(async () => ({ ok: true, status: 202 }));
const file = new File(["binary"], "report.docx");

describe("buildImportShare", () => {
  it("posts the file, the result and where it came from", async () => {
    const fetchImpl = ok();
    const share = buildImportShare({
      context: "Editor import dialog",
      csrfToken: "token",
      projectUrl: "https://pretext.plus/projects/1",
      fetchImpl,
    });

    await share({
      file,
      engineId: "pandoc-remote",
      engineLabel: "Pandoc",
      pretext: "<pretext/>",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(IMPORT_SHARE_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["X-CSRF-Token"]).toBe("token");
    const body = init.body;
    expect(body.get("file").name).toBe("report.docx");
    expect(body.get("engine")).toBe("Pandoc");
    expect(body.get("context")).toBe("Editor import dialog");
    expect(body.get("project_url")).toBe("https://pretext.plus/projects/1");
    expect(body.get("pretext")).toBe("<pretext/>");
    expect(body.has("error")).toBe(false);
  });

  it("sends a failure's error, and no project link when there is no project", async () => {
    const fetchImpl = ok();
    const share = buildImportShare({ context: "New project import", fetchImpl });

    await share({
      file,
      engineId: "pandoc-remote",
      engineLabel: "Pandoc",
      error: "Pandoc could not read this file.",
    });

    const body = fetchImpl.mock.calls[0][1].body;
    expect(body.get("error")).toBe("Pandoc could not read this file.");
    expect(body.has("pretext")).toBe(false);
    expect(body.has("project_url")).toBe(false);
  });

  it("rejects with a sentence the author can read", async () => {
    const limited = buildImportShare({
      context: "New project import",
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    const broken = buildImportShare({
      context: "New project import",
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });
    const conversion = { file, engineId: "pandoc-remote", engineLabel: "Pandoc" };

    await expect(limited(conversion)).rejects.toThrow(/try again in a few minutes/);
    await expect(broken(conversion)).rejects.toThrow("error 500");
  });
});

describe("buildImportEngines", () => {
  // The notice is what makes a conversion shareable, so it must sit on pandoc
  // alone: the built-in converter's results are not what we are asking about.
  it("marks only the pandoc engine experimental", () => {
    const [builtin, pandoc] = buildImportEngines({ pandocUrl: "/projects/pandoc" });

    expect(builtin.experimentalNotice).toBeUndefined();
    expect(pandoc.experimentalNotice).toMatch(/uses Pandoc and is still experimental/);
  });
});
