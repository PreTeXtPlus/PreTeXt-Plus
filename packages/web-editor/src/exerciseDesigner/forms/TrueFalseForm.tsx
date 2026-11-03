import { MarkupField, Section } from "../fields";
import { type FormProps, patcher } from "./types";
import type { TrueFalse } from "../model";

export default function TrueFalseForm(props: FormProps<TrueFalse>) {
  const { body } = props;
  const set = patcher(props);
  return (
    <Section title="True/False">
      <p className="text-[0.78rem] text-slate-600">
        The statement is the claim the reader decides is true or false.
      </p>
      <div className="flex gap-4 text-[0.78rem]">
        {[true, false].map((value) => (
          <label key={String(value)} className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="tf-correct"
              checked={body.correct === value}
              onChange={() => set({ correct: value })}
              className="size-4 accent-blue-600"
            />
            The statement is {value ? "true" : "false"}
          </label>
        ))}
      </div>
      <MarkupField
        label="Feedback (optional)"
        rows={2}
        value={body.feedback}
        onChange={(feedback) => set({ feedback })}
        help="Explain why, beyond just right or wrong."
      />
    </Section>
  );
}
