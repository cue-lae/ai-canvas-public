import { getCommonBounds, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { createEmptyBusinessState, type BusinessStateV2, type Point } from "./types";
import { assertFolderIntegrity, synchronizeEmptyFolderCovers } from "./folderScene";
import { normalizeDescriptionBusinessState } from "./descriptions";
import { isBridgePublishableImageMimeType } from "./codexContext";

export interface CanvasClipboardSelection {
  imagePlacementIds?: readonly string[];
  descriptionIds?: readonly string[];
  regionIds?: readonly string[];
  quickAnnotationIds?: readonly string[];
  folderIds?: readonly string[];
}
export interface CanvasClipboardContent {
  format: "ai-canvas-clipboard";
  version: 1;
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  folderIds: readonly string[];
  origin: Point;
}
export class CanvasClipboardError extends Error {
  constructor(
    readonly code: "empty" | "invalid" | "missing-dependencies" | "missing-files" | "nested-folder",
    message: string,
    readonly missingImageIds: readonly string[] = [],
  ) { super(message); this.name = "CanvasClipboardError"; }
}

const tables = {
  imageAssets: "imageAssetIds", imagePlacements: "imagePlacementIds", regions: "regionIds",
  annotations: "annotationIds", descriptions: "descriptionIds", descriptionScopeLinks: "descriptionScopeLinkIds",
  descriptionReferences: "descriptionReferenceIds", aiExchanges: "aiExchangeIds", quickAnnotations: "quickAnnotationIds",
  folders: "folderIds",
} as const;
type Table = keyof typeof tables;
const tableNames = Object.keys(tables) as Table[];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const fail = (message = "复制内容不完整或格式不受支持。") : never => { throw new CanvasClipboardError("invalid", message); };
const indexTables = (state: BusinessStateV2, preferred = state.document) => {
  for (const key of tableNames) {
    const ids=Object.keys(state[key]);
    (state.document as unknown as Record<string, unknown>)[tables[key]] = [...new Set([...(preferred[tables[key]] ?? []).filter(id=>Object.hasOwn(state[key],id)),...ids])];
  }
};
const clone = <T>(value: T): T => structuredClone(value);
const assertTransportValue = (value: unknown, depth = 0, ancestors = new Set<object>()): void => {
  if (depth > 64 || (typeof value === "number" && !finite(value)) || ["function","symbol","bigint"].includes(typeof value)) fail();
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) fail();
  ancestors.add(value);
  for (const item of Object.values(value)) assertTransportValue(item, depth + 1, ancestors);
  ancestors.delete(value);
};

