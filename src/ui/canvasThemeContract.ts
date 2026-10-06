export const CANVAS_THEME_IDS = [
  "white",
  "black",
  "blue",
  "green",
  "pink",
  "purple",
  "yellow",
] as const;

export type CanvasThemeId = (typeof CANVAS_THEME_IDS)[number];
export type LightCanvasThemeId = Exclude<CanvasThemeId, "black">;

interface CanvasThemeTokens {
  id: CanvasThemeId;
  label: string;
  excalidrawTheme: "light" | "dark";
  shell: string;
  surface: string;
  raised: string;
  canvas: string;
  card: string;
  /** Folder and description card surface; omitted when the CSS fallback is intentional. */
  objectSurface?: string;
  /** Global canvas status-pill surface; omitted for themes still using the legacy rule. */
  statusSurface?: string;
  header: string;
  rail: string;
  toolbar: string;
  handoff: string;
  text: string;
  mutedText: string;
  icon: string;
  border: string;
  accent: string;
  accentSurface: string;
  accentText: string;
  danger: string;
  success: string;
}

const theme = (tokens: CanvasThemeTokens): CanvasThemeTokens => tokens;

// Colored themes intentionally synchronize Folder, description, and global
// status-pill surfaces. White and black remain separate until their own
// contrast rules are finalized.
export const CANVAS_THEMES: Record<CanvasThemeId, CanvasThemeTokens> = {
  white: theme({
    id: "white",
    label: "白",
    excalidrawTheme: "light",
    shell: "#f7f7f7",
    surface: "#fbfbfc",
    raised: "#ffffff",
    canvas: "#fafafa",
    card: "#fafbfa",
    header: "#f7f7f7",
    rail: "#fbfbfc",
    toolbar: "#fefefe",
    handoff: "#fafbfa",
    text: "#303238",
    mutedText: "#62656c",
    icon: "#34373d",
    border: "#e3e5ea",
    accent: "#6b56a5",
    accentSurface: "#e6e0f4",
    accentText: "#392b68",
    danger: "#8b4e56",
    success: "#397252",
  }),
  black: theme({
    id: "black",
    label: "黑",
    excalidrawTheme: "dark",
    shell: "#232426",
    surface: "#232427",
    raised: "#1e1e20",
    canvas: "#323336",
    card: "#202021",
    objectSurface: "#414247",
    statusSurface: "#414247",
    header: "#232426",
    rail: "#232427",
    toolbar: "#1d1d1e",
    handoff: "#202021",
    text: "#f3f4f4",
    mutedText: "#c9cbcd",
    icon: "#f0f1f1",
    border: "#343639",
    accent: "#a89bd4",
    accentSurface: "#373349",
    accentText: "#fbf9ff",
    danger: "#efa6ad",
    success: "#9ed1b2",
  }),
  blue: theme({
    id: "blue",
    label: "蓝",
    excalidrawTheme: "light",
    shell: "#f0f5fc",
    surface: "#f0f5fc",
    raised: "#fafbfe",
    canvas: "#f5f8fd",
    card: "#fafbfe",
    objectSurface: "#fafbfe",
    statusSurface: "#fafbfe",
    header: "#f0f5fc",
    rail: "#f0f5fc",
    toolbar: "#f0f5fc",
    handoff: "#f0f5fc",
    text: "#233b5f",
    mutedText: "#5d7798",
    icon: "#213a61",
    border: "#dce8f6",
    accent: "#2e77c6",
    accentSurface: "#e2edfc",
    accentText: "#1d66b2",
    danger: "#8b4e56",
    success: "#356c55",
  }),
  green: theme({
    id: "green",
    label: "绿",
    excalidrawTheme: "light",
    shell: "#e2e6de",
    surface: "#e3e6df",
    raised: "#eff1ec",
    canvas: "#f2f4ef",
    card: "#eff1ec",
    objectSurface: "#f5f7f2",
    statusSurface: "#f5f7f2",
    header: "#e2e6de",
    rail: "#e3e6df",
    toolbar: "#e2e6de",
    handoff: "#e2e6de",
    text: "#263a2c",
    mutedText: "#526858",
    icon: "#223d2a",
    border: "#c9cec6",
    accent: "#407a57",
    accentSurface: "#ccd6c7",
    accentText: "#355238",
    danger: "#8a4f55",
    success: "#356c4e",
  }),
  pink: theme({
    id: "pink",
    label: "粉",
    excalidrawTheme: "light",
    shell: "#f3eaed",
    surface: "#f3eaed",
    raised: "#f8f0f2",
    canvas: "#fbf5f7",
    card: "#f8f0f2",
    objectSurface: "#fef8fa",
    statusSurface: "#fef8fa",
    header: "#f3eaed",
    rail: "#f3eaed",
    toolbar: "#f4ecee",
    handoff: "#f3eaed",
    text: "#43343a",
    mutedText: "#705e65",
    icon: "#4b3940",
    border: "#e4d6d9",
    accent: "#9b536f",
    accentSurface: "#e9cbd4",
    accentText: "#75465b",
    danger: "#8d4c58",
    success: "#3e6f58",
  }),
  purple: theme({
    id: "purple",
    label: "紫",
    excalidrawTheme: "light",
    shell: "#f0edf7",
    surface: "#f0eef8",
    raised: "#f7f5fd",
    canvas: "#f7f6fe",
    card: "#f7f5fd",
    objectSurface: "#faf9ff",
    statusSurface: "#faf9ff",
    header: "#f0edf7",
    rail: "#f0eef8",
    toolbar: "#f7f5fd",
    handoff: "#f0eef8",
    text: "#292664",
    mutedText: "#625a8f",
    icon: "#2c2770",
    border: "#e2ddef",
    accent: "#7551cf",
    accentSurface: "#e3def7",
    accentText: "#4a2ba6",
    danger: "#8b4e59",
    success: "#3b6f56",
  }),
  yellow: theme({
    id: "yellow",
    label: "黄",
    excalidrawTheme: "light",
    shell: "#efebe6",
    surface: "#efebe6",
    raised: "#f1eee9",
    canvas: "#f9f7f2",
    card: "#f1eee9",
    objectSurface: "#fcfaf5",
    statusSurface: "#fcfaf5",
    header: "#efebe6",
    rail: "#efece6",
    toolbar: "#efebe6",
    handoff: "#efebe6",
    text: "#3c352b",
    mutedText: "#756e5e",
    icon: "#38332a",
    border: "#e1deda",
    accent: "#966c2a",
    accentSurface: "#e9dbc1",
    accentText: "#7d5513",
    danger: "#874f52",
    success: "#3d6d50",
  }),
};

