import {
  Checkbox,
  ListEditor,
  MarkupField,
  Section,
  Select,
  TextInput,
  SuggestInput,
} from "../fields";
import { type FormProps, patcher } from "./types";
import {
  PROGRAM_LANGUAGES,
  emptyParsonsBlock,
  newItemId,
  type ParsonsBlock,
  type Parsons,
} from "../model";

export default function ParsonsForm(props: FormProps<Parsons>) {
  const { body } = props;
  const set = patcher(props);
  const isCode = body.language !== "natural";

  /** Rename a block, keeping other blocks' dependencies on it. */
  const rename = (block: ParsonsBlock, name: string) =>
    set({
      blocks: body.blocks.map((b) =>
        b.id === block.id
          ? { ...b, name }
          : {
              ...b,
              depends: b.depends
                .map((d) => (block.name && d === block.name ? name : d))
                .filter(Boolean),
            }
      ),
    });

  const contentField = (label: string, value: string, onChange: (value: string) => void) => (
    <MarkupField
      label={label}
      code={isCode}
      rows={isCode ? 3 : 2}
      value={value}
      onChange={onChange}
    />
  );

  return (
    <Section title="Blocks">
      <div className="grid gap-3 sm:grid-cols-3">
        <SuggestInput
          label="Language"
          value={body.language}
          options={["natural", ...PROGRAM_LANGUAGES]}
          onChange={(language) => set({ language: language.trim() || "natural" })}
        />
        <Select
          label="Numbered blocks"
          value={body.numbered}
          options={[
            ["no", "No"],
            ["left", "On the left"],
            ["right", "On the right"],
          ]}
          onChange={(numbered) => set({ numbered })}
        />
        {isCode && (
          <Select
            label="Indentation"
            value={body.indentation}
            options={[
              ["show", "Shown"],
              ["hide", "Hidden (reader indents)"],
            ]}
            onChange={(indentation) => set({ indentation })}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox
          label="Shuffle blocks"
          checked={body.shuffle}
          onChange={(shuffle) => set({ shuffle })}
        />
        <Checkbox
          label="Adaptive (offer help after wrong attempts)"
          checked={body.adaptive}
          onChange={(adaptive) => set({ adaptive })}
        />
        <Checkbox
          label="Allow multiple valid orders"
          checked={body.partialOrder}
          onChange={(partialOrder) => set({ partialOrder })}
        />
      </div>
      <p className="text-[0.78rem] text-slate-600">
        List the blocks in a correct order. Distractors are left out of the solution and can go
        anywhere.
        {body.partialOrder &&
          " Give each block a name, then list the blocks that must come before it. Any order that respects those is accepted."}
      </p>
      <ListEditor
        items={body.blocks}
        onChange={(blocks) => set({ blocks })}
        create={emptyParsonsBlock}
        addLabel="Add block"
        itemTitle={(i) => `Block ${i + 1}`}
        renderItem={(block, update) => {
          const others = body.blocks.filter((b) => b.id !== block.id && b.name && !b.distractor);
          return (
            <>
              <Checkbox
                label="Distractor"
                checked={block.distractor}
                onChange={(distractor) => update({ distractor })}
              />
              {contentField(isCode ? "Code" : "Text", block.content, (content) =>
                update({ content })
              )}
              {body.partialOrder && !block.distractor && (
                <div className="space-y-2">
                  <div className="w-48">
                    <TextInput
                      label="Name"
                      mono
                      value={block.name}
                      onChange={(name) => rename(block, name.replace(/\s+/g, ""))}
                    />
                  </div>
                  {others.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-[0.78rem] font-medium text-slate-700">
                        Comes after:
                      </span>
                      {others.map((b) => (
                        <Checkbox
                          key={b.id}
                          label={<code>{b.name}</code>}
                          checked={block.depends.includes(b.name)}
                          onChange={(on) =>
                            update({
                              depends: on
                                ? [...block.depends, b.name]
                                : block.depends.filter((d) => d !== b.name),
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <details open={block.alternatives.length > 0} className="text-[0.78rem]">
                <summary className="cursor-pointer text-slate-600">
                  Wrong versions of this block ({block.alternatives.length})
                </summary>
                <div className="mt-2">
                  <ListEditor
                    items={block.alternatives}
                    onChange={(alternatives) => update({ alternatives })}
                    create={() => ({ id: newItemId(), content: "" })}
                    addLabel="Add wrong version"
                    itemTitle={(i) => `Wrong version ${i + 1}`}
                    renderItem={(alt, updateAlt) =>
                      contentField(isCode ? "Code" : "Text", alt.content, (content) =>
                        updateAlt({ content })
                      )
                    }
                  />
                </div>
              </details>
            </>
          );
        }}
      />
    </Section>
  );
}
