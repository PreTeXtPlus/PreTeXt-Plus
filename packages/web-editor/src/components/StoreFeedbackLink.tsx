import FeedbackLink from "./FeedbackLink";
import { useEditorStore } from "../store/hooks";

interface StoreFeedbackLinkProps {
  label?: string;
  context: string;
  className?: string;
}

/** Internal wrapper: reads all FeedbackLink data from the editor store. */
const StoreFeedbackLink = ({ label, context, className }: StoreFeedbackLinkProps) => {
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
