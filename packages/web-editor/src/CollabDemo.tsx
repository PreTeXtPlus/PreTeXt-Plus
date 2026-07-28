/**
 * Two-pane collaboration demo: two independent `<Editors>` instances, each
 * with its own Y.Doc + Awareness, relayed to each other in-memory (simulating
 * the network transport a real host provides). Type in one pane and watch the
 * other converge; select text to see remote cursors; add/rename/remove
 * sections in one TOC and watch the other follow.
 */
import { useState } from "react";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import Editors from "./components/Editors";
import { seedDocFromState } from "./collab/schema";
import type { CollabSession } from "./collab/types";
import type { Division } from "./types/sections";

const RELAY = "collab-demo-relay";

const relayDocs = (from: Y.Doc, to: Y.Doc) => {
  from.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== RELAY) Y.applyUpdate(to, update, RELAY);
  });
};

const relayAwareness = (from: Awareness, to: Awareness) => {
  from.on(
    "update",
    (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === RELAY) return;
      const clients = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ];
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, clients), RELAY);
    },
  );
};

const createSessionPair = (
  divisions: Division[],
  title: string,
): [CollabSession, CollabSession] => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  seedDocFromState(docA, {
    title,
    docinfo: "",
    divisions: divisions.map((d) => ({
      id: d.id ?? d.xmlId,
      xmlId: d.xmlId,
      sourceFormat: d.sourceFormat,
      source: d.source,
      title: d.title,
      type: d.type,
    })),
  });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), RELAY);
  relayDocs(docA, docB);
  relayDocs(docB, docA);

  const awarenessA = new Awareness(docA);
  const awarenessB = new Awareness(docB);
  relayAwareness(awarenessA, awarenessB);
  relayAwareness(awarenessB, awarenessA);

  return [
    { doc: docA, awareness: awarenessA, user: { name: "Ada", color: "#0e639c" } },
    { doc: docB, awareness: awarenessB, user: { name: "Blaise", color: "#b45309" } },
  ];
};

const CollabDemo = ({
  divisions,
  title,
}: {
  divisions: Division[];
  title: string;
}) => {
  const [[sessionA, sessionB]] = useState(() =>
    createSessionPair(divisions, title),
  );

  const paneProps = {
    divisions,
    title,
    projectType: "article" as const,
    onContentChange: () => {},
    // No id returned: the bridge falls back to a random shared-doc key, the
    // same path a host without immediate persistence exercises.
    onDivisionAdd: () => {},
    onDivisionRemove: () => {},
    onDivisionUpdate: () => {},
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: "2px solid #ccc" }}>
        <Editors {...paneProps} collaboration={sessionA} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Editors {...paneProps} collaboration={sessionB} />
      </div>
    </div>
  );
};

export default CollabDemo;