/** Validates an untrusted transport value before it can become scene input. */
export const validateCanvasClipboard = (input: unknown): CanvasClipboardContent => {
  try {
    assertTransportValue(input);
    if (!object(input) || input.format !== "ai-canvas-clipboard" || input.version !== 1 || !object(input.business) ||
        !object(input.files) || !Array.isArray(input.elements) || !Array.isArray(input.folderIds) || !object(input.origin) ||
        !finite(input.origin.x) || !finite(input.origin.y)) fail();
    const packet = input as unknown as CanvasClipboardContent;
    const state = packet.business;
    if (state.schemaVersion !== 2 || !validId(state.rootFolderId) || !object(state.document) || !validId(state.document.id)) fail();
    for (const key of tableNames) {
      if (!object(state[key]) || !Array.isArray(state.document[tables[key]])) fail();
      const ids = state.document[tables[key]]!;
      if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) fail();
      for (const [id, row] of Object.entries(state[key])) if (!validId(id) || !object(row) || row.id !== id || (key!=="folders" && id===state.rootFolderId)) fail();
    }
    if (!Number.isSafeInteger(state.document.nextQuickAnnotationOrdinal) || state.document.nextQuickAnnotationOrdinal < 1) fail();
    const copiedFolders = new Set(packet.folderIds);
    if (copiedFolders.size !== packet.folderIds.length || [...copiedFolders].some(id => !validId(id) || state.folders[id]?.kind !== "folder")) fail();
    if (Object.values(state.folders).some(row => row.id===state.rootFolderId ? row.kind!=="root" : row.kind!=="folder" || !copiedFolders.has(row.id))) fail();
    for (const [id, file] of Object.entries(packet.files)) {
      if (!validId(id) || id===state.rootFolderId || !object(file) || file.id !== id || typeof file.mimeType !== "string" ||
          !isBridgePublishableImageMimeType(file.mimeType) || typeof file.dataURL !== "string" ||
          !file.dataURL.startsWith(`data:${file.mimeType};base64,`)) fail("复制内容包含不支持的图片资源。");
    }
    for (const asset of Object.values(state.imageAssets)) {
      if (!validId(asset.fileId) || !packet.files[asset.fileId] || !finite(asset.naturalWidth) || !finite(asset.naturalHeight) || asset.naturalWidth <= 0 || asset.naturalHeight <= 0) fail("复制内容缺少图片资源或有效尺寸。");
    }
    const elements = new Map<string, ExcalidrawElement>();
    const allowedTypes = new Set(["image", "rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text"]);
    for (const element of packet.elements) {
      const structuralCover=element.customData?.kind==="folder-cover" && copiedFolders.has(element.customData.folderId as string) &&
        state.folders[element.customData.folderId as string]?.coverElementId===element.id;
      if (!object(element) || !validId(element.id) || element.id===state.rootFolderId || elements.has(element.id) || !allowedTypes.has(element.type) ||
          !finite(element.x) || !finite(element.y) || !finite(element.width) || !finite(element.height) || !finite(element.angle) ||
          element.width < 0 || element.height < 0 || (element.isDeleted !== false && !structuralCover) || !Array.isArray(element.groupIds) ||
          element.groupIds.some(id => !validId(id) || id===state.rootFolderId)) fail("复制内容包含不支持的画布对象。");
      if (element.type === "image" && (!element.fileId || !packet.files[element.fileId])) fail();
      if ("points" in element && (!Array.isArray(element.points) || element.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite)))) fail();
      elements.set(element.id, element);
    }
    for(const id of copiedFolders){
      const cover=elements.get(state.folders[id].coverElementId ?? "");
      if(cover?.type!=="rectangle" || cover.customData?.kind!=="folder-cover" || cover.customData.folderId!==id)fail("文件夹缺少原有封面位置数据。");
    }
    for (const placement of Object.values(state.imagePlacements)) {
      const element=elements.get(placement.elementId);
      if (!placement.active || element?.type !== "image" || element.customData?.imageId !== placement.imageId || element.customData?.placementId !== placement.id || element.fileId !== state.imageAssets[placement.imageId]?.fileId) fail("图片放置关系不完整。");
    }
    for (const region of Object.values(state.regions)) if (!region.active || !elements.has(region.elementId)) fail("选区缺少对应画布对象。");
    for (const annotation of Object.values(state.annotations)) if (!annotation.active || !state.regions[annotation.regionId] || !elements.has(annotation.elementId)) fail("标注关系不完整。");
    for (const description of Object.values(state.descriptions)) if (!description.active || typeof description.text !== "string") fail();
    for (const reference of Object.values(state.descriptionReferences)) {
      if (!reference.active || !object(reference.anchor) || !finite(reference.anchor.x) || !finite(reference.anchor.y) ||
          (reference.imageBinding && !state.imageAssets[reference.imageBinding.imageId])) fail("说明缺少关联图片。");
    }
    for (const quick of Object.values(state.quickAnnotations)) {
      const unit = (p: unknown) => object(p) && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      if (!quick.active || !unit(quick.anchor) || typeof quick.text !== "string" || !Number.isSafeInteger(quick.ordinal) || quick.ordinal < 1) fail("快速标注不完整。");
      if (quick.mode !== "point" && quick.mode !== "rectangle") fail();
      if (quick.labelAnchor && (!finite(quick.labelAnchor.x) || !finite(quick.labelAnchor.y))) fail();
      if (quick.mode === "rectangle" && (!unit(quick.rectangle) || !finite(quick.rectangle?.width) || !finite(quick.rectangle?.height) || quick.rectangle.width <= 0 || quick.rectangle.height <= 0 || quick.rectangle.x+quick.rectangle.width > 1 || quick.rectangle.y+quick.rectangle.height > 1)) fail();
    }
    assertFolderIntegrity(state);
    normalizeDescriptionBusinessState(state);
    for(const asset of Object.values(state.imageAssets))if(Object.values(state.imagePlacements).filter(row=>row.imageId===asset.id).length!==1)fail("图片放置关系不唯一。");
    for(const element of packet.elements)if(element.type==="image" && !Object.values(state.imagePlacements).some(row=>row.elementId===element.id))fail("图片缺少业务登记。");
    const neededFiles=new Set(Object.values(state.imageAssets).map(row=>row.fileId));
    if(Object.keys(packet.files).some(id=>!neededFiles.has(id)))fail("复制包包含无关资源。");
    // Do not let renderer bindings silently attach to objects outside the packet.
    for (const element of packet.elements) {
      const bindings = [...(element.boundElements ?? []).map(row => row.id),
        element.type === "text" ? element.containerId : null,
        "startBinding" in element ? element.startBinding?.elementId : null,
        "endBinding" in element ? element.endBinding?.elementId : null].filter(Boolean);
      if (bindings.some(id => !elements.has(id!))) fail("画布绑定引用了未复制的对象。");
    }
    return packet;
  } catch (error) {
    if (error instanceof CanvasClipboardError) throw error;
    return fail();
  }
};

