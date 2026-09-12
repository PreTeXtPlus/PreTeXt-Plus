import FeedbackLink from "./FeedbackLink";
import { useEditorStore } from "../store/hooks";

interface StoreFeedbackLinkProps {
  label?: string;
  /** Shown instead of `label` at narrow viewports; see `FeedbackLink`. */
  shortLabel?: string;
  context: string;
  className?: string;
}

/** Internal wrapper: reads all FeedbackLink data from the editor store. */
const StoreFeedbackLink = ({
  label,
  shortLabel,
  context,
  className,
}: StoreFeedbackLinkProps) => {
  const hasFeedback = useEditorStore((s) => s.hasFeedback);
  const projectUrl = useEditorStore((s) => s.projectUrl);
  const source = useEditorStore((s) => s.source);
  const sourceFormat = useEditorStore((s) => s.sourceFormat);
  const title = useEditorStore((s) => s.title);
  const feedbackSubmit = useEditorStore((s) => s.feedbackSubmit);

  if (!hasFeedback) return null;

  return (
    <FeedbackLink
      label={label}
      shortLabel={shortLabel}
      context={context}
      className={className}
      projectUrl={projectUrl}
      currentSource={source}
      sourceFormat={sourceFormat}
      title={title}
      onSubmit={feedbackSubmit}
    />
  );
};

export default StoreFeedbackLink;
