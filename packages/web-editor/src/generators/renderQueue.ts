/**
 * The latest-wins queue every runtime's renders go through: at most one job
 * running, at most one waiting, and a newer job supersedes the one waiting —
 * everyone who asked gets the newer result. An author typing produces more
 * requests than an engine answers, and only the last one matters.
 *
 * Jobs of different kinds (`kindOf`: a tactile render and a visual one) do not
 * supersede each other, since one is no answer to the other: each kind has its
 * own waiting slot, and they run in the order they were first queued.
 */
import type { RenderResult } from "./types";

type Settle = { resolve: (value: RenderResult) => void; reject: (error: Error) => void };

export type RenderQueue<Job> = (job: Job) => Promise<RenderResult>;

export function createRenderQueue<Job>(
  run: (job: Job) => Promise<RenderResult>,
  kindOf: (job: Job) => string = () => "",
): RenderQueue<Job> {
  let inFlight: Promise<void> | null = null;
  // By kind; a Map keeps the order each kind was first queued in.
  const waiting = new Map<string, { job: Job; settle: Settle[] }>();

  const drain = async () => {
    for (let next = waiting.entries().next(); !next.done; next = waiting.entries().next()) {
      const [kind, { job, settle }] = next.value;
      waiting.delete(kind);
      try {
        const result = await run(job);
        settle.forEach((p) => p.resolve(result));
      } catch (cause) {
        settle.forEach((p) => p.reject(cause instanceof Error ? cause : new Error(String(cause))));
      }
    }
    inFlight = null;
  };

  return (job) =>
    new Promise<RenderResult>((resolve, reject) => {
      const kind = kindOf(job);
      const superseded = waiting.get(kind)?.settle ?? [];
      waiting.set(kind, { job, settle: [...superseded, { resolve, reject }] });
      inFlight ??= drain();
    });
}