export const createCanvasClipboard = (
  business: BusinessStateV2,
  scene: readonly ExcalidrawElement[],
  files: BinaryFiles,
  selection: CanvasClipboardSelection,
): CanvasClipboardContent => {
  assertFolderIntegrity(business);
  const folders=new Set(selection.folderIds ?? []), images=new Set<string>(), descriptions=new Set(selection.descriptionIds ?? []);
  const live=new Map(scene.filter(element=>!element.isDeleted).map(element=>[element.id,element]));
  const placements=Object.values(business.imagePlacements).filter(row=>row.active && live.has(row.elementId));
  for(const id of selection.imagePlacementIds ?? []) {
    const row=business.imagePlacements[id];if(!row?.active || !live.has(row.elementId)) fail("选中的图片已不可用。");images.add(row.imageId);
  }
  for(const id of folders){
    const folder=business.folders[id];if(folder?.kind!=="folder")fail("选中的文件夹已不可用。");
    for(const imageId of folder.imageAssetIds)if(placements.some(row=>row.imageId===imageId))images.add(imageId);
    for(const descriptionId of folder.descriptionIds)if(business.descriptions[descriptionId]?.active)descriptions.add(descriptionId);
  }
  const missing=new Set<string>();
  const needImage=(id: string | undefined)=>{if(!id || !business.imageAssets[id])return fail("关联图片已不可用。");if(!images.has(id))missing.add(id);};
  for(const id of selection.regionIds ?? [])needImage(business.regions[id]?.imageId);
  for(const id of selection.quickAnnotationIds ?? [])needImage(business.quickAnnotations[id]?.imageId);
  for(const id of descriptions){
    if(!business.descriptions[id]?.active)fail("选中的说明已不可用。");
    for(const link of Object.values(business.descriptionScopeLinks).filter(row=>row.descriptionId===id)){
      const region=business.regions[link.regionId];if(!region?.active)fail("说明包含已不可用的关联选区。");needImage(region.imageId);
    }
    for(const reference of Object.values(business.descriptionReferences).filter(row=>row.descriptionId===id && row.active))if(reference.imageBinding)needImage(reference.imageBinding.imageId);
  }
  if(missing.size)throw new CanvasClipboardError("missing-dependencies","尚未复制。请同时选中说明或标注关联的图片。",[...missing]);
  if(!images.size&&!descriptions.size&&!folders.size)throw new CanvasClipboardError("empty","请先选中要复制的内容。");
  const selectedPlacements=placements.filter(row=>images.has(row.imageId));
  if([...images].some(id=>selectedPlacements.filter(row=>row.imageId===id).length!==1))fail("图片放置关系不唯一，未执行复制。");
  const regions=new Set(Object.values(business.regions).filter(row=>row.active&&images.has(row.imageId)).map(row=>row.id));
  const fragment=createEmptyBusinessState(business.document.id);
  const rootId=fragment.rootFolderId;
  for(const id of folders){
    const cover=scene.find(element=>element.id===business.folders[id].coverElementId && element.customData?.kind==="folder-cover");
    if(!cover)fail("文件夹缺少可复制的原有封面位置数据。");
    fragment.folders[id]=clone({...business.folders[id],imageAssetIds:[],descriptionIds:[],focusImageIds:business.folders[id].focusImageIds.filter(imageId=>images.has(imageId))});
  }
  const include: Record<Table,(row:any)=>boolean>={
    imageAssets:row=>images.has(row.id),imagePlacements:row=>selectedPlacements.some(selected=>selected.id===row.id),
    regions:row=>regions.has(row.id),annotations:row=>row.active&&regions.has(row.regionId),
    descriptions:row=>descriptions.has(row.id),descriptionScopeLinks:row=>descriptions.has(row.descriptionId),
    descriptionReferences:row=>row.active&&descriptions.has(row.descriptionId),aiExchanges:row=>regions.has(row.regionId),
    quickAnnotations:row=>row.active&&images.has(row.imageId),folders:()=>false,
  };
  for(const key of tableNames.filter(key=>key!=="folders")){
    for(const [id,row] of Object.entries(business[key]).filter(([,row])=>include[key](row))){
      const copied=clone(row) as any;
      if("folderId" in copied)copied.folderId=folders.has(copied.folderId)?copied.folderId:rootId;
      (fragment[key] as Record<string,unknown>)[id]=copied;
    }
  }
  for(const row of Object.values(fragment.imageAssets))fragment.folders[row.folderId!].imageAssetIds.push(row.id);
  for(const row of Object.values(fragment.descriptions))fragment.folders[row.folderId!].descriptionIds.push(row.id);
  fragment.document.nextQuickAnnotationOrdinal=Math.max(1,...Object.values(fragment.quickAnnotations).map(row=>row.ordinal+1));
  indexTables(fragment,business.document);
  const directElements=new Set([...selectedPlacements.map(row=>row.elementId),...Object.values(fragment.regions).map(row=>row.elementId),...Object.values(fragment.annotations).map(row=>row.elementId)]);
  const elements=scene.filter(element=>{
    const data=element.customData ?? {};
    // A nonempty Folder retains its canonical cover geometry as a deleted
    // structural record. It is required for clearing/undo, not user history.
    if(data.kind==="folder-cover")return folders.has(data.folderId as string) && fragment.folders[data.folderId as string].coverElementId===element.id;
    if(element.isDeleted)return false;
    return directElements.has(element.id)||images.has(data.imageId as string)||regions.has(data.regionId as string)||descriptions.has(data.descriptionId as string);
  }).map(element=>({ ...clone(element),frameId:null,customData:element.customData ? {...clone(element.customData),...("folderId" in element.customData?{folderId:folders.has(element.customData.folderId as string)?element.customData.folderId:rootId}:{})}:undefined } as ExcalidrawElement));
  const neededFiles=new Set(Object.values(fragment.imageAssets).map(row=>row.fileId));
  for(const element of elements)if(element.type==="image"&&element.fileId)neededFiles.add(element.fileId);
  for(const id of neededFiles)if(!files[id])throw new CanvasClipboardError("missing-files","图片资源尚未完整加载，未执行复制。");
  const visible=elements.filter(element=>!element.isDeleted);
  const bounds=visible.length?getCommonBounds(visible):null;
  const anchors=Object.values(fragment.descriptionReferences).map(row=>row.anchor);
  const origin={x:Math.min(...anchors.map(point=>point.x),...(bounds?[bounds[0]]:[])),y:Math.min(...anchors.map(point=>point.y),...(bounds?[bounds[1]]:[]))};
  if(!finite(origin.x)||!finite(origin.y))fail("复制内容缺少可用的位置。");
  return validateCanvasClipboard({format:"ai-canvas-clipboard",version:1,business:fragment,elements,files:Object.fromEntries([...neededFiles].map(id=>[id,clone(files[id])])),folderIds:[...folders],origin});
};

