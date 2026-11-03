/**
 * The exercise designer's model: one interactive PreTeXt exercise as form
 * fields rather than markup. `parse.ts` reads a stored exercise into it and
 * `serialize.ts` writes it back, so the designer never edits XML directly.
 *
 * Only the exercise's *body* is modelled. Its `xml:id`/`label` (the record's
 * ref) and `<title>` are record fields, set in the settings drawer and built
 * into the `<exercise>` element at assembly (`wrapExerciseSource`).
 */

/** The interactive exercise types the designer can author. */
export const EXERCISE_KINDS = [
  "truefalse",
  "multiplechoice",
  "parsons",
  "horizontalparsons",
  "cardsort",
  "matching",
  "clickable",
  "fillin",
  "coding",
  "shortanswer",
] as const;

export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** Kinds not offered in the type picker (still parsed and written). */
export const HIDDEN_EXERCISE_KINDS: readonly ExerciseKind[] = ["shortanswer"];

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  truefalse: "True/False",
  multiplechoice: "Multiple Choice",
  parsons: "Parsons",
  horizontalparsons: "Horizontal Parsons",
  cardsort: "Card Sort",
  matching: "Matching",
  clickable: "Clickable Area",
  fillin: "Fill-in-the-Blanks",
  coding: "Coding",
  shortanswer: "Free Response",
};

/** Programming languages Runestone can run or highlight in an exercise. */
export const PROGRAM_LANGUAGES = [
  "python",
  "javascript",
  "java",
  "c",
  "cpp",
  "sql",
  "html",
  "octave",
  "ruby",
];

/**
 * A fresh key for a list item. Only the designer uses it — for React keys and
 * for tying a matching premise to its responses — and it never reaches the
 * source.
 */
export const newItemId = (): string => Math.random().toString(36).slice(2, 10);

export interface Hint {
  id: string;
  text: string;
}

/** Fields every exercise type shares. Rich-text fields hold PreTeXt markup. */
export interface CommonFields {
  statement: string;
  hints: Hint[];
  answer: string;
  solution: string;
}

export interface TrueFalse {
  kind: "truefalse";
  correct: boolean;
  feedback: string;
}

export interface Choice {
  id: string;
  statement: string;
  feedback: string;
  correct: boolean;
}

export interface MultipleChoice {
  kind: "multiplechoice";
  randomize: boolean;
  /** Use checkboxes even when only one choice is correct. */
  multipleCorrect: boolean;
  cols: string;
  choices: Choice[];
}

export interface Alternative {
  id: string;
  content: string;
}

export interface ParsonsBlock {
  id: string;
  /** Markup for natural language, plain source lines for code. */
  content: string;
  distractor: boolean;
  /** Wrong versions of this block, offered alongside it as `<choice>`s. */
  alternatives: Alternative[];
  /** For partial orders: this block's name, and the names of blocks that must come before it. */
  name: string;
  depends: string[];
}

export interface Parsons {
  kind: "parsons";
  /** `"natural"` or a programming language name. */
  language: string;
  numbered: "no" | "left" | "right";
  indentation: "show" | "hide";
  adaptive: boolean;
  shuffle: boolean;
  partialOrder: boolean;
  blocks: ParsonsBlock[];
}

export interface InlineBlock {
  id: string;
  content: string;
  distractor: boolean;
}

export interface HorizontalParsons {
  kind: "horizontalparsons";
  /** `"natural"`, `"math"`, or a programming language name. */
  language: string;
  randomize: boolean;
  reuse: boolean;
  blocks: InlineBlock[];
  tests: string;
  database: string;
}

export interface Premise {
  id: string;
  text: string;
}

export interface CardsortGroup {
  id: string;
  response: string;
  premises: Premise[];
}

/** No `feedback`: the PreTeXt grammar allows none on a card sort. */
export interface Cardsort {
  kind: "cardsort";
  groups: CardsortGroup[];
}

export interface MatchingResponse {
  id: string;
  text: string;
}

export interface MatchingPremise {
  id: string;
  text: string;
  /** Ids of the responses this premise matches. */
  refs: string[];
}

/** No `feedback`: the PreTeXt grammar allows none on a matching exercise. */
export interface Matching {
  kind: "matching";
  premises: MatchingPremise[];
  responses: MatchingResponse[];
}

export interface Clickable {
  kind: "clickable";
  /** When true, `content` is source code (one `<cline>` per line). */
  code: boolean;
  language: string;
  /** Text with `<area>` elements marking the clickable runs. */
  content: string;
  feedback: string;
}

export interface FillInTest {
  id: string;
  correct: boolean;
  comparison: "strcmp" | "numcmp";
  useAnswer: boolean;
  pattern: string;
  caseInsensitive: boolean;
  literal: boolean;
  strip: boolean;
  value: string;
  tolerance: string;
  min: string;
  max: string;
  feedback: string;
}

