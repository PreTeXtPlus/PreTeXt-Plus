import { useEffect, useMemo, useRef, useState } from "react";
import {
  DOENET_CHANGE_MESSAGE,
  DOENET_EDITOR_SANDBOX,
  DOENET_READY_MESSAGE,
  DOENET_SET_MESSAGE,
  doenetEditorPage,
  type DoenetEditorTheme,
} from "../doenet/editorPage";

export interface DoenetEditorPaneProps {
  /** The record's DoenetML as the project holds it now. */
  source: string;
  /** The `@doenet/standalone` version to edit against: the document's. */
  version: string;
  /** Called with the new DoenetML after every edit Doenet's editor reports. */
  onChange: (source: string) => void;
  readOnly?: boolean;
  /**
   * The editor's light/dark mode: the host's theme, light when it has none.
   * Doenet's editor would otherwise follow the browser on its own.
   */
  theme?: DoenetEditorTheme;
}

/**
 * Doenet's editor, in a sandboxed iframe, editing a Doenet activity's source
 * in place of the code editor (as the exercise designer does for a designer
 * exercise). The page is `doenetEditorPage`; the sandbox is `allow-scripts`
 * alone, like every interactive page in the live preview.
 *
 * The frame is built once per mount, from the source at that moment, so
 * typing never reloads it; `Editors` keys the pane by record. A later `source`
 * the frame did not itself report — a peer's edit, an undo — is posted to it,
 * and the page re-creates its editor from it. The version is part of the
 * page, so a docinfo edit that changes it reloads the frame, which opens with
 * the mount-time source again and is brought up to date once it says it is
 * ready.
 */
export default function DoenetEditorPane({
  source,
  version,
  onChange,
  readOnly,
  theme = "light",
}: DoenetEditorPaneProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [initialSource] = useState(source);
  // The source the frame holds as far as we know: what it opened with, what it
  // last reported, or what it was last sent.
  const frameSource = useRef(initialSource);
  // Which page has said it is ready; a rebuilt page starts over.
  const [readyPage, setReadyPage] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  const pageRef = useRef("");

  const page = useMemo(
    () => doenetEditorPage({ version, source: initialSource, readOnly: readOnly ?? false, theme }),
    [version, initialSource, readOnly, theme],
  );
  const ready = readyPage === page;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const { type, source: reported } = data as { type?: unknown; source?: unknown };
      if (type === DOENET_READY_MESSAGE) {
        // The page just mounted its editor from the source it was built with.
        frameSource.current = initialSource;
        setReadyPage(pageRef.current);
      } else if (type === DOENET_CHANGE_MESSAGE && typeof reported === "string") {
        frameSource.current = reported;
        onChangeRef.current(reported);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [initialSource]);

  // An outside change: tell the frame, unless it is the echo of its own.
  useEffect(() => {
    if (!ready || source === frameSource.current) return;
    frameSource.current = source;
    iframeRef.current?.contentWindow?.postMessage({ type: DOENET_SET_MESSAGE, source }, "*");
  }, [ready, source]);

  return (
    <div className="flex flex-col flex-1 min-h-0 relative" data-testid="doenet-editor-pane">
      <iframe
        ref={iframeRef}
        title="Doenet editor"
        className="flex-1 w-full border-0"
        sandbox={DOENET_EDITOR_SANDBOX}
        srcDoc={page}
        data-ready={ready ? "true" : "false"}
      />
    </div>
  );
}
