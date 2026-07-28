/**
 * Minimal Monaco ↔ Y.Text binding (the y-monaco algorithm, reimplemented).
 *
 * Why not y-monaco: it imports the `monaco-editor` npm package at runtime, but
 * this library gets Monaco from `@monaco-editor/react`'s loader (a separate
 * instance, no `monaco-editor` install), so importing it would bundle a second
 * Monaco — or break consumers' builds outright. This binding instead uses only
 * the `editor`/`monaco` instances handed to us at mount.
 *
 * - Local model edits → precise `Y.Text` deltas, transacted with this binding
 *   as origin (the bridge registers it as local, so nothing echoes back).
 * - Remote `Y.Text` deltas → sequential `model.applyEdits`, guarded so they
 *   don't re-enter the local path. Monaco shifts the local cursor for edits
 *   above it automatically.
 * - Cursor presence: local selection is published to awareness as *relative*
 *   positions (stable across concurrent edits) tagged with the division key;
 *   remote states for the same division render as colored selection/caret
 *   decorations with the user's name on hover.
 */
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { CollabUser } from "./types";

interface Disposable {
  dispose(): void;
}

// One shared <style> element for all per-client cursor colors, keyed by
// awareness clientID. Rules accumulate; a stale client's rule is inert.
const CURSOR_STYLE_ID = "pretext-plus-collab-cursor-styles";
const styledClients = new Set<number>();
const ensureCursorStyle = (clientId: number, color: string): void => {
  if (typeof document === "undefined" || styledClients.has(clientId)) return;
  let style = document.getElementById(CURSOR_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = CURSOR_STYLE_ID;
    document.head.appendChild(style);
  }
  style.appendChild(
    document.createTextNode(
      `.pretext-plus-collab-selection-${clientId} { background-color: color-mix(in srgb, ${color} 25%, transparent); }
.pretext-plus-collab-caret-${clientId} { border-left: 2px solid ${color}; }
`,
    ),
  );
  styledClients.add(clientId);
};

export class MonacoCollabBinding {
  private readonly ytext: Y.Text;
  private readonly doc: Y.Doc;
  private readonly editor: any;
  private readonly monaco: any;
  private readonly awareness: Awareness | null;
  private readonly divisionKey: string;
  private applyingRemote = false;
  private disposables: Disposable[] = [];
  private cursorDecorations: any = null;
  private disposed = false;

  constructor(options: {
    ytext: Y.Text;
    editor: any;
    monaco: any;
    awareness: Awareness | null;
    user: CollabUser;
    /** Identifies which division this text belongs to, for cursor scoping. */
    divisionKey: string;
  }) {
    this.ytext = options.ytext;
    this.doc = options.ytext.doc as Y.Doc;
    this.editor = options.editor;
    this.monaco = options.monaco;
    this.awareness = options.awareness;
    this.divisionKey = options.divisionKey;

    this.ytext.observe(this.onRemoteChange);
    this.disposables.push(
      this.editor.onDidChangeModelContent((event: any) =>
        this.onLocalChange(event),
      ),
      this.editor.onDidChangeCursorSelection(() => this.publishCursor()),
    );
    if (this.awareness) {
      this.awareness.on("change", this.onAwarenessChange);
      this.publishCursor();
      this.renderRemoteCursors();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ytext.unobserve(this.onRemoteChange);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.cursorDecorations?.clear();
    if (this.awareness) {
      this.awareness.off("change", this.onAwarenessChange);
      this.awareness.setLocalStateField("cursor", null);
    }
  }

  // ── model → ytext ────────────────────────────────────────────────────────

  private onLocalChange(event: any): void {
    if (this.applyingRemote) return;
    const changes = [...event.changes].sort(
      (a: any, b: any) => b.rangeOffset - a.rangeOffset,
    );
    this.doc.transact(() => {
      // Descending offsets: each change's offsets stay valid against the
      // pre-change text while earlier (larger-offset) changes are applied.
      for (const change of changes) {
        if (change.rangeLength > 0) {
          this.ytext.delete(change.rangeOffset, change.rangeLength);
        }
        if (change.text) {
          this.ytext.insert(change.rangeOffset, change.text);
        }
      }
    }, this);
  }

  // ── ytext → model ────────────────────────────────────────────────────────

  private onRemoteChange = (
    event: Y.YTextEvent,
    transaction: Y.Transaction,
  ): void => {
    if (transaction.origin === this) return;
    const model = this.editor.getModel();
    if (!model) return;
    this.applyingRemote = true;
    try {
      // Apply delta ops one at a time: the model evolves in lockstep with the
      // delta's own index space, so each op's offsets are simply positions in
      // the current model.
      let index = 0;
      for (const op of event.delta) {
        if (op.retain !== undefined) {
          index += op.retain;
        } else if (op.insert !== undefined) {
          const text = String(op.insert);
          const position = model.getPositionAt(index);
          model.applyEdits([
            {
              range: new this.monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
              text,
              forceMoveMarkers: true,
            },
          ]);
          index += text.length;
        } else if (op.delete !== undefined) {
          const start = model.getPositionAt(index);
          const end = model.getPositionAt(index + op.delete);
          model.applyEdits([
            {
              range: new this.monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column,
              ),
              text: "",
            },
          ]);
        }
      }
    } finally {
      this.applyingRemote = false;
    }
    this.renderRemoteCursors();
  };

