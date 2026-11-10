/**
 * The latest-wins queue every runtime's renders go through: at most one job
 * running, at most one waiting, and a newer job supersedes the one waiting —
 * everyone who asked gets the newer result. An author typing produces more
 * requests than an engine answers, and only the last one matters.
 */
import type { RenderResult } from "./types";

type Settle = { resolve: (value: RenderResult) => void; reject: (error: Error) => void };

export type RenderQueue<Job> = (job: Job) => Promise<RenderResult>;

export function createRenderQueue<Job>(run: (job: Job) => Promise<RenderResult>): RenderQueue<Job> {
  let inFlight: Promise<void> | null = null;
  let waiting: { job: Job; settle: Settle[] } | null = null;

  const drain = async () => {
    while (waiting) {
      const { job, settle } = waiting;
      waiting = null;
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
      const settle = { resolve, reject };
      waiting = waiting ? { job, settle: [...waiting.settle, settle] } : { job, settle: [settle] };
      inFlight ??= drain();
    });
}
