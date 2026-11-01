import { useRef } from "react";
import { Checkbox, MarkupField, Section, SuggestInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { SettingsButton } from "../../components/settings/settingsUi";
import { PROGRAM_LANGUAGES, type Clickable } from "../model";

export default function ClickableForm(props: FormProps<Clickable>) {
  const { body } = props;
  const set = patcher(props);
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = (distractor: boolean) => {
    const ta = ref.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const open = distractor ? '<area correct="no">' : "<area>";
    set({
      content:
        body.content.slice(0, start) +
        open +
        body.content.slice(start, end) +
        "</area>" +
        body.content.slice(end),
    });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(end + open.length + 7, end + open.length + 7);
    });
  };

  return (
    <Section title="Clickable text">
      <div className="flex flex-wrap items-end gap-4">
        <Checkbox
          label="Text is program code"
          checked={body.code}
          onChange={(code) => set({ code })}
        />
        {body.code && (
          <div className="w-40">
            <SuggestInput
              label="Language"
              value={body.language}
              options={PROGRAM_LANGUAGES}
              onChange={(language) => set({ language: language })}
            />
          </div>
        )}
      </div>
      <p className="text-[0.78rem] text-slate-600">
        Select a run of text, then mark it. Correct areas are the ones readers should click;
        distractors are tempting wrong ones. Areas cannot span paragraphs or lines.
      </p>
      <div className="flex flex-wrap gap-2">
        <SettingsButton
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrapSelection(false)}
        >
          Mark as correct area
        </SettingsButton>
        <SettingsButton onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(true)}>
          Mark as distractor
        </SettingsButton>
      </div>
      <MarkupField
        ref={ref}
        label={body.code ? "Code" : "Text"}
        rows={6}
        value={body.content}
        onChange={(content) => set({ content })}
      />
      <MarkupField
        label="Feedback (optional)"
        rows={2}
        value={body.feedback}
        onChange={(feedback) => set({ feedback })}
      />
    </Section>
  );
}
