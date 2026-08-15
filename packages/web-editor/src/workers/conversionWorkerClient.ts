import type { Division } from "../types/sections";
import type { ConversionRequest, ConversionResponse } from "./protocol";

interface PendingJob {
  resolve: (xml: string) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread handle on a conversion worker: post a division, get back its
 * converted "own xml" (see `computeDivisionOwnXml` in `sectionUtils.ts`,
 * which is what actually runs inside the worker). Multiple `convert` calls
 * may be in flight at once; each is tracked independently by id.
 */
export interface ConversionWorkerClient {
  convert(division: Division): Promise<string>;
  terminate(): void;
}

/**
 * Builds a {@link ConversionWorkerClient} from a `Worker` factory.
 *
 * Construction is defensive: `factory()` is called immediately, but a
 * synchronous throw (e.g. an environment where `Worker` doesn't exist, or a
 * CSP blocking it) is caught and turned into a `null` return rather than
 * propagating, so a caller can treat "no client" as "fall back to the
 * synchronous path" without its own try/catch.
 */
export function createConversionWorkerClient(
  factory: () => Worker,
): ConversionWorkerClient | null {
  let worker: Worker;
  try {
    worker = factory();
  } catch {
    return null;
  }

  const pending = new Map<number, PendingJob>();
  let nextId = 0;

  const failAllPending = (message: string) => {
    for (const job of pending.values()) {
      job.reject(new Error(message));
    }
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<ConversionResponse>) => {
    const { id, xml, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error !== undefined) {
      job.reject(new Error(error));
    } else {
      job.resolve(xml ?? "");
    }
  };

  // A worker-level failure (e.g. the script itself failed to load or
  // evaluate) can't be correlated to a specific job — reject everything still
  // in flight so callers fall back rather than hanging forever.
  worker.onerror = () => failAllPending("Conversion worker failed");

  return {
    convert(division: Division): Promise<string> {
      const id = nextId++;
      const request: ConversionRequest = { id, division };
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(request);
      });
    },
    terminate(): void {
      failAllPending("Conversion worker terminated");
      worker.terminate();
    },
  };
}
