export const PRIMARY_CANVAS_TOOL_IDS = [
  "selection",
  "description",
  "hand",
  "overview",
  "laser",
] as const;

export const CANVAS_TOOLBAR_ORDER = [
  "menu",
  ...PRIMARY_CANVAS_TOOL_IDS.slice(0, 5),
  "separator",
] as const;

export const PRIMARY_CANVAS_TOOL_LABELS = {
  selection: "选择",
  description: "说明",
  hand: "平移",
  overview: "全览画布",
  laser: "激光笔",
} as const;

export const CANVAS_GRID_SOURCE = "excalidraw-native" as const;

export const gridControlState = (nativeGridVisible: boolean) => ({
  railPressed: nativeGridVisible,
  menuChecked: nativeGridVisible,
  nextNativeGridModeEnabled: !nativeGridVisible,
});

export const CANVAS_HELP_DEVELOPER = {
  label: "开发者 Cue",
  email: "liu355609@gmail.com",
} as const;

export type PrimaryCanvasToolId = (typeof PRIMARY_CANVAS_TOOL_IDS)[number];

export const codexHandoffStatusLabel = ({
  prepared,
  descriptionCount,
}: {
  prepared: boolean;
  descriptionCount: number;
}) => {
  if (prepared) {
    return "已准备，等待 Codex 读取";
  }
  return descriptionCount > 0 ? "待准备" : "等待说明";
};
