import {
  createDescription,
  deleteDescription,
  expandOnlyDescriptionReference,
  expandDescriptionReference,
  moveDescriptionReference,
  setDescriptionReferenceCollapsed,
  setDescriptionReferenceUrl,
  setDescriptionText,
  toggleDescriptionScope,
} from "../domain/descriptions";
import type { DescriptionImageBinding } from "../domain/descriptionImageBinding";
import type { BusinessState, Point } from "../domain/types";
import { DESCRIPTION_OVERVIEW_ZOOM_THRESHOLD } from "./descriptionInteraction";

type StateSetter<T> = (next: T | ((current: T) => T)) => void;

export type DescriptionBusinessCommit = (
  nextOrUpdater: BusinessState | ((state: BusinessState) => BusinessState),
  historyOperation?: string,
  recordHistory?: boolean,
) => void;

export interface DescriptionAnchorPlacement {
  anchor: Point;
  imageBinding: DescriptionImageBinding | null;
}

/**
 * Pure description host port. Host coordination concerns intentionally remain
 * outside this interface.
 */
export interface DescriptionHostPort {
  commitBusiness: DescriptionBusinessCommit;
  createId: (prefix: string) => string;
  getBusiness: () => BusinessState;
  viewportZoom: number;
  resolveAnchorPlacement: (anchor: Point) => DescriptionAnchorPlacement;
  setActiveDescriptionId: StateSetter<string | null>;
  setEditorFocusDescriptionId: StateSetter<string | null>;
  setDescriptionToolActive: StateSetter<boolean>;
  clearCodexContext: () => void;
  setStatus: (message: string) => void;
}

/**
 * Runtime-only hooks are injected by the outer host and carry no host object
 * types into the pure description layer.
 */
export interface DescriptionHostRuntimePort {
  clearVisualSelection?: () => void;
  onAnchorDragStart?: () => void;
  onAnchorMoveCommitted?: () => void;
}

export interface DescriptionHostController {
  setRuntimePort: (runtime: DescriptionHostRuntimePort) => void;
  create: (anchor: Point) => void;
  createWorkspace: (input: {
    anchor: Point;
    regionId?: string;
    focusEditor: boolean;
  }) => void;
  activate: (descriptionId: string) => void;
  switchTo: (descriptionId: string) => void;
  startAnchorDrag: () => void;
  setEditorFocus: (descriptionId: string, focused: boolean) => void;
  setText: (descriptionId: string, text: string) => void;
  setReferenceUrl: (descriptionId: string, referenceUrl: string) => void;
  toggleScope: (descriptionId: string, regionId: string) => void;
  setCollapsed: (descriptionId: string, collapsed: boolean) => void;
  moveAnchor: (descriptionId: string, anchor: Point, commit: boolean) => void;
  delete: (descriptionId: string) => void;
}

