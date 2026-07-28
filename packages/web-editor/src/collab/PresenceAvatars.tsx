/**
 * Colored avatar chips for everyone else in the session, driven by awareness
 * states. Rendered in the menu bar when collaboration is active.
 */
import { useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { CollabUser } from "./types";
import "./PresenceAvatars.css";

interface Peer {
  clientId: number;
  user: CollabUser;
}

// Awareness snapshots for useSyncExternalStore: cache by comparing the peers'
// identity-relevant fields so unrelated awareness churn (cursor moves) doesn't
// re-render the chips.
const snapshotCache = new WeakMap<Awareness, { key: string; peers: Peer[] }>();
const getPeers = (awareness: Awareness): Peer[] => {
  const peers: Peer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = state?.user;
    if (!user?.name) return;
    peers.push({ clientId, user });
  });
  peers.sort((a, b) => a.clientId - b.clientId);
  const key = peers
    .map((p) => `${p.clientId}:${p.user.name}:${p.user.color}`)
    .join("|");
  const cached = snapshotCache.get(awareness);
  if (cached && cached.key === key) return cached.peers;
  snapshotCache.set(awareness, { key, peers });
  return peers;
};

const PresenceAvatars = ({ awareness }: { awareness: Awareness }) => {
  const peers = useSyncExternalStore(
    (onChange) => {
      awareness.on("change", onChange);
      return () => awareness.off("change", onChange);
    },
    () => getPeers(awareness),
  );

  if (peers.length === 0) return null;
  return (
    <div
      className="pretext-plus-editor__presence"
      aria-label={`${peers.length} other ${peers.length === 1 ? "person" : "people"} editing`}
    >
      {peers.map((peer) => (
        <span
          key={peer.clientId}
          className="pretext-plus-editor__presence-avatar"
          style={{ backgroundColor: peer.user.color }}
          title={peer.user.name}
        >
          {(peer.user.name.trim()[0] ?? "?").toUpperCase()}
        </span>
      ))}
    </div>
  );
};

export default PresenceAvatars;
