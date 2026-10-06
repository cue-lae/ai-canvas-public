import { describe, expect, it } from "vitest";
import { createEmptyBusinessState, type BusinessStateV2 } from "./types";
import { renameCanvasFolder } from "./folderNames";

describe("Folder naming",()=>{
  it("changes only the named Folder while retaining all members and relationships",()=>{
    const original=createEmptyBusinessState() as BusinessStateV2;
    original.folders.sample={...original.folders[original.rootFolderId],id:"sample",kind:"folder",name:"旧名",imageAssetIds:["image"],descriptionIds:["description"]};
    const renamed=renameCanvasFolder(original,"sample","  新名字  ");
    expect(original.folders.sample.name).toBe("旧名");expect(renamed.folders.sample.name).toBe("新名字");
    expect(renamed.folders.sample.imageAssetIds).toBe(original.folders.sample.imageAssetIds);
    expect(renamed.descriptionScopeLinks).toBe(original.descriptionScopeLinks);
    expect(renamed.document).toBe(original.document);
    expect(renameCanvasFolder(renamed,"sample","新名字")).toBe(renamed);
  });
  it("rejects empty names, missing targets and Root",()=>{
    const original=createEmptyBusinessState() as BusinessStateV2;
    original.folders.sample={...original.folders[original.rootFolderId],id:"sample",kind:"folder",name:"原名"};
    expect(()=>renameCanvasFolder(original,"sample"," ")).toThrow("请输入");
    expect(()=>renameCanvasFolder(original,"missing","新名")).toThrow("不存在");
    expect(()=>renameCanvasFolder(original,original.rootFolderId,"新名")).toThrow("不存在");
  });
});