export const DEFAULT_CANVAS_THEME_ID: CanvasThemeId = "white";

export const isCanvasThemeId = (value: unknown): value is CanvasThemeId =>
  typeof value === "string" &&
  CANVAS_THEME_IDS.includes(value as CanvasThemeId);

export const resolveCanvasTheme = (value: unknown): CanvasThemeTokens =>
  CANVAS_THEMES[
    isCanvasThemeId(value) ? value : DEFAULT_CANVAS_THEME_ID
  ];

export const resolveCanvasThemeToggle = (
  current: CanvasThemeId,
  previousLightTheme: LightCanvasThemeId,
): CanvasThemeId => (current === "black" ? previousLightTheme : "black");

const relativeLuminance = (hexColor: string): number => {
  const normalized = hexColor.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

export const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
};

const EXCALIDRAW_DARK_CANVAS_INVERT = 0.93;
const HUE_ROTATE_180_MATRIX = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
] as const;

const clampColorChannel = (value: number): number =>
  Math.min(1, Math.max(0, value));

const parseHexRgb = (color: string): readonly [number, number, number] | null => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  ];
};

const formatHexRgb = (channels: readonly number[]): string =>
  `#${channels
    .map((channel) => Math.round(clampColorChannel(channel) * 255).toString(16).padStart(2, "0"))
    .join("")}`;

