import { describe, expect, it } from "vitest";
import { CANVAS_SELECTION_STATUS, canvasStatusContextText, createCanvasStatusPresentation, type CanvasStatusContext } from "./canvasStatusPresentation";
import { createCanvasSelection } from "./canvasSelection";

const empty: CanvasStatusContext = {
  imageLayer: false, quickAnnotation: false, descriptionTool: false,
  activeDescription: false, descriptionScopeCount: 0, selectedRegion: false,
  selectedRectangle: false, selectedImage: false,
};
const present = (text: string, patch: Partial<CanvasStatusContext> = {}, busy = false) =>
  createCanvasStatusPresentation(text, busy, { ...empty, ...patch });

describe("canvas status presentation", () => {
  it("uses live selection after an empty marquee, direct image click, mixed selection and clearing", () => {
    const stale = "框选已选中 0 张图片、0 个选区、0 条说明；按 Delete 可删除这些对象。";
    const image = { selectedImage: true, selection: createCanvasSelection({ imagePlacementIds: ["image-a"] }) };
    expect(present(stale, image)).toEqual(present(CANVAS_SELECTION_STATUS, image));
    expect(present(stale, image).main).toBe("已选中 1 个对象");
    expect(present(stale, image).detail).toBe("1 张图片；矩形/手绘标注；Shift旋转：15°对齐，可回0°");
    const mixed = { selection: createCanvasSelection({ imagePlacementIds: ["a", "b"], descriptionIds: ["note"] }) };
    expect(present(CANVAS_SELECTION_STATUS, mixed)).toEqual({
      main: "已选中 3 个对象", detail: "2 张图片、1 条说明；按 Delete 可删除这些对象",
    });
    expect(present(CANVAS_SELECTION_STATUS, { selection: createCanvasSelection() }))
      .toEqual({ main: "未选中对象", detail: "" });
  });
  it("does not retain old nonempty marquee counts after selection is cleared", () => {
    expect(present("框选已选中 2 张图片、1 个选区、0 条说明；按 Delete 可删除这些对象。", {
      selection: createCanvasSelection(),
    })).toEqual({ main: "未选中对象", detail: "" });
  });
  it("preserves progress and errors even when a live selection exists", () => {
    const selection = { selectedImage: true, selection: createCanvasSelection({ imagePlacementIds: ["a"] }) };
    expect(present(CANVAS_SELECTION_STATUS, selection, true)).toEqual({ main: "正在处理…", detail: "请稍候" });
    expect(present("打开项目失败：无法读取文件", selection)).toEqual({ main: "打开项目失败", detail: "无法读取文件" });
    expect(present("项目已保存。", selection).main).toBe("项目已保存");
  });
  it("shows one line when no context is required", () => {
    expect(present("等待导入本地图片。")).toEqual({ main: "等待导入图片", detail: "" });
  });
  it("keeps scope counts and distinguishes whole-canvas descriptions", () => {
    expect(present("说明编辑器已在当前画布层级内展开。", { activeDescription: true }).detail).toBe("作用于整张画布");
    expect(present("说明编辑器已在当前画布层级内展开。", { activeDescription: true, descriptionScopeCount: 3 }).detail).toBe("同步高亮 3 个平级范围");
  });
  it("preserves tool priority and image-layer suppression", () => {
    expect(canvasStatusContextText({ ...empty, quickAnnotation: true, activeDescription: true })).toContain("单击添加点标注");
    expect(canvasStatusContextText({ ...empty, imageLayer: true, quickAnnotation: true, selectedImage: true })).toBe("");
    expect(canvasStatusContextText({ ...empty, descriptionTool: true })).toContain("首次关联");
    expect(canvasStatusContextText({ ...empty, selectedRegion: true })).toContain("当前选区");
    expect(canvasStatusContextText({ ...empty, selectedRectangle: true })).toContain("不是 Codex 选区");
    expect(canvasStatusContextText({ ...empty, selectedImage: true })).toContain("手绘标注");
    expect(canvasStatusContextText({ ...empty, selectedImage: true })).toContain("Shift旋转：15°对齐，可回0°");
  });
  it("deduplicates quick annotation instructions without losing Esc", () => {
    const result = present("快速标注已启动：单击添加点标注，拖动添加矩形标注；按 Esc 退出。", { quickAnnotation: true });
    expect(result.main).toBe("快速标注");
    expect(result.detail.match(/单击添加点标注/g)).toHaveLength(1);
    expect(result.detail).toContain("Esc");
  });
  it("retains long filenames and failure payloads", () => {
    const filename = "商业方案_".repeat(35) + ".excalidraw";
    expect(present(`完整项目已保存为 ${filename}；可重新打开继续编辑。`).detail).toContain(filename);
    const payload = "BRIDGE_UNAVAILABLE：" + "诊断详情；".repeat(30);
    const result = present(`准备或发布重点 Codex 上下文失败：${payload}`, { selectedImage: true });
    expect(result.main).toBe("准备或发布重点 Codex 上下文失败");
    expect(result.detail).toBe(payload.replace(/；$/, ""));
  });
  it("keeps unknown messages and does not invent a success state", () => {
    const result = present("未识别的状态内容，需要保留。下一句也需要保留。");
    expect(result.main).toBe("未识别的状态内容，需要保留。下一句也需要保留");
    expect(present("前置检查未通过；缺少图片数据。").detail).toBe("缺少图片数据");
  });
  it("handles empty and mixed selections without a meaningless delete instruction", () => {
    expect(present("框选已选中 0 张图片、0 个选区、0 条说明；按 Delete 可删除这些对象。")).toEqual({ main: "未选中对象", detail: "" });
    const result = present("框选已选中 12 张图片、8 个选区、6 条说明；按 Delete 可删除这些对象。");
    expect(result.main).toBe("已选中 26 个对象");
    expect(result.detail).toContain("12 张图片、8 个选区、6 条说明");
    expect(result.detail).toContain("Delete");
  });
  it("does not present a stale success message as progress", () => {
    expect(present("项目已保存。", {}, true)).toEqual({ main: "正在处理…", detail: "请稍候" });
    expect(present("正在生成图片……", {}, true).main).toBe("正在生成图片……");
  });
  it("retains Codex receipt details", () => {
    const result = present("已准备，等待 Codex 读取。已交接 12 条说明；版本 revision-7。");
    expect(result.main).toBe("已准备，等待 Codex 读取");
    expect(result.detail).toContain("revision-7");
  });
  it("shortens the current create-description and import entry messages", () => {
    const result = present("已建立可独立移动的零绑定说明；编辑器已在当前画布内展开。", { activeDescription: true });
    expect(result.main).toBe("已创建说明");
    expect(result.detail).toContain("可独立移动");
    expect(result.detail).toContain("作用于整张画布");
    const imported = present("已导入 商业方案.png（2048 × 1536）。", { selectedImage: true });
    expect(imported.main).toBe("图片已导入");
    expect(imported.detail).toContain("商业方案.png（2048 × 1536）");
  });
});
