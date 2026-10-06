import type { CanvasClipboardSelection } from "../domain/canvasClipboard";

export type CanvasContextTarget = { kind: "canvas" } | {
  kind: "image" | "description" | "folder";
  id: string;
};
export type CanvasContextCommand = "paste" | "select-all" | "copy" | "delete" | "edit-description" | "open-folder" | "ungroup-folder"
  | "undo" | "redo" | "import-image" | "new-description" | "new-folder" | "overview"
  | "focus-image" | "quick-annotation" | "create-region" | "move-to-folder"
  | "copy-description-text" | "locate-related" | "preview-folder" | "rename-folder";
export interface CanvasContextItem {
  id: CanvasContextCommand;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  group?: string;
  argument?: string;
  children?: readonly CanvasContextItem[];
}
const copy: CanvasContextItem = { id: "copy", label: "复制", shortcut: "Ctrl+C", group: "copy" };
const remove: CanvasContextItem = { id: "delete", label: "删除", shortcut: "Delete", danger: true, group: "remove" };
export const contextRegionLabel = (number: number | undefined, index: number, imageName: string) =>
  `${number === undefined ? `关联范围 ${index + 1}` : `选区 ${number}`} · ${imageName}`;
export interface CanvasContextOptions {
  canUndo?: boolean; canRedo?: boolean; canCreateFolder?: boolean; canEditScope?: boolean;
  canFocusImage?: boolean; canAnnotate?: boolean; hasDescriptionText?: boolean;
  folders?: readonly { id: string; label: string }[];
  related?: readonly { id: string; label: string }[];
}

export const canvasContextItems = (kind: CanvasContextTarget["kind"], options: CanvasContextOptions = {}): readonly CanvasContextItem[] => {
  switch (kind) {
    case "canvas": return [
      { id: "undo", label: "撤销", shortcut: "Ctrl+Z", disabled: !options.canUndo, group: "history" },
      { id: "redo", label: "重做", shortcut: "Ctrl+Y", disabled: !options.canRedo, group: "history" },
      { id: "paste", label: "粘贴", shortcut: "Ctrl+V", group: "edit", disabled: options.canEditScope === false },
      { id: "select-all", label: "全部选中", shortcut: "Ctrl+A", group: "edit", disabled: options.canEditScope === false },
      { id: "import-image", label: "导入图片", group: "create", disabled: options.canEditScope === false },
      { id: "new-description", label: "新建说明", group: "create", disabled: options.canEditScope === false },
      { id: "new-folder", label: "建立 Folder", group: "create", disabled: !options.canCreateFolder },
      { id: "overview", label: "全览画布", group: "view" },
    ];
    case "image": return [
      { id: "focus-image", label: "聚焦查看", disabled: options.canFocusImage === false, group: "image" },
      { id: "quick-annotation", label: "快速标注", disabled: options.canAnnotate === false, group: "image" },
      { id: "create-region", label: "创建选区", disabled: options.canAnnotate === false, group: "image", children: [
        { id: "create-region", label: "矩形选区", argument: "rectangle" },
        { id: "create-region", label: "椭圆选区", argument: "ellipse" },
        { id: "create-region", label: "路径选区", argument: "path" },
      ] },
      { id: "move-to-folder", label: "收进 Folder", group: "organize", disabled: !options.folders?.length,
        children: options.folders?.map(folder => ({ id: "move-to-folder", label: folder.label, argument: folder.id })) }, copy, remove,
    ];
    case "description": return [
      { id: "edit-description", label: "编辑说明", group: "edit" }, copy,
      { id: "copy-description-text", label: "复制正文", disabled: !options.hasDescriptionText, group: "copy" },
      { id: "locate-related", label: "定位关联内容", disabled: !options.related?.length, group: "view",
        children: options.related?.map(item => ({ id: "locate-related", label: item.label, argument: item.id })) }, remove,
    ];
    case "folder": return [
      { id: "preview-folder", label: "预览", group: "open" }, { id: "open-folder", label: "打开", group: "open" },
      { id: "rename-folder", label: "重命名", group: "edit" }, copy, { id: "ungroup-folder", label: "解组", group: "organize" }, remove,
    ];
  }
};

/** A command on a selected member retains its group and its dependencies. */
export const contextClipboardSelection = (
  target: Exclude<CanvasContextTarget, { kind: "canvas" }>,
  selected: CanvasClipboardSelection,
): CanvasClipboardSelection => {
  const key = target.kind === "image" ? "imagePlacementIds" : target.kind === "description" ? "descriptionIds" : "folderIds";
  return selected[key]?.includes(target.id) ? selected : { [key]: [target.id] };
};

export const contextMenuPosition = (point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) => ({
  x: Math.max(8, Math.min(point.x, viewport.width - size.width - 8)),
  y: Math.max(8, Math.min(point.y, viewport.height - size.height - 8)),
});
