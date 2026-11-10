/**
 * A runtime whose engine is the host's build server: for a generator no browser
 * runs (Asymptote, Sage). There is nothing to load — the runtime is ready at
 * once — and a render is one call to the host's `render`, which ships the source
 * to the server and waits for the picture. Renders are latest-wins like a
 * worker's, though the pane asks for one only on the author's Render (the
 * generator's `renderTrigger` is `manual`): each one is a job on a shared queue.
 */
import type { GeneratorId } from "../types/editor";
import type { GeneratorRuntime, GeneratorRuntimeOptions, RenderOptions, RenderResult } from "./types";
import { createRenderQueue } from "./renderQueue";

export interface ServerRuntimeConfig {
  generator: GeneratorId;
  /** The engine's name in messages: "Asymptote". */
  label: string;
  /** Applied to each picture on the main thread; a throw fails the render. */
  finishSvg?: (svg: string) => string;
}

export function createServerRuntime(config: ServerRuntimeConfig, options: GeneratorRuntimeOptions): GeneratorRuntime {
  const listeners = new Set<() => void>();
  // Ready from the start: a status change would make the pane render, and a
  // manual pane renders on nothing but the button.
  const status = "ready" as const;

  const enqueue = createRenderQueue(
    async ({ source, renderOptions }: { source: string; renderOptions: RenderOptions }): Promise<RenderResult> => {
      if (!options.render) throw new Error(`The host gave no server render for ${config.label}`);
      if (!renderOptions.ref) throw new Error(`A ${config.label} render needs the asset's ref`);
      const { svg } = await options.render({
        generator: config.generator,
        ref: renderOptions.ref,
        source,
        docinfo: renderOptions.docinfo ?? {},
        onProgress: renderOptions.onProgress,
      });
      return { svg: config.finishSvg ? config.finishSvg(svg) : svg, annotations: null, source };
    },
  );

  return {
    status,
    error: undefined,
    progress: undefined,
    load: () => Promise.resolve(),
    render: (source, renderOptions = {}) => enqueue({ source, renderOptions }),
    dispose() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
