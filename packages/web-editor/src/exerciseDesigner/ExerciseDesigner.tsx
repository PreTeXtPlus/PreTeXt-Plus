import { useRef, useState } from "react";
import clsx from "clsx";
import { SettingsButton } from "../components/settings/settingsUi";
import { ListEditor, MarkupField, Section } from "./fields";
import CardsortForm from "./forms/CardsortForm";
import ClickableForm from "./forms/ClickableForm";
import CodingForm from "./forms/CodingForm";
import FillInForm from "./forms/FillInForm";
import HorizontalParsonsForm from "./forms/HorizontalParsonsForm";
import MatchingForm from "./forms/MatchingForm";
import MultipleChoiceForm from "./forms/MultipleChoiceForm";
import ParsonsForm from "./forms/ParsonsForm";
import ShortAnswerForm from "./forms/ShortAnswerForm";
import TrueFalseForm from "./forms/TrueFalseForm";
import {
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
  HIDDEN_EXERCISE_KINDS,
  emptyBody,
  emptyDesign,
  newItemId,
  type BodyOf,
  type CommonFields,
  type ExerciseBody,
  type ExerciseDesign,
  type ExerciseKind,
} from "./model";
import { designFromSource } from "./parse";
import { EXERCISE_SAMPLES } from "./samples";
import { sourceFromDesign } from "./serialize";

/** What the designer reads and writes: an exercise record's body and attributes. */
export interface ExerciseSourceValue {
  source: string;
  attrs: Record<string, string>;
}

export interface ExerciseDesignerProps {
  /** The exercise's ref — seeds the ids a matching exercise writes into its source. */
  exerciseRef: string;
  value: ExerciseSourceValue;
  /** Called with the new stored form after every edit. */
  onChange: (value: ExerciseSourceValue) => void;
  readOnly?: boolean;
}

// A component rather than a module-level element: the server's assembler bundles
// this package without React's JSX runtime, so nothing may render at import.
const MarkupHelp = () => (
  <>
    Plain text becomes paragraphs (separate them with a blank line). PreTeXt markup like{" "}
    <code>&lt;m&gt;x^2&lt;/m&gt;</code> or <code>&lt;c&gt;code&lt;/c&gt;</code> is allowed.
  </>
);

/** Identity of a stored value, to tell an outside change from our own echo. */
const valueKey = ({ source, attrs }: ExerciseSourceValue) =>
  `${source}\u0000${JSON.stringify(Object.entries(attrs).sort())}`;

interface DesignerState {
  /** The stored value this state was read from, or last wrote. */
  key: string;
  design: ExerciseDesign | null;
  /** Why the stored source could not be read, when it couldn't. */
  error: string | null;
  warnings: string[];
  /**
   * Bodies of the other kinds the author has visited, so switching the type
   * back and forth doesn't lose what was filled in. Never stored.
   */
  otherBodies: Partial<Record<ExerciseKind, ExerciseBody>>;
}

