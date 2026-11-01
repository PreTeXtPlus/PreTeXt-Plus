import { Checkbox, ListEditor, MarkupField, Section, TextInput, SuggestInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { emptyInlineBlock, type HorizontalParsons } from "../model";

const HELP: Record<string, string> = {
  natural: "Blocks are words or short phrases, and may use inline markup.",
  math: "Blocks are LaTeX, typeset as math (each is wrapped in <m>).",
};

export default function HorizontalParsonsForm(props: FormProps<HorizontalParsons>) {
  const { body } = props;
  const set = patcher(props);
  const help = HELP[body.language] ?? "Blocks are code tokens (each is wrapped in <c>).";
  return (
    <Section title="Blocks">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <SuggestInput
            label="Language"
            value={body.language}
            options={["natural", "math", "sql", "python", "java", "javascript"]}
            onChange={(language) => set({ language: language.trim() || "natural" })}
          />
        </div>
        <Checkbox
          label="Shuffle blocks"
          checked={body.randomize}
          onChange={(randomize) => set({ randomize })}
        />
        <Checkbox
          label="Allow blocks to be reused"
          checked={body.reuse}
          onChange={(reuse) => set({ reuse })}
        />
      </div>
      <p className="text-[0.78rem] text-slate-600">
        Readers assemble the blocks left to right. List them in the correct order. {help}
      </p>
      <ListEditor
        items={body.blocks}
        onChange={(blocks) => set({ blocks })}
        create={emptyInlineBlock}
        addLabel="Add block"
        itemTitle={(i) => `Block ${i + 1}`}
        renderItem={(block, update) => (
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <TextInput
                label="Block"
                mono={body.language !== "natural"}
                value={block.content}
                onChange={(content) => update({ content })}
              />
            </div>
            <div className="pb-2">
              <Checkbox
                label="Distractor"
                checked={block.distractor}
                onChange={(distractor) => update({ distractor })}
              />
            </div>
          </div>
        )}
      />
      {body.language === "sql" && (
        <TextInput
          label="Database (optional)"
          mono
          value={body.database}
          placeholder="sql/test.db"
          onChange={(database) => set({ database })}
          help="A database file the assembled statement runs against."
        />
      )}
      {body.language !== "natural" && body.language !== "math" && (
        <MarkupField
          label="Tests (optional)"
          code
          rows={3}
          value={body.tests}
          onChange={(tests) => set({ tests })}
          help="Checks run against the assembled code for automatic feedback, e.g. assert 1,1 == world for SQL."
        />
      )}
    </Section>
  );
}
