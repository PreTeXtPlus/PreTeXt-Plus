import { MarkupField, Section, SuggestInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { PROGRAM_LANGUAGES, type Coding } from "../model";

export default function CodingForm(props: FormProps<Coding>) {
  const { body } = props;
  const set = patcher(props);
  return (
    <Section title="Program">
      <div className="w-48">
        <SuggestInput
          label="Language"
          value={body.language}
          options={PROGRAM_LANGUAGES}
          onChange={(language) => set({ language: language })}
        />
      </div>
      <MarkupField
        label="Starter code"
        code
        rows={8}
        value={body.code}
        onChange={(code) => set({ code })}
        help="The code readers start with."
      />
      <MarkupField
        label="Unit tests (optional)"
        code
        rows={6}
        value={body.tests}
        onChange={(tests) => set({ tests })}
        help="Run automatically with the reader's code, e.g. a unittest.gui TestCaseGui class for Python."
      />
    </Section>
  );
}
