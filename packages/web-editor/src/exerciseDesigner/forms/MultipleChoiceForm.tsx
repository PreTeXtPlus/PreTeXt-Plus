import { Checkbox, ListEditor, MarkupField, Section, TextInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { emptyChoice, type MultipleChoice } from "../model";

export default function MultipleChoiceForm(props: FormProps<MultipleChoice>) {
  const { body } = props;
  const set = patcher(props);
  const correctCount = body.choices.filter((c) => c.correct).length;
  return (
    <Section title="Choices">
      <div className="flex flex-wrap items-end gap-4">
        <Checkbox
          label="Shuffle choices for each reader"
          checked={body.randomize}
          onChange={(randomize) => set({ randomize })}
        />
        <Checkbox
          label="Always use checkboxes"
          checked={body.multipleCorrect}
          onChange={(multipleCorrect) => set({ multipleCorrect })}
        />
        <div className="w-24">
          <TextInput
            label="Columns"
            mono
            value={body.cols}
            placeholder="1"
            onChange={(cols) => set({ cols })}
          />
        </div>
      </div>
      <p className="text-[0.78rem] text-slate-600">
        Readers get radio buttons when exactly one choice is correct, and checkboxes otherwise.
        "Always use checkboxes" hides how many answers are correct.
      </p>
      {correctCount === 0 && (
        <p className="text-[0.78rem] text-amber-700">Mark at least one choice as correct.</p>
      )}
      <ListEditor
        items={body.choices}
        onChange={(choices) => set({ choices })}
        create={emptyChoice}
        addLabel="Add choice"
        itemTitle={(i) => `Choice ${String.fromCharCode(65 + i)}`}
        renderItem={(choice, update) => (
          <>
            <Checkbox
              label="Correct"
              checked={choice.correct}
              onChange={(correct) => update({ correct })}
            />
            <MarkupField
              label="Choice"
              rows={1}
              value={choice.statement}
              onChange={(statement) => update({ statement })}
            />
            <MarkupField
              label="Feedback (optional)"
              rows={1}
              value={choice.feedback}
              onChange={(feedback) => update({ feedback })}
            />
          </>
        )}
      />
    </Section>
  );
}
