import type { Division } from "../types/sections";

/** Main thread -> worker: convert one division's own PreTeXt XML. */
export interface ConversionRequest {
  id: number;
  division: Division;
}

/**
 * Worker -> main thread. Exactly one of `xml`/`error` is set: `error` is a
 * last-resort signal that the worker itself broke (e.g. an unexpected
 * exception outside `computeDivisionOwnXml`, which already turns ordinary
 * conversion failures into an error-comment string within `xml` rather than
 * throwing).
 */
export interface ConversionResponse {
  id: number;
  xml?: string;
  error?: string;
}
