import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { createEmptyBusinessState } from "../domain/types";
import { createVisibleFolder, synchronizeEmptyFolderCovers } from "../domain/folderScene";

export const canvasClipboardFixture = () => {
  const initial=createVisibleFolder({business:createEmptyBusinessState("source-document"),elements:[],folderId:"folder-one",name:"完整文件夹",x:0,y:0});
  const business=initial.business;
  business.imageAssets.image1={id:"image1",fileId:"file1",name:"图片",mimeType:"image/png",naturalWidth:1,naturalHeight:1,source:"local",createdAt:"fixture",folderId:"folder-one"};
  business.imagePlacements.placement1={id:"placement1",imageId:"image1",elementId:"scene-image",x:10,y:20,width:120,height:80,angle:0,scale:[1,1],crop:null,active:true,folderId:"folder-one"};
  business.regions.region1={id:"region1",imageId:"image1",elementId:"scene-region",geometry:null,active:true,status:"valid",folderId:"folder-one"};
  business.descriptions.description1={id:"description1",text:"原文包含 image1，不应替换",active:true,createdAt:"fixture",updatedAt:"fixture",folderId:"folder-one"};
  business.descriptionReferences.reference1={id:"reference1",descriptionId:"description1",anchor:{x:170,y:25},imageBinding:{imageId:"image1",relativeX:1.2},collapsed:false,active:true,folderId:"folder-one"};
  business.descriptionScopeLinks.link1={id:"link1",descriptionId:"description1",regionId:"region1",folderId:"folder-one"};
  business.quickAnnotations.quick1={id:"quick1",imageId:"image1",mode:"point",anchor:{x:.2,y:.3},labelAnchor:{x:1.4,y:-.1},text:"快标",ordinal:1,collapsed:false,active:true,createdAt:"fixture",updatedAt:"fixture"};
  Object.assign(business.document,{imageAssetIds:["image1"],imagePlacementIds:["placement1"],regionIds:["region1"],descriptionIds:["description1"],descriptionReferenceIds:["reference1"],descriptionScopeLinkIds:["link1"],quickAnnotationIds:["quick1"],nextQuickAnnotationOrdinal:2});
  Object.assign(business.folders["folder-one"],{imageAssetIds:["image1"],descriptionIds:["description1"],focusImageIds:["image1"]});
  const canonical=convertToExcalidrawElements([
    {type:"image",id:"scene-image",fileId:"file1",x:10,y:20,width:120,height:80,customData:{kind:"image",imageId:"image1",placementId:"placement1",folderId:"folder-one"}},
    {type:"rectangle",id:"scene-region",x:20,y:30,width:30,height:20,customData:{kind:"region",regionId:"region1",imageId:"image1",folderId:"folder-one"}},
  ] as never,{regenerateIds:false});
  const synchronized=synchronizeEmptyFolderCovers({business,elements:[...initial.elements,...canonical]});
  const files={file1:{id:"file1",mimeType:"image/png",dataURL:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=",created:1}} as unknown as BinaryFiles;
  return {business:synchronized.business,elements:synchronized.elements,files};
};

export const clipboardIdFactory = () => {
  let next=0;
  return (kind:string)=>`clipboard-${kind}-${++next}`;
};
