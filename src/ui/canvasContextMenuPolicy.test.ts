import { describe, expect, it } from "vitest";
import { canvasContextItems, contextClipboardSelection, contextMenuPosition, contextRegionLabel } from "./canvasContextMenuPolicy";

describe("Canvas context commands", () => {
  it("distinguishes legacy linked regions even when no current badge number exists",()=>{
    expect(contextRegionLabel(undefined,0,"红色图")).toBe("关联范围 1 · 红色图");
    expect(contextRegionLabel(undefined,1,"红色图")).toBe("关联范围 2 · 红色图");
    expect(contextRegionLabel(7,1,"蓝色图")).toBe("选区 7 · 蓝色图");
  });
  it("uses the approved object-specific command lists", () => {
    expect(canvasContextItems("canvas").map(item => item.id)).toEqual(["undo", "redo", "paste", "select-all", "import-image", "new-description", "new-folder", "overview"]);
    expect(canvasContextItems("image").map(item => item.id)).toEqual(["focus-image", "quick-annotation", "create-region", "move-to-folder", "copy", "delete"]);
    expect(canvasContextItems("description").map(item => item.id)).toEqual(["edit-description", "copy", "copy-description-text", "locate-related", "delete"]);
    expect(canvasContextItems("folder").map(item => item.id)).toEqual(["preview-folder", "open-folder", "rename-folder", "copy", "ungroup-folder", "delete"]);
  });
  it("retains explicitly selected dependencies but never copies an unrelated old selection", () => {
    const selected = { imagePlacementIds: ["picture"], descriptionIds: ["linked"] };
    expect(contextClipboardSelection({ kind: "description", id: "linked" }, selected)).toBe(selected);
    expect(contextClipboardSelection({ kind: "description", id: "other" }, selected)).toEqual({ descriptionIds: ["other"] });
    expect(contextClipboardSelection({ kind: "folder", id: "folder" }, selected)).toEqual({ folderIds: ["folder"] });
  });
  it("keeps an edge menu inside the visible viewport", () => {
    expect(contextMenuPosition({ x: 990, y: 690 }, { width: 232, height: 140 }, { width: 1000, height: 700 })).toEqual({ x: 760, y: 552 });
  });
  it("disables actions outside their scope and binds picker rows to stable IDs", () => {
    const root = canvasContextItems("canvas", {canUndo:false,canRedo:true,canCreateFolder:false,canEditScope:false});
    expect(root.filter(item=>!item.disabled).map(item=>item.id)).toEqual(["redo","overview"]);
    expect(canvasContextItems("image").find(item=>item.id==="move-to-folder")?.disabled).toBe(true);
    const image=canvasContextItems("image",{folders:[{id:"folder-a",label:"同名"},{id:"folder-b",label:"同名"}]});
    expect(image.find(item=>item.id==="move-to-folder")?.children?.map(item=>item.argument)).toEqual(["folder-a","folder-b"]);
    const description=canvasContextItems("description",{hasDescriptionText:false,related:[]});
    expect(description.filter(item=>item.disabled).map(item=>item.id)).toEqual(["copy-description-text","locate-related"]);
  });
});
