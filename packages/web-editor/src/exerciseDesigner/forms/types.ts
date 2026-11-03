/** What every per-kind form takes: its body, and where to send a changed one. */
export interface FormProps<B> {
  body: B;
  onChange: (body: B) => void;
}

/** A setter that merges a patch into the body. */
export const patcher =
  <B,>({ body, onChange }: FormProps<B>) =>
  (patch: Partial<B>) =>
    onChange({ ...body, ...patch });
