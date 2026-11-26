/**
 * MathML → Nemeth braille, through Speech Rule Engine, for a tactile diagram's
 * math labels — what the PreFigure playground does, and what the Python package
 * asks its host for (`processBraille`).
 */
import "./sreFeature";
import { engineReady, setupEngine, toSpeech } from "speech-rule-engine/js/common/system.js";

let ready: Promise<void> | null = null;

/** Set SRE up for Nemeth braille. Safe to call repeatedly. */
export function loadNemeth(): Promise<void> {
  ready ??= (async () => {
    await setupEngine({ locale: "nemeth", modality: "braille" });
    await engineReady();
  })();
  return ready;
}

/** `mathml` (a `<math>` element) in Nemeth braille. Call after `loadNemeth()` settles. */
export function mathmlToNemeth(mathml: string): string {
  return toSpeech(mathml);
}