export interface Blank {
  id: string;
  answer: string;
  mode: "string" | "number";
  width: string;
  name: string;
  tests: FillInTest[];
}

export interface FillIn {
  kind: "fillin";
  blanks: Blank[];
}

export interface Coding {
  kind: "coding";
  language: string;
  code: string;
  tests: string;
}

export interface ShortAnswer {
  kind: "shortanswer";
  attachment: boolean;
}

export type ExerciseBody =
  | TrueFalse
  | MultipleChoice
  | Parsons
  | HorizontalParsons
  | Cardsort
  | Matching
  | Clickable
  | FillIn
  | Coding
  | ShortAnswer;

export type BodyOf<K extends ExerciseKind> = Extract<ExerciseBody, { kind: K }>;

/** One exercise as the designer edits it. */
export interface ExerciseDesign {
  common: CommonFields;
  body: ExerciseBody;
}

export const emptyCommon = (): CommonFields => ({
  statement: "",
  hints: [],
  answer: "",
  solution: "",
});

export const emptyChoice = (): Choice => ({
  id: newItemId(),
  statement: "",
  feedback: "",
  correct: false,
});
export const emptyParsonsBlock = (): ParsonsBlock => ({
  id: newItemId(),
  content: "",
  distractor: false,
  alternatives: [],
  name: "",
  depends: [],
});
export const emptyInlineBlock = (): InlineBlock => ({
  id: newItemId(),
  content: "",
  distractor: false,
});
export const emptyPremise = (): Premise => ({ id: newItemId(), text: "" });
export const emptyGroup = (): CardsortGroup => ({
  id: newItemId(),
  response: "",
  premises: [emptyPremise()],
});
export const emptyMatchingPremise = (): MatchingPremise => ({
  id: newItemId(),
  text: "",
  refs: [],
});
export const emptyMatchingResponse = (): MatchingResponse => ({ id: newItemId(), text: "" });

export const emptyTest = (comparison: FillInTest["comparison"] = "strcmp"): FillInTest => ({
  id: newItemId(),
  correct: false,
  comparison,
  useAnswer: false,
  pattern: "",
  caseInsensitive: false,
  literal: false,
  strip: true,
  value: "",
  tolerance: "",
  min: "",
  max: "",
  feedback: "",
});

export const emptyBlank = (mode: Blank["mode"] = "string"): Blank => ({
  id: newItemId(),
  answer: "",
  mode,
  width: "",
  name: "",
  tests: [
    {
      ...emptyTest(mode === "number" ? "numcmp" : "strcmp"),
      correct: true,
      useAnswer: true,
    },
  ],
});

/** A new, blank body of each kind — what the type picker switches to. */
export function emptyBody<K extends ExerciseKind>(kind: K): BodyOf<K> {
  const bodies: { [T in ExerciseKind]: () => BodyOf<T> } = {
    truefalse: () => ({ kind: "truefalse", correct: true, feedback: "" }),
    multiplechoice: () => ({
      kind: "multiplechoice",
      randomize: false,
      multipleCorrect: false,
      cols: "",
      choices: [{ ...emptyChoice(), correct: true }, emptyChoice(), emptyChoice()],
    }),
    parsons: () => ({
      kind: "parsons",
      language: "natural",
      numbered: "no",
      indentation: "show",
      adaptive: false,
      shuffle: true,
      partialOrder: false,
      blocks: [emptyParsonsBlock(), emptyParsonsBlock(), emptyParsonsBlock()],
    }),
    horizontalparsons: () => ({
      kind: "horizontalparsons",
      language: "natural",
      randomize: true,
      reuse: false,
      blocks: [emptyInlineBlock(), emptyInlineBlock(), emptyInlineBlock()],
      tests: "",
      database: "",
    }),
    cardsort: () => ({ kind: "cardsort", groups: [emptyGroup(), emptyGroup()] }),
    matching: () => ({
      kind: "matching",
      premises: [emptyMatchingPremise(), emptyMatchingPremise()],
      responses: [emptyMatchingResponse(), emptyMatchingResponse()],
    }),
    clickable: () => ({ kind: "clickable", code: false, language: "", content: "", feedback: "" }),
    fillin: () => ({ kind: "fillin", blanks: [] }),
    coding: () => ({ kind: "coding", language: "python", code: "", tests: "" }),
    shortanswer: () => ({ kind: "shortanswer", attachment: false }),
  };
  return bodies[kind]() as BodyOf<K>;
}

/** A new exercise of `kind`, with nothing filled in. */
export const emptyDesign = (kind: ExerciseKind = "multiplechoice"): ExerciseDesign => ({
  common: emptyCommon(),
  body: emptyBody(kind),
});
