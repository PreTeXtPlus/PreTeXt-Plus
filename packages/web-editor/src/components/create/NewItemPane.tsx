import { useEffect, useState } from "react";
import type { Asset, Exercise, GeneratorId, Snippet, SnippetSourceFormat } from "../../types/editor";
import { useEditorStore } from "../../store/hooks";
import type { CreateRequest } from "../../store/editorStore";
import { KindIcon } from "../EditorTargetBar";
import SectionEditForm from "../toc/SectionEditForm";
import { divisionDisplayTitle } from "../toc/types";
import { useDivisionActions } from "../toc/useDivisionActions";
import { SettingsActions, SettingsNote } from "../settings/settingsUi";
import NewSnippetForm from "./NewSnippetForm";
import NewAssetForm from "./NewAssetForm";
import NewExerciseForm from "./NewExerciseForm";

export interface NewItemPaneProps {
  /** Persist a new snippet — see `NewSnippetForm`. */
  onCreateSnippet?: (ref: string, sourceFormat: SnippetSourceFormat, title: string) => Promise<Snippet>;
  /** Persist a new exercise — see `NewExerciseForm`. */
  onCreateExercise?: (exercise: Exercise) => Promise<Exercise>;
  onUploadAsset?: (file: File, title?: string, ref?: string) => Promise<Asset>;
  onFetchAssetUrl?: (url: string) => Promise<File>;
  onCreateAuthoredAsset?: (title: string, ref?: string) => Promise<Asset>;
  onCreateGeneratedAsset?: (generator: GeneratorId, title: string, ref?: string) => Promise<Asset>;
  /**
   * A snippet, exercise or asset the host has created for `request`: add it to the
   * project, bind or replace whatever the request names, and open it.
   */
  onSnippetCreated: (snippet: Snippet, request: CreateRequest & { kind: "snippet" }) => void;
  onExerciseCreated: (exercise: Exercise, request: CreateRequest & { kind: "exercise" }) => void;
  onAssetCreated: (asset: Asset, request: CreateRequest & { kind: "asset" }) => void;
}

const heading = (request: CreateRequest): string => {
  switch (request.kind) {
    case "division":
      return "New division";
    case "snippet":
      return request.resolveRef ? "Add missing snippet" : "New snippet";
    case "exercise":
      return request.resolveRef ? "Add missing exercise" : "New exercise";
    case "asset":
      return request.replaceRef
        ? "Replace image"
        : request.resolveRef
          ? "Add missing image"
          : "New image";
  }
};

/**
 * What the editor pane shows while the author is creating something (the
 * store's `creating`): in place of the title bar and code editor, a form to
 * initialize the new division, snippet, exercise or asset. Nothing exists until it is
 * submitted; then the new item opens in the editor. Cancel (or Escape, or
 * opening any item) leaves the project as it was.
 */
const NewItemPane = ({
  onCreateSnippet,
  onCreateExercise,
  onUploadAsset,
  onFetchAssetUrl,
  onCreateAuthoredAsset,
  onCreateGeneratedAsset,
  onSnippetCreated,
  onExerciseCreated,
  onAssetCreated,
}: NewItemPaneProps) => {
  const creating = useEditorStore((s) => s.creating);
  const cancelCreate = useEditorStore((s) => s.cancelCreate);
  const editDraft = useEditorStore((s) => s.editDraft);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const { divisions, getDivisionType } = useDivisionActions();
  const removeSnippetRefFromDocument = useEditorStore(
    (s) => s.removeSnippetRefFromDocument,
  );
  const removeAssetRefFromDocument = useEditorStore(
    (s) => s.removeAssetRefFromDocument,
  );
  const removeExerciseRefFromDocument = useEditorStore(
    (s) => s.removeExerciseRefFromDocument,
  );

  // While the form waits on the host, Cancel would only pretend: the request
  // can't be called back. So Escape and ✕ wait too (the forms disable their
  // own Cancel button the same way).
  const [isBusy, setIsBusy] = useState(false);
  const cancel = () => {
    if (!isBusy) cancelCreate();
  };

  useEffect(() => {
    if (isBusy) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCreate();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, cancelCreate]);

  if (!creating) return null;

  // A placeholder with nothing behind it may be one the author no longer
  // wants, rather than one to fill in: offer to drop it instead.
  const unlinkedRef = creating.kind !== "division" ? creating.resolveRef : undefined;
  const removeUnlinked = unlinkedRef && (
    <SettingsActions
      actions={[
        {
          label: "Remove from document",
          danger: true,
          disabled: isBusy,
          onClick: () => {
            if (creating.kind === "snippet") removeSnippetRefFromDocument(unlinkedRef);
            else if (creating.kind === "exercise") removeExerciseRefFromDocument(unlinkedRef);
            else removeAssetRefFromDocument(unlinkedRef);
            cancelCreate();
          },
        },
      ]}
    />
  );

  const ref =
    creating.kind === "asset"
      ? (creating.replaceRef ?? creating.resolveRef)
      : creating.kind === "snippet" || creating.kind === "exercise"
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
            "Not used in the document yet. "
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
            The document uses a snippet <code>{creating.resolveRef}</code>{" "}
            that doesn't exist yet. Create it here.
          </SettingsNote>
        )}
        <NewSnippetForm
          resolveRef={creating.resolveRef}
          onCreate={onCreateSnippet}
          onCreated={(snippet) => onSnippetCreated(snippet, creating)}
          onCancel={cancelCreate}
          onBusyChange={setIsBusy}
        />
        {removeUnlinked}
      </>
    );
  } else if (creating.kind === "exercise") {
    body = (
      <>
        {creating.resolveRef && (
          <SettingsNote>
            The document uses an exercise <code>{creating.resolveRef}</code>{" "}
            that doesn't exist yet. Create it here.
          </SettingsNote>
        )}
        <NewExerciseForm
          resolveRef={creating.resolveRef}
          onCreate={onCreateExercise}
          onCreated={(exercise) => onExerciseCreated(exercise, creating)}
          onCancel={cancelCreate}
          onBusyChange={setIsBusy}
        />
        {removeUnlinked}
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
            The document uses an image <code>{creating.resolveRef}</code>{" "}
            that doesn't exist yet. Create it here.
          </SettingsNote>
        ) : null}
        <NewAssetForm
          isReplace={!!creating.replaceRef}
          initialTitle={creating.resolveRef}
          resolveRef={creating.resolveRef}
          onUpload={onUploadAsset}
          onFetchUrl={onFetchAssetUrl}
          onCreateAuthored={onCreateAuthoredAsset}
          onCreateGenerated={onCreateGeneratedAsset}
          onCreated={(asset) => onAssetCreated(asset, creating)}
          onCancel={cancelCreate}
          onBusyChange={setIsBusy}
        />
        {removeUnlinked}
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
          className="flex items-center justify-center w-8 h-7 p-0 border-none rounded-[3px] cursor-pointer text-slate-600 bg-transparent hover:bg-slate-200 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={cancel}
          disabled={isBusy}
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