export interface PreparedCanvasPaste {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  added: Required<CanvasClipboardSelection>;
}

/** Let the public SDK assign valid insertion indices before our history commit.
 * Keep all application data and geometry; never copy the SDK's indexing code. */
export const normalizeClipboardSceneOrder = (elements: readonly ExcalidrawElement[]): readonly ExcalidrawElement[] => {
  const normalized=restoreElements(elements.map(clone),null,{refreshDimensions:false,repairBindings:false});
  if(normalized.length!==elements.length || normalized.some((element,index)=>element.id!==elements[index].id))fail("画布对象无法安全排入目标图层，尚未粘贴。");
  return elements.map((element,index)=>element.index===normalized[index].index ? element : {
    ...element,index:normalized[index].index,version:normalized[index].version,versionNonce:normalized[index].versionNonce,
  } as ExcalidrawElement);
};

/** Prepare against a captured target; no mutation or I/O is performed here. */
export const prepareCanvasPaste = (
  input: unknown,
  target: {business: BusinessStateV2;elements:readonly ExcalidrawElement[];files:BinaryFiles;folderId:string},
  position: Point,
  newId: (kind: string) => string,
): PreparedCanvasPaste => {
  const packet=validateCanvasClipboard(input);
  assertFolderIntegrity(target.business);
  if(!finite(position.x)||!finite(position.y))fail("粘贴位置无效。");
  const destination=target.business.folders[target.folderId];
  if(!destination)fail("目标文件夹已不可用，尚未粘贴。");
  if(packet.folderIds.length && destination.kind!=="root")throw new CanvasClipboardError("nested-folder","请先返回主画布，再粘贴整个文件夹。");
  const source=packet.business;
  const business=clone(target.business);
  const used=new Set<string>([...Object.keys(target.files),...target.elements.flatMap(element=>[element.id,...element.groupIds])]);
  for(const key of tableNames)for(const id of Object.keys(business[key]))used.add(id);
  const fresh=(kind:string)=>{
    for(let attempt=0;attempt<32;attempt++){
      const id=newId(kind);
      if(validId(id)&&!used.has(id)&&!used.has(`folder-cover:${id}`)){used.add(id);return id;}
    }
    return fail("无法为粘贴副本分配独立身份。");
  };
  const ids=new Map<string,string>([[source.rootFolderId,target.folderId]]);
  const register=(id:string,kind:string)=>{if(!ids.has(id))ids.set(id,fresh(kind));return ids.get(id)!;};
  for(const id of packet.folderIds){
    const mapped=register(id,"folder");
    const cover=source.folders[id].coverElementId;
    if(cover){const mappedCover=`folder-cover:${mapped}`;if(used.has(mappedCover))fail();used.add(mappedCover);ids.set(cover,mappedCover);}
  }
  for(const key of tableNames)for(const id of Object.keys(source[key]))register(id,key);
  for(const id of Object.keys(packet.files))register(id,"file");
  for(const element of packet.elements){register(element.id,"element");for(const group of element.groupIds)register(group,"group");}
  const remap=(value:unknown,key=""):any=>{
    if(Array.isArray(value))return value.map(item=>remap(item,key.endsWith("Ids")?"id":key));
    if(object(value))return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,remap(item,name)]));
    return typeof value==="string" && (key==="id"||key.endsWith("Id")) ? ids.get(value) ?? value : value;
  };
  for(const key of tableNames){
    for(const oldId of source.document[tables[key]] ?? []){
      if(key==="folders"&&oldId===source.rootFolderId)continue;
      const id=ids.get(oldId)!;
      if(Object.hasOwn(business[key],id))fail("目标对象身份发生冲突。");
      const row=remap(source[key][oldId]);
      if(key==="folders"){row.imageAssetIds=[];row.descriptionIds=[];}
      (business[key] as Record<string,unknown>)[id]=row;
    }
  }
  const dx=position.x-packet.origin.x,dy=position.y-packet.origin.y;
  const elements=packet.elements.map(element=>({...remap(element),x:element.x+dx,y:element.y+dy,frameId:null} as ExcalidrawElement));
  for(const row of Object.values(source.imageAssets)){
    const asset=business.imageAssets[ids.get(row.id)!];business.folders[asset.folderId!].imageAssetIds.push(asset.id);
  }
  for(const row of Object.values(source.descriptions)){
    const description=business.descriptions[ids.get(row.id)!];business.folders[description.folderId!].descriptionIds.push(description.id);
  }
  for(const row of Object.values(source.imagePlacements)){
    const placement=business.imagePlacements[ids.get(row.id)!];placement.x+=dx;placement.y+=dy;
  }
  for(const row of Object.values(source.descriptionReferences)){
    const reference=business.descriptionReferences[ids.get(row.id)!];reference.anchor={x:reference.anchor.x+dx,y:reference.anchor.y+dy};
  }
  for(const row of Object.values(source.regions)){
    const region=business.regions[ids.get(row.id)!];
    if(region.geometry)region.geometry.sceneCorners=region.geometry.sceneCorners.map(point=>({x:point.x+dx,y:point.y+dy}));
  }
  for(const id of source.document.quickAnnotationIds)business.quickAnnotations[ids.get(id)!].ordinal=business.document.nextQuickAnnotationOrdinal++;
  // Preserve existing document order and append the source's explicit order.
  for(const key of tableNames){
    const added=(source.document[tables[key]]??[]).filter(id=>id!==source.rootFolderId).map(id=>ids.get(id)!);
    (business.document as unknown as Record<string,unknown>)[tables[key]]=[...(target.business.document[tables[key]]??[]),...added];
  }
  business.document.updatedAt=new Date().toISOString();
  const files:BinaryFiles={...target.files};
  for(const [id,file] of Object.entries(packet.files))files[ids.get(id)!]={...clone(file),id:ids.get(id)! as typeof file.id};
  assertFolderIntegrity(business);normalizeDescriptionBusinessState(business);
  const synchronized=synchronizeEmptyFolderCovers({business,elements:[...target.elements,...elements]});
  return {
    business:synchronized.business,elements:normalizeClipboardSceneOrder(synchronized.elements),files,
    added:{imagePlacementIds:source.document.imagePlacementIds.map(id=>ids.get(id)!),descriptionIds:source.document.descriptionIds.map(id=>ids.get(id)!),regionIds:source.document.regionIds.map(id=>ids.get(id)!),quickAnnotationIds:source.document.quickAnnotationIds.map(id=>ids.get(id)!),folderIds:packet.folderIds.map(id=>ids.get(id)!)},
  };
};
