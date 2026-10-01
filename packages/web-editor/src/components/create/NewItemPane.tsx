import { useEffect } from "react";
import type { Asset, Snippet, SourceFormat } from "../../types/editor";
import { useEditorStore } from "../../store/hooks";
import type { CreateRequest } from "../../store/editorStore";
import { KindIcon } from "../EditorTargetBar";
import SectionEditForm from "../toc/SectionEditForm";
import { divisionDisplayTitle } from "../toc/types";
import { useDivisionActions } from "../toc/useDivisionActions";
import { SettingsNote } from "../settings/settingsUi";
import NewSnippetForm from "./NewSnippetForm";
import NewAssetForm from "./NewAssetForm";

export interface NewItemPaneProps {
  /** Persist a new snippet — see `NewSnippetForm`. */
  onCreateSnippet?: (ref: string, sourceFormat: SourceFormat) => Promise<Snippet>;
  onUploadAsset?: (file: File, title?: string) => Promise<Asset>;
  onFetchAssetUrl?: (url: string) => Promise<File>;
  onCreateAuthoredAsset?: (title: string) => Promise<Asset>;
  /**
   * A snippet or asset the host has created for `request`: add it to the
   * project, bind or replace whatever the request names, and open it.
   */
  onSnippetCreated: (snippet: Snippet, request: CreateRequest & { kind: "snippet" }) => void;
  onAssetCreated: (asset: Asset, request: CreateRequest & { kind: "asset" }) => void;
}

const heading = (request: CreateRequest): string => {
  switch (request.kind) {
    case "division":
      return "New division";
    case "snippet":
      return request.resolveRef ? "Link snippet" : "New snippet";
    case "asset":
      return request.replaceRef
        ? "Replace asset"
        : request.resolveRef
          ? "Link asset"
          : "New asset";
  }
};

/**
 * What the editor pane shows while the author is creating something (the
 * store's `creating`): in place of the title bar and code editor, a form to
 * initialize the new division, snippet or asset. Nothing exists until it is
 * submitted; then the new item opens in the editor. Cancel (or Escape, or
 * opening any item) leaves the project as it was.
 */
const NewItemPane = ({
  onCreateSnippet,
  onUploadAsset,
  onFetchAssetUrl,
  onCreateAuthoredAsset,
  onSnippetCreated,
  onAssetCreated,
}: NewItemPaneProps) => {
  const creating = useEditorStore((s) => s.creating);
  const cancelCreate = useEditorStore((s) => s.cancelCreate);
  const editDraft = useEditorStore((s) => s.editDraft);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const { divisions, getDivisionType } = useDivisionActions();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCreate();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelCreate]);

  if (!creating) return null;

  const ref =
    creating.kind === "asset"
      ? (creating.replaceRef ?? creating.resolveRef)
      : creating.kind === "snippet"
        ? creating.resolveRef
        : undefined;

  let body;
  if (creating.kind === "division") {
    const parent = creating.parentXmlId
      ? divisions?.find((d) => d.xmlId === creating.parentXmlId)
      : undefined;
    body = editDraft && (
      <>
        <SettingsNote>
          {parent ? (
            <>
              Inside <strong>{divisionDisplayTitle(parent) || parent.xmlId}</strong>.{" "}
            </>
          ) : (
            "Not placed in the document. "
          )}
          Nothing is created until you save.
        </SettingsNote>
        <SectionEditForm
          draft={editDraft}
          parentType={getDivisionType(creating.parentXmlId)}
          onDraftChange={setEditDraft}
          onCommit={commitSectionEdit}
          onCancel={cancelCreate}
        />
      </>
    );
  } else if (creating.kind === "snippet") {
    body = (
      <>
        {creating.resolveRef && (
          <SettingsNote>
            The document refers to a snippet <code>{creating.resolveRef}</code>{" "}
            that doesn't exist yet. Create it here.
          </SettingsNote>
        )}
        <NewSnippetForm
          resolveRef={creating.resolveRef}
          onCreate={onCreateSnippet}
          onCreated={(snippet) => onSnippetCreated(snippet, creating)}
          onCancel={cancelCreate}
        />
      </>
    );
  } else {
    body = (
      <>
        {creating.replaceRef ? (
          <SettingsNote>
            Choose a new image for <code>{creating.replaceRef}</code>. Every
            place it's used in the document will show the new one.
          </SettingsNote>
        ) : creating.resolveRef ? (
          <SettingsNote>
            The document refers to an asset <code>{creating.resolveRef}</code>{" "}
            that doesn't exist yet. Create it here — the reference in the
            document is updated to match.
          </SettingsNote>
        ) : null}
        <NewAssetForm
          isReplace={!!creating.replaceRef}
          initialTitle={creating.resolveRef}
          onUpload={onUploadAsset}
          onFetchUrl={onFetchAssetUrl}
          onCreateAuthored={onCreateAuthoredAsset}
          onCreated={(asset) => onAssetCreated(asset, creating)}
          onCancel={cancelCreate}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0" data-testid="new-item-pane">
      <div className="flex items-center gap-2 h-9 px-2 shrink-0 bg-[#f5f6f8] border-b border-[#dde0e6] select-none">
        <KindIcon kind={creating.kind} />
        <span
          data-testid="new-item-heading"
          className="text-[0.85rem] font-semibold text-slate-800 whitespace-nowrap"
        >
          {heading(creating)}
        </span>
        {ref && (
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.7rem] font-mono text-slate-400">
            {ref}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="flex items-center justify-center w-8 h-7 p-0 border-none rounded-[3px] cursor-pointer text-slate-600 bg-transparent hover:bg-slate-200"
          onClick={cancelCreate}
          aria-label="Cancel"
          title="Cancel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="flex flex-col gap-3 max-w-[640px] py-4 px-4">{body}</div>
      </div>
    </div>
  );
};

export default NewItemPane;
