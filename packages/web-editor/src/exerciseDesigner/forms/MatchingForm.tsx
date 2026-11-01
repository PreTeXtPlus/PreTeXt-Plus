import { Checkbox, ListEditor, Section, TextInput } from "../fields";
import { type FormProps, patcher } from "./types";
import { emptyMatchingPremise, emptyMatchingResponse, type Matching } from "../model";

export default function MatchingForm(props: FormProps<Matching>) {
  const { body } = props;
  const set = patcher(props);
  return (
    <>
      <Section title="Responses">
        <p className="text-[0.78rem] text-slate-600">
          Readers connect each premise to every response that applies. A response can match several
          premises.
        </p>
        <ListEditor
          items={body.responses}
          onChange={(responses) =>
            set({
              responses,
              premises: body.premises.map((p) => ({
                ...p,
                refs: p.refs.filter((id) => responses.some((r) => r.id === id)),
              })),
            })
          }
          create={emptyMatchingResponse}
          addLabel="Add response"
          itemTitle={(i) => `Response ${i + 1}`}
          renderItem={(response, update) => (
            <TextInput
              label="Response"
              value={response.text}
              onChange={(text) => update({ text })}
            />
          )}
        />
      </Section>
      <Section title="Premises">
        <ListEditor
          items={body.premises}
          onChange={(premises) => set({ premises })}
          create={emptyMatchingPremise}
          addLabel="Add premise"
          itemTitle={(i) => `Premise ${i + 1}`}
          renderItem={(premise, update) => (
            <>
              <TextInput
                label="Premise"
                value={premise.text}
                onChange={(text) => update({ text })}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[0.78rem] font-medium text-slate-700">Matches:</span>
                {body.responses.map((r, i) => (
                  <Checkbox
                    key={r.id}
                    label={r.text || `Response ${i + 1}`}
                    checked={premise.refs.includes(r.id)}
                    onChange={(on) =>
                      update({
                        refs: on
                          ? [...premise.refs, r.id]
                          : premise.refs.filter((id) => id !== r.id),
                      })
                    }
                  />
                ))}
              </div>
              {premise.refs.length === 0 && (
                <p className="text-[0.72rem] text-amber-700">Pick at least one response.</p>
              )}
            </>
          )}
        />
      </Section>
    </>
  );
}
