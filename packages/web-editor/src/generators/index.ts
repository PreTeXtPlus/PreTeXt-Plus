/**
 * The generator registry. Adding a generator is adding an entry here; the
 * creation form, the assembler, the preview pane and the tests all iterate
 * this table rather than naming generators.
 */
import type { GeneratorId } from "../types/editor";
import type { AssetGenerator, GeneratorRuntime, GeneratorRuntimeConfigs } from "./types";
import { prefigure } from "./prefigure/definition";

export const generators: Record<GeneratorId, AssetGenerator> = { prefigure };

export const generatorIds = Object.keys(generators) as GeneratorId[];

export const generatorFor = (id: GeneratorId | undefined): AssetGenerator | undefined =>
  id ? generators[id] : undefined;

/**
 * One runtime per generator per page, created on first request from the host's
 * configuration for it and kept for the life of the page. `undefined` when the
 * host configured no runtime for that generator or the generator has none.
 */
const runtimes = new Map<GeneratorId, GeneratorRuntime>();

export function runtimeFor(
  id: GeneratorId,
  configs: GeneratorRuntimeConfigs | undefined,
): GeneratorRuntime | undefined {
  const existing = runtimes.get(id);
  if (existing) return existing;
  const options = configs?.[id];
  const generator = generators[id];
  if (!options || !generator.createRuntime) return undefined;
  const runtime = generator.createRuntime(options);
  runtimes.set(id, runtime);
  return runtime;
}

/** Tests only: forget every runtime so the next `runtimeFor` creates afresh. */
export function resetRuntimesForTests(): void {
  for (const runtime of runtimes.values()) runtime.dispose();
  runtimes.clear();
}

export { renderInputFor, sha256Hex, docinfoElementInner, RENDER_INPUT_SEPARATOR } from "./renderInput";
export type * from "./types";
