import { ListEditor, Section, TextInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { emptyGroup, emptyPremise, type Cardsort } from "../model";

export default function CardsortForm(props: FormProps<Cardsort>) {
  const { body } = props;
  const set = patcher(props);
  return (
    <Section title="Categories">
      <p className="text-[0.78rem] text-slate-600">
        Readers sort the premise cards into categories. Each category has one response and any
        number of premises. Keep cards to short phrases.
      </p>
      <ListEditor
        items={body.groups}
        onChange={(groups) => set({ groups })}
        create={emptyGroup}
        addLabel="Add category"
        itemTitle={(i) => `Category ${i + 1}`}
        renderItem={(group, update) => (
          <>
            <TextInput
              label="Response"
              value={group.response}
              onChange={(response) => update({ response })}
            />
            <div className="pl-3">
              <ListEditor
                items={group.premises}
                onChange={(premises) => update({ premises })}
                create={emptyPremise}
                addLabel="Add premise"
                itemTitle={(i) => `Premise ${i + 1}`}
                renderItem={(premise, updatePremise) => (
                  <TextInput
                    label="Premise"
                    value={premise.text}
                    onChange={(text) => updatePremise({ text })}
                  />
                )}
              />
            </div>
          </>
        )}
      />
    </Section>
  );
}