export const createDescriptionHostController = (
  port: DescriptionHostPort,
): DescriptionHostController => {
  let runtime: DescriptionHostRuntimePort = {};
  const clearVisualSelection = () => runtime.clearVisualSelection?.();

  return {
    setRuntimePort: (nextRuntime) => {
      runtime = nextRuntime;
    },
    create: (anchor) => {
      const descriptionId = port.createId("description");
      const referenceId = port.createId("description-reference");
      port.commitBusiness((current) =>
        expandDescriptionReference(
          createDescription(current, {
            descriptionId,
            referenceId,
            anchor,
          }),
          descriptionId,
        ),
      );
      port.setActiveDescriptionId(descriptionId);
      port.setEditorFocusDescriptionId(descriptionId);
      clearVisualSelection();
      port.setDescriptionToolActive(false);
      port.clearCodexContext();
      port.setStatus(
        "说明锚点已建立；请在锚点旁的白色说明框直接输入，并选择零个或多个平级范围。",
      );
    },
    createWorkspace: ({ anchor, regionId, focusEditor }) => {
      const descriptionId = port.createId("description");
      const referenceId = port.createId("description-reference");
      port.commitBusiness((current) => {
        const created = expandDescriptionReference(
          createDescription(current, {
            descriptionId,
            referenceId,
            anchor,
          }),
          descriptionId,
        );
        return regionId
          ? toggleDescriptionScope(created, {
              descriptionId,
              regionId,
              linkId: port.createId("description-scope"),
            })
          : created;
      }, "description-workspace-create");
      port.setActiveDescriptionId(descriptionId);
      port.setEditorFocusDescriptionId(focusEditor ? descriptionId : null);
      clearVisualSelection();
      port.setDescriptionToolActive(false);
      port.clearCodexContext();
      port.setStatus(
        regionId
          ? "已创建说明并关联当前选区；可随时在右侧工作区增删平级范围。"
          : "已创建零范围说明；它只在右侧说明工作区中显示。",
      );
    },
    activate: (descriptionId) => {
      port.commitBusiness((current) =>
        expandDescriptionReference(current, descriptionId),
      );
      port.setActiveDescriptionId(descriptionId);
      port.setEditorFocusDescriptionId(
        port.viewportZoom < DESCRIPTION_OVERVIEW_ZOOM_THRESHOLD
          ? descriptionId
          : null,
      );
      clearVisualSelection();
      port.setDescriptionToolActive(false);
    },
    switchTo: (descriptionId) => {
      port.commitBusiness((current) =>
        expandOnlyDescriptionReference(current, descriptionId),
      );
      port.setActiveDescriptionId(descriptionId);
      port.setEditorFocusDescriptionId(null);
      clearVisualSelection();
      port.setDescriptionToolActive(false);
    },
    startAnchorDrag: () => {
      runtime.onAnchorDragStart?.();
    },
    setEditorFocus: (descriptionId, focused) => {
      if (focused) {
        port.commitBusiness((current) =>
          expandDescriptionReference(current, descriptionId),
        );
        port.setActiveDescriptionId(descriptionId);
        port.setEditorFocusDescriptionId(descriptionId);
        return;
      }
      port.setEditorFocusDescriptionId((current) =>
        current === descriptionId ? null : current,
      );
    },
    setText: (descriptionId, text) => {
      port.commitBusiness((current) =>
        setDescriptionText(current, descriptionId, text),
      );
      port.setActiveDescriptionId(descriptionId);
      port.clearCodexContext();
    },
    setReferenceUrl: (descriptionId, referenceUrl) => {
      port.commitBusiness((current) =>
        setDescriptionReferenceUrl(current, descriptionId, referenceUrl),
      );
      port.setActiveDescriptionId(descriptionId);
      port.clearCodexContext();
    },
    toggleScope: (descriptionId, regionId) => {
      port.commitBusiness((current) =>
        toggleDescriptionScope(current, {
          descriptionId,
          regionId,
          linkId: port.createId("description-scope"),
        }),
      );
      port.setActiveDescriptionId(descriptionId);
      port.clearCodexContext();
    },
    setCollapsed: (descriptionId, collapsed) => {
      port.commitBusiness((current) =>
        collapsed
          ? setDescriptionReferenceCollapsed(current, descriptionId, true)
          : expandDescriptionReference(current, descriptionId),
      );
      // Visibility is persisted separately from the current description focus.
      // A collapsed reference may remain the active description.
      port.setActiveDescriptionId(descriptionId);
      if (collapsed) {
        port.setEditorFocusDescriptionId(null);
      }
    },
    moveAnchor: (descriptionId, anchor, commit) => {
      const placement = port.resolveAnchorPlacement(anchor);
      port.commitBusiness(
        (current) =>
          moveDescriptionReference(
            current,
            descriptionId,
            placement.anchor,
            placement.imageBinding,
          ),
        "description-anchor",
        commit,
      );
      if (commit) {
        runtime.onAnchorMoveCommitted?.();
      }
      port.clearCodexContext();
      if (commit) {
        port.setStatus(
          placement.imageBinding
            ? "说明锚点已吸附到当前图片；图片移动或缩放时会保持相对位置。"
            : "说明锚点已移动；正文、选区和范围关系保持不变。",
        );
      }
    },
    delete: (descriptionId) => {
      if (!port.getBusiness().descriptions[descriptionId]) {
        return;
      }
      port.commitBusiness((current) => deleteDescription(current, descriptionId));
      port.setActiveDescriptionId(null);
      port.setEditorFocusDescriptionId(null);
      clearVisualSelection();
      port.clearCodexContext();
      port.setStatus("当前说明、锚点和范围关系已删除；原选区保持不变。");
    },
  };
};
