# Preview rebuild benchmarks

Timing harnesses for the live preview's two costs, kept because both regressed
silently once already: assembling a project walks the whole divisions tree on
every keystroke, and nothing about that is visible from a small demo document.

**These are not tests.** They assert nothing and cannot fail — they print
tables. They're excluded from `vitest.config.ts` and from CI, and are run by
hand when you touch the preview path.

```bash
npx vitest run --config bench/vitest.bench.config.ts bench/assembly.test.ts
npx vitest run --config bench/vitest.bench.config.ts bench/render.test.ts
```

`assembly.test.ts` takes a couple of minutes; `render.test.ts` about twenty
seconds. The bench config passes `--experimental-wasm-jspi`, which the renderer
needs — it's the same capability `isLocalPreviewAvailable()` checks for in the
browser, and Node 24 still has it behind a flag.

## What each one is for

- **`fixtures.ts`** — generates synthetic books by chapter count, sections per
  chapter, and body size, in PreTeXt or LaTeX, plus the median-of-N timing
  helpers. Any shape can be measured without a real project.
- **`assembly.test.ts`** — the JavaScript half: `assembleFullProjectSource`
  (the preview's context source, recomputed per keystroke),
  `assembleProjectSource` for the active division, and the LaTeX conversion
  floor underneath both.
- **`render.test.ts`** — the WebAssembly half: the active division rendered
  standalone versus spliced into the assembled project.

## The results worth remembering

Measured on Node 24.18 in the devcontainer, synthetic books from 5 to 265
divisions (4KB to 873KB of source):

- **Standalone rendering is flat** at ~110ms whether the project is 4KB or
  843KB. Only the in-context render scales — 100ms to 2.7s over that range.
  This is the finding an adaptive preview policy rests on: falling back to
  division-only rendering keeps a preview live at any project size.
- **In-context rendering stays under 750ms to ~350KB / ~145 divisions**, which
  is roughly the limit of what reads as "live" given the render occupies the
  main thread.
- **Assembly is now ~2ms (PreTeXt) / ~35ms (LaTeX) per keystroke** at 850KB.
  Before the fixes in `sectionUtils.ts` it was 2.1s and 18.2s respectively —
  a whole-document XML parse in `ensureRootLabel`, and re-converting every
  LaTeX division when only one had changed. If either number climbs back into
  the hundreds of milliseconds, one of those has come back.
