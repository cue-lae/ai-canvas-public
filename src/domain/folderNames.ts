import type { BusinessStateV2 } from "./types";

export const renameCanvasFolder = (business: BusinessStateV2, id: string, value: string): BusinessStateV2 => {
  const folder = business.folders[id];
  if (!folder || folder.kind !== "folder") throw new Error("目标文件夹不存在，名称未修改。");
  const name = value.trim();
  if (!name) throw new Error("请输入文件夹名称。");
  if (name === folder.name) return business;
  return { ...business, folders: { ...business.folders, [id]: { ...folder, name, updatedAt: new Date().toISOString() } } };
};
