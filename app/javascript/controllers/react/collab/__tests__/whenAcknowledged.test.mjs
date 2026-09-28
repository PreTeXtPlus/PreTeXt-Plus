import { describe, it, expect, vi, afterEach } from "vitest";

// See presenceAnswerBack.test.mjs for why these are mocked.
vi.mock("@pretextbook/web-editor", () => ({ seedDocFromState: vi.fn() }));
vi.mock("@rails/actioncable", () => ({ createConsumer: vi.fn() }));
vi.mock("../reportIncident", () => ({ reportCollabIncident: vi.fn() }));

const { YCableProvider } = await import("../yCableProvider.js");

/**
 * Leaving the editor in a collaborative session waits on `whenAcknowledged`:
 * an edit the server has not acked exists only in this tab, so navigating away
 * before the ack would drop it. These pin down that it waits for the queue to
 * drain, and that it gives up rather than holding the author forever.
 */

afterEach(() => {
  vi.useRealTimers();
});

// A provider with `connect` never called and a stand-in for yrby-client's
// ActionCableProvider, whose `hasPending` the test flips by hand.
const makeProvider = (hasPending) => {
  const provider = new YCableProvider({
    projectId: "project-1",
    csrfToken: "csrf",
    user: { name: "Ada", color: "#123456" },
  });
  provider.provider = { hasPending, status: "synced" };
  return provider;
};

describe("YCableProvider#whenAcknowledged", () => {
  it("resolves true at once when nothing is pending", async () => {
    await expect(makeProvider(false).whenAcknowledged(1000)).resolves.toBe(true);
  });

  it("resolves true once the server acks the last pending edit", async () => {
    vi.useFakeTimers();
    const provider = makeProvider(true);
    const result = provider.whenAcknowledged(1000);

    await vi.advanceTimersByTimeAsync(200);
    provider.provider.hasPending = false;
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(true);
  });

  it("resolves false when the ack does not come in time", async () => {
    vi.useFakeTimers();
    const provider = makeProvider(true);
    const result = provider.whenAcknowledged(1000);

    await vi.advanceTimersByTimeAsync(1100);

    await expect(result).resolves.toBe(false);
  });

  it("reports a dropped socket as not connected", () => {
    const provider = makeProvider(false);
    expect(provider.isConnected).toBe(true);
    provider.provider.status = "connecting";
    expect(provider.isConnected).toBe(false);
  });
});
