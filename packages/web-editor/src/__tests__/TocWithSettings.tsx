/**
 * Test support, not a test file (no `.test` suffix, so Vitest doesn't collect
 * it): the Contents tree beside the editor's title bar, wired the way `Editors`
 * wires them. Used with `renderWithStore` from `tocTestUtils`.
 */
import { useEditorStore } from "../store/hooks";
import ArticleToc from "../components/toc/ArticleToc";
import EditorTargetBar from "../components/EditorTargetBar";
import { resolveEditorTarget } from "../components/editorTarget";
import { useDivisionActions } from "../components/toc/useDivisionActions";

/**
 * The Contents tree beside the editor's title bar, as `Editors` lays them out:
 * enough to open a division and reach its settings drawer.
 */
export default function TocWithSettings({ readOnly }: { readOnly?: boolean }) {
  const openItem = useEditorStore((s) => s.openItem);
  const docDivisions = useEditorStore((s) => s.divisions) ?? [];
  const { rootDivision } = useDivisionActions();
  const target = resolveEditorTarget(
    openItem,
    docDivisions,
    undefined,
    undefined,
    rootDivision,
  );
  return (
    <>
      <ArticleToc />
      <EditorTargetBar
        target={target}
        readOnly={readOnly}
        onSaveSnippet={async () => {}}
        onSaveAsset={async () => {}}
      />
    </>
  );
}

