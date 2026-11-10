import { Checkbox, Section } from "../fields";
import { type FormProps, patcher } from "./types";
import type { ShortAnswer } from "../model";

export default function ShortAnswerForm(props: FormProps<ShortAnswer>) {
  const set = patcher(props);
  return (
    <Section title="Response">
      <p className="text-[0.78rem] text-slate-600">
        Readers type their own answer. A person grades it, so the answer box only appears on
        sites that support that, like Runestone.
      </p>
      <Checkbox
        label="Allow a file upload with the answer"
        checked={props.body.attachment}
        onChange={(attachment) => set({ attachment })}
      />
    </Section>
  );
}
