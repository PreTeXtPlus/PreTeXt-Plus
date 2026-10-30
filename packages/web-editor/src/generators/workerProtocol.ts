/**
 * What every generator's worker answers with. Plain data only, so a worker can
 * import this without pulling in anything of the main thread's. A request is
 * the generator's own (`load` and `render`, with whatever its engine needs).
 */
export type GeneratorWorkerResponse =
  | { type: "progress"; token: number; message: string }
  | { type: "loaded"; token: number }
  | { type: "rendered"; token: number; svg: string; annotations: string | null }
  /** `log` is the engine's whole transcript, when it keeps one. */
  | { type: "failed"; token: number; message: string; log?: string };
