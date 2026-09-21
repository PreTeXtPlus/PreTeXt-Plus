import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Pins the one third-party behaviour YCableProvider's send queue is built on:
 * that `Subscription#perform` reports whether ActionCable actually handed the
 * message to a socket.
 *
 * Worth its own file because the provider's own tests cannot establish it --
 * they stand in for the subscription, so they assume the contract rather than
 * check it. If a future @rails/actioncable stopped returning a real boolean
 * here, every `doc_update` would be queued as undelivered and the queue would
 * never drain: a tab that looks fine and silently stops collaborating, which is
 * the failure this whole branch exists to make impossible. That deserves to
 * break a build rather than a session.
 *
 * The socket below returns `undefined` from `send`, the way a real WebSocket
 * does, so this also answers the obvious worry directly: ActionCable does not
 * pass that value through.
 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
  }

  send(data) {
    this.sent.push(data);
    return undefined; // what WebSocket.prototype.send actually returns
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

const withCable = async (run) => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("removeEventListener", () => {});
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const { createConsumer } = await import("@rails/actioncable");
  const consumer = createConsumer("ws://cable.test/cable");
  const subscription = consumer.subscriptions.create({ channel: "ProjectDocChannel" }, {});
  try {
    await run({ consumer, subscription });
  } finally {
    consumer.disconnect();
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("@rails/actioncable delivery reporting", () => {
  it("returns true from perform when the socket took the message", async () => {
    await withCable(({ consumer, subscription }) => {
      const socket = new FakeWebSocket();
      consumer.connection.webSocket = socket;

      expect(subscription.perform("doc_update", { payload: "x" })).toBe(true);
      expect(socket.sent).toHaveLength(1);
    });
  });

  it("returns false from perform, and sends nothing, when the socket is closed", async () => {
    await withCable(({ consumer, subscription }) => {
      const socket = new FakeWebSocket();
      socket.readyState = FakeWebSocket.CLOSED;
      consumer.connection.webSocket = socket;

      expect(subscription.perform("doc_update", { payload: "x" })).toBe(false);
      expect(socket.sent).toHaveLength(0);
    });
  });
});
