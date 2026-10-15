/**
 * The worker-backed renderer is a promise per request, matched by token, with
 * an inline fallback for a worker that cannot render or dies. The worker
 * itself is stood in for: what matters is the protocol, not the thread.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createWorkerPreviewRenderer,
  type PreviewWorkerLike,
  type PreviewWorkerRequest,
  type PreviewWorkerResponse,
} from "../components/previewRenderer";
import { handlePreviewWorkerRequest } from "../components/previewWorkerHandler";
import {
  renderPreviewHtml,
  isLocalPreviewAvailable,
  type PreviewRender,
} from "../components/wasmPreview";

vi.mock("../components/wasmPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/wasmPreview")>();
  return {
    ...actual,
    isLocalPreviewAvailable: vi.fn(() => true),
    renderPreviewHtml: vi.fn(),
  };
});

const mockedRender = vi.mocked(renderPreviewHtml);
const mockedAvailable = vi.mocked(isLocalPreviewAvailable);

const page = (html: string): PreviewRender => ({
  html,
  sourceMap: [],
  target: "html",
  printouts: [],
});

/** A worker whose answers the test writes by hand. */
class FakeWorker implements PreviewWorkerLike {
  sent: PreviewWorkerRequest[] = [];
  terminated = false;
  private listeners: {
    message: ((event: { data: PreviewWorkerResponse }) => void)[];
    error: ((event: unknown) => void)[];
  } = { message: [], error: [] };

  postMessage(message: PreviewWorkerRequest) {
    this.sent.push(message);
  }
  addEventListener(type: "message" | "error", listener: never) {
    this.listeners[type].push(listener);
  }
  terminate() {
    this.terminated = true;
  }
  answer(data: PreviewWorkerResponse) {
    for (const listener of this.listeners.message) listener({ data });
  }
  fail() {
    for (const listener of this.listeners.error) listener(new Event("error"));
  }
}

describe("createWorkerPreviewRenderer", () => {
  beforeEach(() => {
    mockedRender.mockReset();
    mockedAvailable.mockReturnValue(true);
  });

  it("starts the worker on the first render, not before", () => {
    const makeWorker = vi.fn(() => new FakeWorker());
    const renderer = createWorkerPreviewRenderer(makeWorker);
    expect(makeWorker).not.toHaveBeenCalled();
    void renderer.render("<a/>", {});
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });

  it("settles each request with the answer that carries its token", async () => {
    const worker = new FakeWorker();
    const renderer = createWorkerPreviewRenderer(() => worker);
    const first = renderer.render("<a/>", { fragment: true });
    const second = renderer.render("<b/>", {});
    expect(worker.sent.map((m) => [m.token, m.source])).toEqual([
      [1, "<a/>"],
      [2, "<b/>"],
    ]);
    expect(worker.sent[0].options).toEqual({ fragment: true });

    // Out of order, to show the matching is by token and not by turn.
    worker.answer({ type: "rendered", token: 2, result: page("B") });
    worker.answer({ type: "failed", token: 1, message: "not well-formed" });
    await expect(second).resolves.toEqual(page("B"));
    await expect(first).rejects.toThrow("not well-formed");
    expect(mockedRender).not.toHaveBeenCalled();
  });

  it("ignores an answer to a request it no longer holds", async () => {
    const worker = new FakeWorker();
    const renderer = createWorkerPreviewRenderer(() => worker);
    const only = renderer.render("<a/>", {});
    worker.answer({ type: "rendered", token: 1, result: page("A") });
    await expect(only).resolves.toEqual(page("A"));
    expect(() =>
      worker.answer({ type: "rendered", token: 1, result: page("again") }),
    ).not.toThrow();
  });

  it("renders inline, in flight and from then on, when the worker cannot render", async () => {
    mockedRender.mockImplementation(async (source) => page(`inline:${source}`));
    const worker = new FakeWorker();
    const renderer = createWorkerPreviewRenderer(() => worker);
    const inFlight = renderer.render("<a/>", {});
    worker.answer({ type: "unavailable" });
    await expect(inFlight).resolves.toEqual(page("inline:<a/>"));
    expect(worker.terminated).toBe(true);

    await expect(renderer.render("<b/>", {})).resolves.toEqual(page("inline:<b/>"));
    expect(worker.sent).toHaveLength(1);
  });

  it("renders inline when the worker dies", async () => {
    mockedRender.mockImplementation(async (source) => page(`inline:${source}`));
    const worker = new FakeWorker();
    const renderer = createWorkerPreviewRenderer(() => worker);
    const inFlight = renderer.render("<a/>", {});
    worker.fail();
    await expect(inFlight).resolves.toEqual(page("inline:<a/>"));
  });

  it("renders inline when the worker cannot even be started", async () => {
    mockedRender.mockImplementation(async (source) => page(`inline:${source}`));
    const renderer = createWorkerPreviewRenderer(() => {
      throw new Error("no workers here");
    });
    await expect(renderer.render("<a/>", {})).resolves.toEqual(page("inline:<a/>"));
    await expect(renderer.render("<b/>", {})).resolves.toEqual(page("inline:<b/>"));
  });
});

describe("handlePreviewWorkerRequest", () => {
  beforeEach(() => {
    mockedRender.mockReset();
    mockedAvailable.mockReturnValue(true);
  });

  const request = (token: number): PreviewWorkerRequest => ({
    type: "render",
    token,
    source: "<a/>",
    options: { fragment: true },
  });

  it("posts the render back under the request's token", async () => {
    mockedRender.mockResolvedValue(page("A"));
    const post = vi.fn();
    await handlePreviewWorkerRequest(request(7), post);
    expect(mockedRender).toHaveBeenCalledWith("<a/>", { fragment: true });
    expect(post).toHaveBeenCalledWith({ type: "rendered", token: 7, result: page("A") });
  });

  it("posts a failure's message rather than throwing", async () => {
    mockedRender.mockRejectedValue(new Error("transform failed"));
    const post = vi.fn();
    await handlePreviewWorkerRequest(request(8), post);
    expect(post).toHaveBeenCalledWith({ type: "failed", token: 8, message: "transform failed" });
  });

  it("says so when its engine cannot render", async () => {
    mockedAvailable.mockReturnValue(false);
    const post = vi.fn();
    await handlePreviewWorkerRequest(request(9), post);
    expect(post).toHaveBeenCalledWith({ type: "unavailable" });
    expect(mockedRender).not.toHaveBeenCalled();
  });
});
