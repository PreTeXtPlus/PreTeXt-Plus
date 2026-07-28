import { describe, it, expect } from "vitest";
import { installEditGuard } from "../collab/editGuard";

/**
 * A stand-in for Monaco's model carrying just the two write paths the guard
 * discriminates between: `pushEditOperations` (every local, undoable edit) and
 * `applyEdits` (what {@link MonacoCollabBinding} uses for remote deltas).
 */
const makeModel = () => {
  const pushed: string[] = [];
  const applied: string[] = [];
  return {
    pushed,
    applied,
    pushEditOperations(
      _before: unknown,
      operations: { range: unknown; text: string }[],
    ) {
      operations.forEach((o) => pushed.push(o.text));
      return [];
    },
    applyEdits(operations: { range: unknown; text: string }[]) {
      operations.forEach((o) => applied.push(o.text));
      return [];
    },
  };
};

const range = (
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
) => ({ startLineNumber, startColumn, endLineNumber, endColumn });

/** Body-only editable span, as a PreTeXt division with a two-line header yields. */
const EDITABLE: [number, number, number, number] = [3, 1, 3, 15];

const guarded = (
  overrides: Partial<{
    editable: [number, number, number, number] | null;
    enabled: boolean;
    bypassed: boolean;
  }> = {},
) => {
  const model = makeModel();
  const dispose = installEditGuard(model, {
    getEditableRange: () =>
      overrides.editable === undefined ? EDITABLE : overrides.editable,
    isEnabled: () => overrides.enabled ?? true,
    isBypassed: () => overrides.bypassed ?? false,
  });
  return { model, dispose };
};

describe("installEditGuard", () => {
  it("lets a local edit inside the body through", () => {
    const { model } = guarded();
    model.pushEditOperations(null, [{ range: range(3, 4, 3, 4), text: "x" }]);
    expect(model.pushed).toEqual(["x"]);
  });

  it("drops a local edit that touches a locked line", () => {
    const { model } = guarded();
    const result = model.pushEditOperations(null, [
      { range: range(1, 2, 1, 5), text: "chapter" },
    ]);
    expect(model.pushed).toEqual([]);
    expect(result).toBeNull();
  });

  it("drops the whole batch when any operation strays out of bounds", () => {
    // Matches the plugin, which reverts an entire change set — so a multi-cursor
    // edit spanning the boundary behaves identically in both modes.
    const { model } = guarded();
    model.pushEditOperations(null, [
      { range: range(3, 4, 3, 4), text: "ok" },
      { range: range(1, 2, 1, 2), text: "bad" },
    ]);
    expect(model.pushed).toEqual([]);
  });

  it("never intercepts remote deltas, whatever they touch", () => {
    // The guard's core contract: a peer editing the wrapper must still land, or
    // this client diverges from every other one.
    const { model } = guarded();
    model.applyEdits([{ range: range(1, 2, 1, 5), text: "chapter" }]);
    expect(model.applied).toEqual(["chapter"]);
  });

  it("passes structural normalization through while bypassed", () => {
    const { model } = guarded({ bypassed: true });
    model.pushEditOperations(null, [{ range: range(2, 19, 2, 19), text: "\n" }]);
    expect(model.pushed).toEqual(["\n"]);
  });

  it("stands down outside collaboration, where the plugin enforces", () => {
    const { model } = guarded({ enabled: false });
    model.pushEditOperations(null, [{ range: range(1, 2, 1, 5), text: "x" }]);
    expect(model.pushed).toEqual(["x"]);
  });

  it("allows everything when nothing is locked", () => {
    const { model } = guarded({ editable: null });
    model.pushEditOperations(null, [{ range: range(1, 2, 1, 5), text: "x" }]);
    expect(model.pushed).toEqual(["x"]);
  });

  it("restores the original method on dispose", () => {
    const { model, dispose } = guarded();
    dispose();
    model.pushEditOperations(null, [{ range: range(1, 2, 1, 5), text: "x" }]);
    expect(model.pushed).toEqual(["x"]);
  });
});
