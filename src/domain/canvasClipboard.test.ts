import { describe,it,expect } from "vitest";
import { restoreElements } from "@excalidraw/excalidraw";
import { canvasClipboardFixture,clipboardIdFactory } from "../test/canvasClipboardFixture";
import { createEmptyBusinessState } from "./types";
import { createVisibleFolder,assertFolderIntegrity,synchronizeEmptyFolderCovers } from "./folderScene";
import { createCanvasClipboard,prepareCanvasPaste,validateCanvasClipboard,normalizeClipboardSceneOrder,CanvasClipboardError } from "./canvasClipboard";
import { classifyGlobalHistorySceneChange } from "../ui/globalHistorySceneSync";

const packet=()=>{const f=canvasClipboardFixture();return createCanvasClipboard(f.business,f.elements,f.files,{folderIds:["folder-one"]});};
const target=()=>{const business=createEmptyBusinessState("target-document");return {business,elements:[],files:{},folderId:business.rootFolderId};};

describe("business clipboard",()=>{
  it("copies a whole Folder with its dependencies and necessary canonical cover geometry",()=>{
    const p=packet();expect(p.folderIds).toEqual(["folder-one"]);expect(p.elements.filter(element=>!element.isDeleted)).toHaveLength(2);
    expect(p.elements.find(element=>element.id===p.business.folders["folder-one"].coverElementId)?.isDeleted).toBe(true);
    expect(p.business.document.descriptionScopeLinkIds).toEqual(["link1"]);
    expect(p.business.document.quickAnnotationIds).toEqual(["quick1"]);expect(p.files.file1).toBeDefined();
    expect(()=>assertFolderIntegrity(p.business)).not.toThrow();
  });
  it("copies an image with regions and quick annotations without implicitly copying an unselected description",()=>{
    const f=canvasClipboardFixture();const p=createCanvasClipboard(f.business,f.elements,f.files,{imagePlacementIds:["placement1"]});
    expect(p.folderIds).toEqual([]);expect(p.business.document.descriptionIds).toEqual([]);
    expect(p.business.document.regionIds).toEqual(["region1"]);expect(p.business.imageAssets.image1.folderId).toBe(p.business.rootFolderId);
  });
  it("requires image dependencies for a description, region or quick annotation",()=>{
    const f=canvasClipboardFixture();
    for(const selection of [{descriptionIds:["description1"]},{regionIds:["region1"]},{quickAnnotationIds:["quick1"]}]){
      try{createCanvasClipboard(f.business,f.elements,f.files,selection);throw Error("Expected dependency refusal");}
      catch(error){expect(error).toBeInstanceOf(CanvasClipboardError);expect((error as CanvasClipboardError).missingImageIds).toEqual(["image1"]);}
    }
  });
  it("copies a standalone description without creating an image or a Folder",()=>{
    const f=canvasClipboardFixture();f.business.descriptionScopeLinks={};f.business.document.descriptionScopeLinkIds=[];
    delete f.business.descriptionReferences.reference1.imageBinding;
    const p=createCanvasClipboard(f.business,f.elements,f.files,{descriptionIds:["description1"]});
    expect(p.elements).toHaveLength(0);expect(p.files).toEqual({});expect(p.origin).toEqual({x:170,y:25});
    const next=prepareCanvasPaste(p,target(),{x:40,y:50},clipboardIdFactory());
    expect(Object.values(next.business.descriptionReferences)[0].anchor).toEqual({x:40,y:50});
  });
  it("remaps complete identities, preserves geometry and user text, and never mutates source or target",()=>{
    const p=packet(),before=JSON.stringify(p),t=target(),targetBefore=JSON.stringify(t);
    const next=prepareCanvasPaste(p,t,{x:200,y:300},clipboardIdFactory());
    const b=next.business,link=Object.values(b.descriptionScopeLinks)[0];
    expect(link.descriptionId).toBe(next.added.descriptionIds[0]);expect(link.regionId).toBe(next.added.regionIds[0]);
    expect(Object.values(b.descriptionReferences)[0].anchor).toEqual({x:360,y:305});
    expect(Object.values(b.quickAnnotations)[0].anchor).toEqual({x:.2,y:.3});
    expect(Object.values(b.quickAnnotations)[0].labelAnchor).toEqual({x:1.4,y:-.1});
    expect(Object.values(b.imagePlacements)[0]).toMatchObject({x:200,y:300,width:120,height:80});
    Object.values(b.descriptions)[0].text="仅修改副本";
    expect(JSON.stringify(p)).toBe(before);expect(JSON.stringify(t)).toBe(targetBefore);
  });
  it("supports repeat paste with independent objects and target numbering",()=>{
    const p=packet(),t=target(),id=clipboardIdFactory();t.business.document.nextQuickAnnotationOrdinal=9;
    const one=prepareCanvasPaste(p,t,{x:10,y:20},id);
    const two=prepareCanvasPaste(p,{...one,folderId:t.folderId},{x:30,y:50},id);
    expect(Object.values(two.business.quickAnnotations).map(row=>row.ordinal)).toEqual([9,10]);
    expect(new Set(two.elements.map(element=>element.id)).size).toBe(two.elements.length);
    expect(two.business.document.descriptionIds).toEqual([...one.business.document.descriptionIds,...two.added.descriptionIds]);
  });
  it("pastes partial objects inside an existing Folder but refuses nested whole Folders",()=>{
    const f=canvasClipboardFixture(),t={...f,folderId:"folder-one"};
    expect(()=>prepareCanvasPaste(packet(),t,{x:5,y:5},clipboardIdFactory())).toThrow("返回主画布");
    const p=createCanvasClipboard(f.business,f.elements,f.files,{imagePlacementIds:["placement1"],descriptionIds:["description1"]});
    const next=prepareCanvasPaste(p,t,{x:5,y:5},clipboardIdFactory());
    expect(next.added.folderIds).toEqual([]);
    expect(next.business.descriptions[next.added.descriptionIds[0]].folderId).toBe("folder-one");
  });
  it("preserves an empty Folder location and its canonical cover identity through reconciliation",()=>{
    const f=createVisibleFolder({business:createEmptyBusinessState(),elements:[],folderId:"empty",name:"空文件夹",x:20,y:30});
    const p=createCanvasClipboard(f.business,f.elements,{}, {folderIds:["empty"]});
    const next=prepareCanvasPaste(p,target(),{x:200,y:300},clipboardIdFactory());
    const folder=next.business.folders[next.added.folderIds[0]];
    expect(next.elements[0].id).toBe(folder.coverElementId);
    const synchronized=synchronizeEmptyFolderCovers(next);
    expect(synchronized.elements).toHaveLength(1);expect(synchronized.elements[0]).toMatchObject({x:200,y:300});
  });
  it("rejects unknown transport versions, missing material and dangling image bindings",()=>{
    expect(()=>validateCanvasClipboard({...packet(),version:2})).toThrow(CanvasClipboardError);
    const a=packet();delete a.files.file1;expect(()=>validateCanvasClipboard(a)).toThrow(CanvasClipboardError);
    const b=packet();b.business.descriptionReferences.reference1.imageBinding!.imageId="missing";
    expect(()=>validateCanvasClipboard(b)).toThrow(CanvasClipboardError);
    const c=packet();(c.elements[0] as {x:number}).x=Infinity;expect(()=>validateCanvasClipboard(c)).toThrow(CanvasClipboardError);
  });
  it("fails without target writes when identity allocation is unusable",()=>{
    const t=target(),before=JSON.stringify(t);expect(()=>prepareCanvasPaste(packet(),t,{x:1,y:1},()=>t.folderId)).toThrow(CanvasClipboardError);
    expect(JSON.stringify(t)).toBe(before);
  });
  it("rejects a forged second root and non-finite nested geometry",()=>{
    const p=packet();p.business.folders.extra={...p.business.folders[p.business.rootFolderId],id:"extra"};p.business.document.folderIds!.push("extra");
    expect(()=>validateCanvasClipboard(p)).toThrow(CanvasClipboardError);
    const other=packet();other.business.quickAnnotations.quick1.labelAnchor={x:Infinity,y:0};
    expect(()=>validateCanvasClipboard(other)).toThrow(CanvasClipboardError);
  });
  it("normalizes SDK insertion indices before history so the renderer adds no second scene-change",()=>{
    const f=canvasClipboardFixture(),image=f.elements.find(element=>element.type==="image")!;
    const first=structuredClone(image),second={...structuredClone(image),id:"another-image",x:300};
    const before=JSON.stringify(first);
    const normalized=normalizeClipboardSceneOrder([first,second]);
    expect(normalized[0]).toEqual(first);expect(JSON.stringify(first)).toBe(before);
    expect(normalized[1].index).not.toBe(first.index);
    const observed=restoreElements(structuredClone(normalized),null,{refreshDimensions:false,repairBindings:false});
    const rendererIndexUpdate=normalized.map((element,index)=>({...element,index:observed[index].index,version:observed[index].version,versionNonce:observed[index].versionNonce}));
    expect(classifyGlobalHistorySceneChange(normalized,rendererIndexUpdate)).toBeNull();
  });
});