  // ── cursor presence ──────────────────────────────────────────────────────

  private publishCursor(): void {
    if (!this.awareness || this.disposed) return;
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();
    if (!model || !selection) return;
    const anchorOffset = model.getOffsetAt(selection.getStartPosition());
    const headOffset = model.getOffsetAt(selection.getEndPosition());
    this.awareness.setLocalStateField("cursor", {
      division: this.divisionKey,
      // Relative positions survive concurrent edits: peers resolve them
      // against their own doc state at render time.
      anchor: Y.createRelativePositionFromTypeIndex(this.ytext, anchorOffset),
      head: Y.createRelativePositionFromTypeIndex(this.ytext, headOffset),
    });
  }

  private onAwarenessChange = (): void => {
    this.renderRemoteCursors();
  };

  private renderRemoteCursors(): void {
    if (!this.awareness || this.disposed) return;
    const model = this.editor.getModel();
    if (!model) return;
    if (!this.cursorDecorations) {
      if (typeof this.editor.createDecorationsCollection !== "function") return;
      this.cursorDecorations = this.editor.createDecorationsCollection();
    }

    const decorations: any[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness!.clientID) return;
      const cursor = state?.cursor;
      if (!cursor || cursor.division !== this.divisionKey) return;
      const anchor = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(cursor.anchor),
        this.doc,
      );
      const head = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(cursor.head),
        this.doc,
      );
      // Only positions that resolve against this same Y.Text are renderable.
      if (!anchor || !head || anchor.type !== this.ytext) return;

      const user: CollabUser = state?.user ?? { name: "Anonymous", color: "#888" };
      ensureCursorStyle(clientId, user.color);
      const start = model.getPositionAt(Math.min(anchor.index, head.index));
      const end = model.getPositionAt(Math.max(anchor.index, head.index));
      const caret = model.getPositionAt(head.index);

      if (anchor.index !== head.index) {
        decorations.push({
          range: new this.monaco.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
          options: {
            className: `pretext-plus-collab-selection-${clientId}`,
            hoverMessage: { value: user.name },
            stickiness:
              this.monaco.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
        });
      }
      decorations.push({
        range: new this.monaco.Range(
          caret.lineNumber,
          caret.column,
          caret.lineNumber,
          caret.column,
        ),
        options: {
          className: `pretext-plus-collab-caret-${clientId}`,
          hoverMessage: { value: user.name },
          stickiness:
            this.monaco.editor.TrackedRangeStickiness
              .NeverGrowsWhenTypingAtEdges,
        },
      });
    });
    this.cursorDecorations.set(decorations);
  }
}
