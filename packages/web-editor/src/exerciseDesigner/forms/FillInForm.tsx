import type { RefObject } from "react";
import { Checkbox, ListEditor, MarkupField, Section, Select, TextInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { SettingsButton } from "../../components/settings/settingsUi";
import { emptyBlank, emptyTest, type Blank, type FillIn, type FillInTest } from "../model";
import { FILLIN_RE } from "../serialize";

const countBlanks = (s: string) => s.match(FILLIN_RE)?.length ?? 0;

function TestFields({
  test,
  update,
  mode,
}: {
  test: FillInTest;
  update: (p: Partial<FillInTest>) => void;
  mode: Blank["mode"];
}) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-44">
          <Select
            label="Comparison"
            value={test.comparison}
            options={[
              ["strcmp", "Text / pattern"],
              ["numcmp", "Number"],
            ]}
            onChange={(comparison) => update({ comparison })}
          />
        </div>
        <Checkbox
          label="Correct response"
          checked={test.correct}
          onChange={(correct) => update({ correct })}
        />
        <Checkbox
          label="Compare with the blank's answer"
          checked={test.useAnswer}
          onChange={(useAnswer) => update({ useAnswer })}
        />
      </div>
      {test.comparison === "strcmp" && (
        <>
          {!test.useAnswer && (
            <TextInput
              label="Pattern"
              mono
              value={test.pattern}
              onChange={(pattern) => update({ pattern })}
              help="Text the whole answer must match. A regular expression also works."
            />
          )}
          <div className="flex flex-wrap gap-4">
            <Checkbox
              label="Ignore case"
              checked={test.caseInsensitive}
              onChange={(caseInsensitive) => update({ caseInsensitive })}
            />
            {!test.useAnswer && (
              <Checkbox
                label="Match exactly (not a regular expression)"
                checked={test.literal}
                onChange={(literal) => update({ literal })}
              />
            )}
            <Checkbox
              label="Trim whitespace, match whole response"
              checked={test.strip}
              onChange={(strip) => update({ strip })}
            />
          </div>
        </>
      )}
      {test.comparison === "numcmp" && !test.useAnswer && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextInput
            label="Value"
            mono
            value={test.value}
            onChange={(value) => update({ value })}
          />
          <TextInput
            label="± Tolerance"
            mono
            value={test.tolerance}
            onChange={(tolerance) => update({ tolerance })}
          />
          <TextInput label="or Min" mono value={test.min} onChange={(min) => update({ min })} />
          <TextInput label="Max" mono value={test.max} onChange={(max) => update({ max })} />
        </div>
      )}
      {test.comparison === "numcmp" && mode === "string" && (
        <p className="text-[0.72rem] text-amber-700">
          Number comparisons usually go with a blank in number mode.
        </p>
      )}
      <MarkupField
        label="Feedback (optional)"
        rows={1}
        value={test.feedback}
        onChange={(feedback) => update({ feedback })}
      />
    </>
  );
}

export default function FillInForm({
  statement,
  onChangeBoth,
  statementRef,
  ...props
}: FormProps<FillIn> & {
  statement: string;
  /** Change the statement and this body in one edit, as inserting a blank does. */
  onChangeBoth: (statement: string, body: FillIn) => void;
  statementRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { body } = props;
  const set = patcher(props);
  const inStatement = countBlanks(statement);

  const insertBlank = () => {
    const ta = statementRef.current;
    const pos = ta ? ta.selectionEnd : statement.length;
    const index = countBlanks(statement.slice(0, pos));
    const blanks = [...body.blanks];
    blanks.splice(index, 0, emptyBlank());
    onChangeBoth(statement.slice(0, pos) + "<fillin/>" + statement.slice(pos), { ...body, blanks });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(pos + 9, pos + 9);
    });
  };

  return (
    <Section
      title="Blanks"
      actions={
        <SettingsButton onMouseDown={(e) => e.preventDefault()} onClick={insertBlank}>
          Insert blank at statement cursor
        </SettingsButton>
      }
    >
      <p className="text-[0.78rem] text-slate-600">
        Each <code>&lt;fillin/&gt;</code> in the statement is a blank, matched in order with the
        blanks below.
      </p>
      {inStatement !== body.blanks.length && (
        <p className="text-[0.78rem] text-amber-700">
          The statement has {inStatement} blank{inStatement === 1 ? "" : "s"} but{" "}
          {body.blanks.length} {body.blanks.length === 1 ? "is" : "are"} defined below.
        </p>
      )}
      <ListEditor
        items={body.blanks}
        onChange={(blanks) => set({ blanks })}
        create={emptyBlank}
        addLabel="Add blank"
        itemTitle={(i) => `Blank ${i + 1}`}
        renderItem={(blank, update) => (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TextInput
                label="Answer"
                value={blank.answer}
                onChange={(answer) => update({ answer })}
              />
              <Select
                label="Mode"
                value={blank.mode}
                options={[
                  ["string", "Text"],
                  ["number", "Number"],
                ]}
                onChange={(mode) => update({ mode })}
              />
              <TextInput
                label="Width"
                mono
                value={blank.width}
                onChange={(width) => update({ width })}
              />
              <TextInput
                label="Name"
                mono
                value={blank.name}
                onChange={(name) => update({ name })}
              />
            </div>
            <div className="pl-3">
              <ListEditor
                items={blank.tests}
                onChange={(tests) => update({ tests })}
                create={() => emptyTest(blank.mode === "number" ? "numcmp" : "strcmp")}
                addLabel="Add test"
                itemTitle={(i) => `Test ${i + 1}`}
                renderItem={(test, updateTest) => (
                  <TestFields test={test} update={updateTest} mode={blank.mode} />
                )}
              />
            </div>
          </>
        )}
      />
    </Section>
  );
}
