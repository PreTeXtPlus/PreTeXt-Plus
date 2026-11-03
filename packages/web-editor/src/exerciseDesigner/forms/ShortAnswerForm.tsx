import { Checkbox, Section } from "../fields";
import { type FormProps, patcher } from "./types";
import type { ShortAnswer } from "../model";

export default function ShortAnswerForm(props: FormProps<ShortAnswer>) {
  const set = patcher(props);
  return (
    <Section title="Response">
      <p className="text-[0.78rem] text-slate-600">
        Readers type a free response. It is graded by a person, so the text box appears only on
        compatible servers.
      </p>
      <Checkbox
        label="Allow a file upload with the answer"
        checked={props.body.attachment}
        onChange={(attachment) => set({ attachment })}
      />
    </Section>
  );
}
