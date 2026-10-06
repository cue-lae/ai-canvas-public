import { describe, expect, it } from "vitest";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { createEmptyBusinessState } from "../domain/types";
import { createDocumentFingerprint } from "./documentSaveState";
import { documentFiles } from "./documentFiles";

const file = (id: string, data: string) => ({id, dataURL: `data:image/png;base64,${data}`, mimeType: "image/png", created: 1});

describe("document resource projection", () => {
  it("retains business-owned resources even outside the visible Folder", () => {
    const business=createEmptyBusinessState();
    business.imageAssets.hidden={id:"hidden",fileId:"hidden-file",name:"hidden.png",mimeType:"image/png",naturalWidth:1,naturalHeight:1,source:"local",createdAt:"fixture"};
    const files={"hidden-file":file("hidden-file","AAAA"),unreferenced:file("unreferenced","BBBB")} as unknown as BinaryFiles;
    expect(Object.keys(documentFiles([],business,files))).toEqual(["hidden-file"]);
    expect(Object.keys(files)).toHaveLength(2);
  });
  it("retains canonical scene references without depending on business registration", () => {
    const business=createEmptyBusinessState();
    const files={native:file("native","AAAA"),cached:file("cached","BBBB")} as unknown as BinaryFiles;
    expect(Object.keys(documentFiles([{fileId:"native"}],business,files))).toEqual(["native"]);
    expect(documentFiles([{fileId:"missing"}],business,files)).toEqual({});
  });
  it("an undone paste returns to the saved fingerprint without deleting redo bytes", () => {
    const business=createEmptyBusinessState();
    const cache={pasted:file("pasted","AAAA")} as unknown as BinaryFiles;
    const fingerprint=createDocumentFingerprint();
    const before={business,scene:{elements:[],appState:{theme:"light"},files:{}}};
    const afterUndo={...before,scene:{...before.scene,files:documentFiles([],business,cache)}};
    expect(fingerprint(afterUndo)).toBe(fingerprint(before));
    expect(cache.pasted.dataURL).toContain("AAAA");
    const afterRedo=documentFiles([{fileId:"pasted"}],business,cache);
    expect(afterRedo.pasted).toBe(cache.pasted);
  });
});