function readValue(value: ExerciseSourceValue): Omit<DesignerState, "otherBodies"> {
  try {
    const { design, warnings } = designFromSource(value.source, value.attrs);
    return { key: valueKey(value), design, warnings, error: null };
  } catch (err) {
    return {
      key: valueKey(value),
      design: null,
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The exercise designer: an exercise edited as a form, one interactive type at
 * a time, never as XML. Controlled by the record's stored `source` and
 * `attrs`; it keeps its own parsed copy (so list items keep stable keys and
 * focus while typing) and re-reads the stored value only when it changes from
 * outside — a peer's edit, an undo — rather than as the echo of its own write.
 */
export default function ExerciseDesigner({
  exerciseRef,
  value,
  onChange,
  readOnly,
}: ExerciseDesignerProps) {
  const [state, setState] = useState<DesignerState>(() => ({ ...readValue(value), otherBodies: {} }));
  const statementRef = useRef<HTMLTextAreaElement>(null);

  // Derived state, in render: follow an outside change to the stored value.
  if (valueKey(value) !== state.key) {
    setState({ ...readValue(value), otherBodies: state.otherBodies });
  }

  const write = (design: ExerciseDesign, otherBodies = state.otherBodies) => {
    const next = sourceFromDesign(design, exerciseRef);
    setState({ key: valueKey(next), design, error: null, warnings: state.warnings, otherBodies });
    onChange(next);
  };

  const startOver = (design: ExerciseDesign) => {
    const next = sourceFromDesign(design, exerciseRef);
    setState({ key: valueKey(next), design, error: null, warnings: [], otherBodies: {} });
    onChange(next);
  };

  if (!state.design) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="exercise-designer">
        <p className="m-0 rounded bg-[#fde8e8] px-3 py-2 text-[0.8rem] text-red-700">
          This exercise's source can't be read by the designer. {state.error}
        </p>
        {!readOnly && (
          <div>
            <SettingsButton onClick={() => startOver(emptyDesign())}>Start a new exercise</SettingsButton>
          </div>
        )}
      </div>
    );
  }

  const { common, body } = state.design;
  const kind = body.kind;
  const setCommon = (patch: Partial<CommonFields>) => write({ common: { ...common, ...patch }, body });
  const setBody = <K extends ExerciseKind>(next: BodyOf<K>) => write({ common, body: next });

  const switchKind = (next: ExerciseKind) => {
    if (next === kind) return;
    const otherBodies = { ...state.otherBodies, [kind]: body };
    write({ common, body: otherBodies[next] ?? emptyBody(next) }, otherBodies);
  };

  const loadSample = () => {
    const blank = sourceFromDesign({ common: emptyDesign(kind).common, body: emptyBody(kind) }, exerciseRef);
    const current = sourceFromDesign(state.design!, exerciseRef);
    if (
      valueKey(blank) !== valueKey(current) &&
      !window.confirm(`Replace this exercise with the ${EXERCISE_KIND_LABELS[kind]} sample?`)
    ) {
      return;
    }
    const sample = EXERCISE_SAMPLES[kind];
    startOver(designFromSource(sample.source, sample.attrs).design);
  };

  const form = (() => {
    switch (body.kind) {
      case "truefalse":
        return <TrueFalseForm body={body} onChange={setBody} />;
      case "multiplechoice":
        return <MultipleChoiceForm body={body} onChange={setBody} />;
      case "parsons":
        return <ParsonsForm body={body} onChange={setBody} />;
      case "horizontalparsons":
        return <HorizontalParsonsForm body={body} onChange={setBody} />;
      case "cardsort":
        return <CardsortForm body={body} onChange={setBody} />;
      case "matching":
        return <MatchingForm body={body} onChange={setBody} />;
      case "clickable":
        return <ClickableForm body={body} onChange={setBody} />;
      case "fillin":
        return (
          <FillInForm
            body={body}
            onChange={setBody}
            statement={common.statement}
            onChangeBoth={(statement, next) => write({ common: { ...common, statement }, body: next })}
            statementRef={statementRef}
          />
        );
      case "coding":
        return <CodingForm body={body} onChange={setBody} />;
      case "shortanswer":
        return <ShortAnswerForm body={body} onChange={setBody} />;
    }
  })();

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-white" data-testid="exercise-designer">
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-4 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Exercise type" className="flex flex-wrap gap-1">
            {EXERCISE_KINDS.filter((k) => k === kind || !HIDDEN_EXERCISE_KINDS.includes(k)).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                onClick={() => switchKind(k)}
                className={clsx(
                  "font-[inherit] text-[0.74rem] rounded-full border px-2.5 py-0.5 cursor-pointer",
                  k === kind
                    ? "border-blue-700 bg-blue-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                )}
              >
                {EXERCISE_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <SettingsButton onClick={loadSample}>Load sample</SettingsButton>
        </div>

        {state.warnings.length > 0 && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-2.5 text-[0.76rem] text-amber-900"
          >
            <ul className="m-0 list-disc pl-5">
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setState({ ...state, warnings: [] })}
              aria-label="Dismiss"
              className="bg-transparent border-0 cursor-pointer text-amber-700 hover:text-amber-950"
            >
              ✕
            </button>
          </div>
        )}

        <Section title="Statement">
          <MarkupField
            ref={statementRef}
            label="Statement"
            rows={4}
            value={common.statement}
            onChange={(statement) => setCommon({ statement })}
            help={<MarkupHelp />}
          />
        </Section>
        {form}
        <Section title="Hints, answer and solution">
          <ListEditor
            items={common.hints}
            onChange={(hints) => setCommon({ hints })}
            create={() => ({ id: newItemId(), text: "" })}
            addLabel="Add hint"
            itemTitle={(i) => `Hint ${i + 1}`}
            renderItem={(hint, update) => (
              <MarkupField label="Text" rows={2} value={hint.text} onChange={(text) => update({ text })} />
            )}
          />
          <MarkupField
            label="Answer (optional)"
            rows={2}
            value={common.answer}
            onChange={(answer) => setCommon({ answer })}
          />
          <MarkupField
            label="Solution (optional)"
            rows={3}
            value={common.solution}
            onChange={(solution) => setCommon({ solution })}
          />
        </Section>
      </fieldset>
    </div>
  );
}