const applyHueRotate180 = (
  [red, green, blue]: readonly [number, number, number],
): readonly [number, number, number] => [
  HUE_ROTATE_180_MATRIX[0][0] * red +
    HUE_ROTATE_180_MATRIX[0][1] * green +
    HUE_ROTATE_180_MATRIX[0][2] * blue,
  HUE_ROTATE_180_MATRIX[1][0] * red +
    HUE_ROTATE_180_MATRIX[1][1] * green +
    HUE_ROTATE_180_MATRIX[1][2] * blue,
  HUE_ROTATE_180_MATRIX[2][0] * red +
    HUE_ROTATE_180_MATRIX[2][1] * green +
    HUE_ROTATE_180_MATRIX[2][2] * blue,
];

export const canvasThemeViewBackgroundColor = (
  visibleCanvasColor: string,
  excalidrawTheme: "light" | "dark",
): string => {
  if (excalidrawTheme === "light") {
    return visibleCanvasColor;
  }
  const visibleRgb = parseHexRgb(visibleCanvasColor);
  if (!visibleRgb) {
    return visibleCanvasColor;
  }

  // The dark Excalidraw canvas applies invert(0.93) then hue-rotate(180deg).
  // A 180-degree hue rotation is its own inverse, so undo it before inverting.
  const beforeHueRotate = applyHueRotate180(visibleRgb);
  const inverseInvertScale = 1 - 2 * EXCALIDRAW_DARK_CANVAS_INVERT;
  return formatHexRgb(
    beforeHueRotate.map(
      (channel) =>
        (channel - EXCALIDRAW_DARK_CANVAS_INVERT) / inverseInvertScale,
    ),
  );
};

export const canvasThemeAppState = (themeId: CanvasThemeId) => {
  const tokens = CANVAS_THEMES[themeId];
  return {
    theme: tokens.excalidrawTheme,
    viewBackgroundColor: canvasThemeViewBackgroundColor(
      tokens.canvas,
      tokens.excalidrawTheme,
    ),
  };
};

export const canvasThemeIdFromAppState = (
  appState: Readonly<{
    theme?: unknown;
    viewBackgroundColor?: unknown;
  }>,
  fallback: CanvasThemeId = DEFAULT_CANVAS_THEME_ID,
): CanvasThemeId => {
  const colorMatch = CANVAS_THEME_IDS.find(
    (themeId) =>
      CANVAS_THEMES[themeId].canvas === appState.viewBackgroundColor ||
      canvasThemeViewBackgroundColor(
        CANVAS_THEMES[themeId].canvas,
        CANVAS_THEMES[themeId].excalidrawTheme,
      ) === appState.viewBackgroundColor,
  );
  if (colorMatch) {
    return colorMatch;
  }
  if (appState.theme === "dark") {
    return "black";
  }
  return resolveCanvasTheme(fallback).id;
};

export const canvasThemeCssVariables = (themeId: CanvasThemeId) => {
  const tokens = CANVAS_THEMES[themeId];
  return {
    "--canvas-shell": tokens.shell,
    "--canvas-surface": tokens.surface,
    "--canvas-raised": tokens.raised,
    "--canvas-background": tokens.canvas,
    "--canvas-card": tokens.card,
    ...(tokens.objectSurface
      ? { "--canvas-object-surface": tokens.objectSurface }
      : {}),
    ...(tokens.statusSurface
      ? { "--canvas-status-surface": tokens.statusSurface }
      : {}),
    "--canvas-header": tokens.header,
    "--canvas-rail": tokens.rail,
    "--canvas-toolbar": tokens.toolbar,
    "--canvas-handoff": tokens.handoff,
    "--canvas-text": tokens.text,
    "--canvas-muted-text": tokens.mutedText,
    "--canvas-icon": tokens.icon,
    "--canvas-border": tokens.border,
    "--canvas-accent": tokens.accent,
    "--canvas-accent-surface": tokens.accentSurface,
    "--canvas-accent-text": tokens.accentText,
    "--canvas-danger": tokens.danger,
    "--canvas-success": tokens.success,
  } as const;
};
