import { useEffect, useRef, useState } from "react";
import type { Division } from "../types/sections";
import { primeDivisionOwnXml } from "../sectionUtils";
import { createConversionWorkerClient, type ConversionWorkerClient } from "./conversionWorkerClient";

/**
 * Proactively converts every LaTeX/Markdown division in `divisions` on a
 * background Worker as soon as it appears/changes, priming the same
 * `WeakMap` cache the synchronous assembly path already reads (see
 * `primeDivisionOwnXml`/`getDivisionOwnXml` in `sectionUtils.ts`). This only
 * changes *when* the cache gets filled, never *what* gets rendered — the
 * synchronous path is unchanged and still used for every render; it just now
 * usually finds a warm cache instead of doing the conversion itself. Worst
 * case (a division needed before its background job lands) is unchanged too:
 * that one division converts synchronously, same as before this hook existed.
 *
 * Returns a version counter that increments each time a background job
 * primes a previously-uncached division, so a caller can add it to a
 * `useMemo` dependency array to react to a newly-warmed cache — the `WeakMap`
 * write itself is invisible to React.
 *
 * `workerFactory` is optional and evaluated once, defensively, at mount: if
 * it's omitted, or constructing the worker throws, or the worker fails at
 * runtime, this hook simply never primes anything and the caller's existing
 * synchronous fallback handles every division exactly as it does without a
 * worker. (A `workerFactory` identity that changes on a later render is
 * intentionally ignored — the worker is built once per mount, not torn down
 * and rebuilt whenever a host passes a fresh inline function.)
 */
export function useBackgroundDivisionConversion(
  divisions: Division[] | undefined,
  workerFactory?: () => Worker,
): number {
  const [version, setVersion] = useState(0);
  const clientRef = useRef<ConversionWorkerClient | null>(null);
  // Every division ever queued (converted or in flight), so an unchanged
  // division — which keeps its object reference across store updates, see
  // `setDivisionContent`/`patchDivision` in `editorStore.ts` — is only ever
  // posted to the worker once.
  const queuedRef = useRef<WeakSet<Division>>(new WeakSet());

  useEffect(() => {
    if (workerFactory) {
      clientRef.current = createConversionWorkerClient(workerFactory);
    }
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !divisions) return;

    let cancelled = false;
    for (const division of divisions) {
      if (division.sourceFormat === "pretext") continue;
      if (queuedRef.current.has(division)) continue;
      queuedRef.current.add(division);
      client
        .convert(division)
        .then((xml) => {
          if (cancelled) return;
          primeDivisionOwnXml(division, xml);
          setVersion((v) => v + 1);
        })
        .catch(() => {
          // A rejection here means the worker itself broke (see `onerror` /
          // `terminate` in conversionWorkerClient.ts) — an ordinary
          // conversion failure comes back as a formatted error-comment string
          // via `computeDivisionOwnXml`, not a rejection. Leave this division
          // out of the cache; the synchronous fallback converts (and caches)
          // it the next time it's actually needed.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [divisions]);

  return version;
}
