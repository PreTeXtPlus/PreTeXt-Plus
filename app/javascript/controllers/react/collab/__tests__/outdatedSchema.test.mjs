import { describe, it, expect, vi, afterEach } from "vitest";

// See presenceAnswerBack.test.mjs for why these are mocked. The layout version
// is the one thing under test, so it is given a value here.
vi.mock("@pretextbook/web-editor", () => ({
  seedDocFromState: vi.fn(),
  COLLAB_SCHEMA_VERSION: 2,
}));
vi.mock("@rails/actioncable", () => ({ createConsumer: vi.fn() }));
vi.mock("../reportIncident", () => ({ reportCollabIncident: vi.fn() }));

const { YCableProvider, CollabOutdatedError } = await import("../yCableProvider.js");

/**
 * A tab left open across a deploy that changed the shared document's layout is
 * refused by the server -- at the seed (426) and on the channel. These pin down
 * that the tab finds out, so the editor can ask for a reload rather than sit on
 * "Connecting…" or quietly stop saving.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeProvider = (onOutdated = vi.fn()) =>
  new YCableProvider({
    projectId: "project-1",
    csrfToken: "csrf",
    user: { name: "Ada", color: "#123456" },
    onOutdated,
  });

const respond = (status, body = {}) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe("joining with an out-of-date layout", () => {
  it("fails with CollabOutdatedError when the seed is refused as outdated", async () => {
    vi.stubGlobal("fetch", respond(426));
    const provider = makeProvider();
    await expect(provider.connect(() => ({}))).rejects.toBeInstanceOf(CollabOutdatedError);
    // Never got as far as opening a socket.
    expect(provider.provider).toBeNull();
  });
});

describe("YCableProvider#checkOutdated, after the channel refuses the tab", () => {
  it("reports a layout the server no longer holds, once", async () => {
    vi.stubGlobal("fetch", respond(200, { schema_version: 3 }));
    const onOutdated = vi.fn();
    const provider = makeProvider(onOutdated);

    await expect(provider.checkOutdated()).resolves.toBe(true);
    await provider.checkOutdated();
    expect(onOutdated).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the layout matches -- the refusal was for something else", async () => {
    vi.stubGlobal("fetch", respond(200, { schema_version: 2 }));
    const onOutdated = vi.fn();
    await expect(makeProvider(onOutdated).checkOutdated()).resolves.toBe(false);
    expect(onOutdated).not.toHaveBeenCalled();
  });

  it("says nothing when the server can't be asked", async () => {
    vi.stubGlobal("fetch", respond(403));
    const onOutdated = vi.fn();
    await expect(makeProvider(onOutdated).checkOutdated()).resolves.toBe(false);
    expect(onOutdated).not.toHaveBeenCalled();
  });
});

describe("a refused channel subscription", () => {
  it("asks the server whether this tab is out of date", async () => {
    vi.stubGlobal("fetch", respond(200, { schema_version: 3 }));
    const onOutdated = vi.fn();
    const provider = makeProvider(onOutdated);
    // Stand in for ActionCable: capture the callbacks the subscription gets.
    let callbacks;
    const consumer = { subscriptions: { create: (_channel, mixin) => (callbacks = mixin) } };
    const ownRejected = vi.fn();
    provider.watchedConsumer(consumer).subscriptions.create("ProjectDocChannel", {
      rejected: ownRejected,
    });

    callbacks.rejected();
    await vi.waitFor(() => expect(onOutdated).toHaveBeenCalledTimes(1));
    // yrby-client's own handler still runs.
    expect(ownRejected).toHaveBeenCalled();
  });
});
