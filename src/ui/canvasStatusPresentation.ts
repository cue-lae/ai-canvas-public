import type { CanvasSelection } from "./canvasSelection";

export const CANVAS_SELECTION_STATUS = "选择已更新。";

export interface CanvasStatusContext {
  imageLayer: boolean;
  quickAnnotation: boolean;
  descriptionTool: boolean;
  activeDescription: boolean;
  descriptionScopeCount: number;
  selectedRegion: boolean;
  selectedRectangle: boolean;
  selectedImage: boolean;
  selection?: CanvasSelection;
}

export interface CanvasStatusPresentation {
  main: string;
  detail: string;
}

const trimEnd = (text: string) => text.trim().replace(/[。；]+$/, "");

/** Presentation only: the existing state and event message remain authoritative. */
export function canvasStatusContextText(context: CanvasStatusContext): string {
  if (context.imageLayer) return "";
  if (context.quickAnnotation) return "单击添加点标注，拖动添加矩形标注";
  if (context.descriptionTool) return "请选择一个现有选区完成首次关联";
  if (context.activeDescription) {
    return context.descriptionScopeCount === 0
      ? "作用于整张画布"
      : `同步高亮 ${context.descriptionScopeCount} 个平级范围`;
  }
  if (context.selectedRegion) return "可在说明中关联当前选区为平级范围";
  if (context.selectedRectangle) return "普通矩形仅为画布图形，不是 Codex 选区";
  if (context.selectedImage) return "矩形/手绘标注；Shift旋转：15°对齐，可回0°";
  return "";
}

export function createCanvasStatusPresentation(
  status: string,
  busy: boolean,
  context: CanvasStatusContext,
): CanvasStatusPresentation {
  const text = status.trim();
  const contextText = canvasStatusContextText(context);
  if (busy && !text.startsWith("正在")) {
    return { main: "正在处理…", detail: "请稍候" };
  }

  let main = text;
  let detail = "";
  let includeContext = true;
  const separator = text.indexOf("；");
  if (separator >= 0) {
    main = text.slice(0, separator);
    detail = text.slice(separator + 1);
  }

  if (text === "等待导入本地图片。") {
    main = "等待导入图片";
  } else if (text === "说明编辑器已在当前画布层级内展开。") {
    main = "已打开说明";
  } else if (text === "已建立可独立移动的零绑定说明；编辑器已在当前画布内展开。") {
    main = "已创建说明";
    detail = "说明可独立移动，编辑器已展开";
  } else if (text === "已建立说明并关联当前同 scope 选区。") {
    main = "已创建说明";
    detail = "已关联当前同层级选区";
  } else if (text.startsWith("已导入 ")) {
    main = "图片已导入";
    detail = text.slice("已导入 ".length);
  } else if (text.startsWith("快速标注已启动：")) {
    main = "快速标注";
    detail = text.slice("快速标注已启动：".length);
  } else if (text.startsWith("已创建选区；")) {
    main = "选区已创建";
  } else if (text.startsWith("已打开文件夹只读局部预览；")) {
    main = "文件夹预览 · 只读";
  } else if (text.startsWith("完整项目已保存为 ")) {
    main = "项目已保存";
    detail = text.slice("完整项目已保存为 ".length);
  } else if (text.startsWith("浏览器已下载完整项目 ")) {
    main = "项目已下载";
    detail = text.slice("浏览器已下载完整项目 ".length);
  } else if (text.startsWith("已读取 ")) {
    main = "项目已读取";
    detail = text.slice("已读取 ".length);
  } else if (text.startsWith("已准备，等待 Codex 读取。")) {
    main = "已准备，等待 Codex 读取";
    detail = text.slice("已准备，等待 Codex 读取。".length);
  } else if (text === "请先导入图片，再使用快速标注。") {
    main = "尚未导入图片";
    detail = "导入图片后即可使用快速标注";
    includeContext = false;
  }

  // Preserve error payloads verbatim in the detail line, never replace them
  // with instructions implied by a selection that happens to remain active.
  const error = text.match(/^(.{1,60}失败)[：:](.*)$/s);
  if (error) {
    main = error[1];
    detail = error[2];
    includeContext = false;
  }
  const selection = text.match(/^框选已选中 (\d+) 张图片、(\d+) 个选区、(\d+) 条说明；(.*)$/s);
  if (selection || text === CANVAS_SELECTION_STATUS) {
    // Selection text is a view of the canonical selection, not the last marquee event.
    const images = context.selection?.imagePlacementIds.length ?? Number(selection?.[1] ?? 0);
    const regions = context.selection?.regionIds.length ?? Number(selection?.[2] ?? 0);
    const descriptions = context.selection?.descriptionIds.length ?? Number(selection?.[3] ?? 0);
    const total = images + regions + descriptions;
    main = total === 0 ? "未选中对象" : `已选中 ${total} 个对象`;
    const counts = [images && `${images} 张图片`, regions && `${regions} 个选区`, descriptions && `${descriptions} 条说明`]
      .filter(Boolean).join("、");
    detail = total <= 1 ? counts : `${counts}；${selection?.[4] ?? "按 Delete 可删除这些对象"}`;
  }
  main = trimEnd(main);
  detail = trimEnd(detail);
  if (includeContext && contextText && !detail.includes(contextText) && !main.includes(contextText)) {
    detail = detail ? `${detail}；${contextText}` : contextText;
  }
  return { main, detail };
}
