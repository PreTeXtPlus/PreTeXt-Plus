/**
 * @vitest-environment jsdom
 *
 * A cursor-scoped preview renders the division around the cursor and follows
 * it — but only when it leaves what is on screen. Every re-render is a
 * stylesheet run, so the discipline is in what does *not* trigger one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LivePreview from "../components/LivePreview";
import { renderPreviewHtml, type PreviewRender } from "../components/wasmPreview";

vi.mock("../components/wasmPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/wasmPreview")>();
  return {
    ...actual,
    isLocalPreviewAvailable: () => true,
    renderPreviewHtml: vi.fn(),
  };
});

const mockedRender = vi.mocked(renderPreviewHtml);

/** A chapter in the buffer: its own intro, then two sections. */
const SOURCE_MAP: PreviewRender["sourceMap"] = [
  { id: "ch", file: "/source/division.ptx", line: 1, column: 1, endLine: 30 },
  { id: "ch-intro", file: "/source/division.ptx", line: 3, column: 1, endLine: 5, parent: "ch" },
  { id: "s1", file: "/source/division.ptx", line: 6, column: 1, endLine: 15, parent: "ch" },
  { id: "s2", file: "/source/division.ptx", line: 16, column: 1, endLine: 29, parent: "ch" },
];

const rendered = (subtree: PreviewRender["subtree"]): PreviewRender => ({
  html: "<!doctype html><html><head></head><body></body></html>",
  sourceMap: SOURCE_MAP,
  target: "html",
  printouts: [],
  ...(subtree ? { subtree } : {}),
});

const summaryOfChapter = rendered({
  id: "ch",
  level: 1,
  collapsed: true,
  children: ["s1", "s2"],
});
const sectionOne = rendered({ id: "s1", level: 2, collapsed: false, children: [] });

const subtreeOfCall = (index: number) =>
  mockedRender.mock.calls[index][1]?.subtree;

/** Let the render promise settle and React commit what it set. */
const settle = () => act(async () => {});

const worksheet = (): PreviewRender => ({
  ...rendered(undefined),
  printouts: [{ id: "ws-1", type: "Worksheet", number: "1.1", title: "Practice", label: "Worksheet 1.1 Practice" }],
  rootPrintout: "ws-1",
});

describe("LivePreview print layout", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedRender.mockReset();
    mockedRender.mockResolvedValue(worksheet());
  });

  const layout = () => screen.getByRole("combobox", { name: "Preview layout" }) as HTMLSelectElement;

  it("opens a worksheet in the web view by default", async () => {
    render(<LivePreview content="<worksheet/>" divisionId="ws-1" fragment />);
    await settle();
    expect(layout().value).toBe("");
  });

  it("remembers paper once chosen, and the web view once chosen back", async () => {
    const { unmount } = render(<LivePreview content="<worksheet/>" divisionId="ws-1" fragment />);
    await settle();
    fireEvent.change(layout(), { target: { value: "ws-1" } });
    expect(layout().value).toBe("ws-1");
    unmount();

    // Another worksheet, later: on paper without being asked.
    render(<LivePreview content="<worksheet/>" divisionId="ws-2" fragment />);
    await settle();
    expect(layout().value).toBe("ws-1");
    fireEvent.change(layout(), { target: { value: "" } });
    expect(localStorage.getItem("pretext-plus:preview-print-layout")).toBe("web");
  });
});

describe("LivePreview scope", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedRender.mockReset();
    mockedRender.mockResolvedValue(summaryOfChapter);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders once on mount, not again when the content debounce would fire", async () => {
    render(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="editor" cursorLine={8} />,
    );
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it("renders everything in the editor scope", async () => {
    render(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="editor" cursorLine={8} />,
    );
    await settle();
    expect(mockedRender).toHaveBeenCalledTimes(1);
    expect(subtreeOfCall(0)).toBeUndefined();
  });

  it("renders the division at the cursor, from the top of the text before any report", async () => {
    const { rerender } = render(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" />,
    );
    await settle();
    expect(subtreeOfCall(0)).toEqual({ line: 1 });

    // Moving into a listed section renders that section.
    mockedRender.mockResolvedValue(sectionOne);
    rerender(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={8} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(subtreeOfCall(1)).toEqual({ line: 8 });
  });

  it("does not re-render while the cursor stays on the rendered page", async () => {
    mockedRender.mockResolvedValue(sectionOne);
    const { rerender } = render(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={8} />,
    );
    await settle();
    expect(mockedRender).toHaveBeenCalledTimes(1);

    for (const line of [9, 12, 15, 6]) {
      rerender(
        <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={line} />,
      );
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }
    expect(mockedRender).toHaveBeenCalledTimes(1);

    // Out of the section: one render, with the cursor as of when it fires.
    rerender(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={20} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(subtreeOfCall(1)).toEqual({ line: 20 });
  });

  it("debounces a cursor sweeping through several divisions into one render", async () => {
    mockedRender.mockResolvedValue(sectionOne);
    const { rerender } = render(
      <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={8} />,
    );
    await settle();

    for (const line of [16, 20, 25]) {
      rerender(
        <LivePreview content="<chapter/>" divisionId="ch" fragment scope="cursor" cursorLine={line} />,
      );
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(mockedRender).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(subtreeOfCall(1)).toEqual({ line: 25 });
  });

  it("keeps a short complete document whole, but never a fragment's context", async () => {
    render(
      <LivePreview content="<pretext/>" divisionId="doc" scope="cursor" cursorLine={2} />,
    );
    await settle();
    expect(subtreeOfCall(0)).toEqual({ line: 2, wholeDocumentUpTo: 1500 });
  });

  it("always renders a deck whole", async () => {
    render(
      <LivePreview
        content="<slideshow/>"
        divisionId="deck"
        documentTarget="slides"
        scope="cursor"
        cursorLine={2}
        onScopeChange={() => {}}
      />,
    );
    await settle();
    expect(subtreeOfCall(0)).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Preview scope" })).toBeNull();
  });

  it("offers the scope choice when the host can take it, and re-renders on a change", async () => {
    const onScopeChange = vi.fn();
    const { rerender } = render(
      <LivePreview
        content="<chapter/>"
        divisionId="ch"
        fragment
        scope="cursor"
        cursorLine={8}
        onScopeChange={onScopeChange}
      />,
    );
    await settle();
    const group = screen.getByRole("group", { name: "Preview scope" });
    const everything = screen.getByRole("button", { name: "Everything" });
    expect(group).toContainElement(everything);
    expect(screen.getByRole("button", { name: "At cursor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(everything);
    expect(onScopeChange).toHaveBeenCalledWith("editor");

    rerender(
      <LivePreview
        content="<chapter/>"
        divisionId="ch"
        fragment
        scope="editor"
        cursorLine={8}
        onScopeChange={onScopeChange}
      />,
    );
    await settle();
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(subtreeOfCall(1)).toBeUndefined();
  });
});
