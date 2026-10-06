import {
  DEFAULT_CANVAS_THEME_ID,
  isCanvasThemeId,
  type CanvasThemeId,
  type LightCanvasThemeId,
} from "./canvasThemeContract";
import {
  createCanvasShortcutPreferences,
  normalizeCanvasShortcutPreferences,
  type CanvasShortcutPreferences,
} from "./canvasShortcutPreferences";

export type ContextPanelPlacement = "right" | "bottom" | "floating";

export interface WorkbenchPreferences {
  gridVisible: boolean;
  canvasTheme: CanvasThemeId;
  contextPanelOpen: boolean;
  contextPanelPlacement: ContextPanelPlacement;
  floatingPanelPosition: {
    x: number;
    y: number;
  };
  shortcuts: CanvasShortcutPreferences;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const storageKey = "ai-canvas.workbench-preferences.v2";
export const APPLICATION_THEME_STORAGE_KEY = "ai-canvas.application-theme.v1";

export interface ApplicationThemePreference {
  theme: CanvasThemeId;
  lastLight: LightCanvasThemeId;
}

const createDefaults = (): WorkbenchPreferences => ({
  gridVisible: false,
  canvasTheme: DEFAULT_CANVAS_THEME_ID,
  contextPanelOpen: false,
  contextPanelPlacement: "bottom",
  floatingPanelPosition: {
    x: 24,
    y: 92,
  },
  shortcuts: createCanvasShortcutPreferences(),
});

const resolveStorage = (): PreferenceStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readApplicationTheme = (
  storage: PreferenceStorage | null = resolveStorage(),
): ApplicationThemePreference | null => {
  try {
    const raw = storage?.getItem(APPLICATION_THEME_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!value || !isCanvasThemeId(value.theme)) return null;
    const lastLight = isCanvasThemeId(value.lastLight) && value.lastLight !== "black"
      ? value.lastLight : value.theme !== "black" ? value.theme : "white";
    return { theme: value.theme, lastLight };
  } catch { return null; }
};

/** Separate from per-document workbench writes, which may be stale. */
export const writeApplicationTheme = (
  theme: CanvasThemeId,
  previousLight: LightCanvasThemeId,
  storage: PreferenceStorage | null = resolveStorage(),
): ApplicationThemePreference => {
  const preference: ApplicationThemePreference = {
    theme,
    lastLight: theme === "black" ? previousLight : theme,
  };
  try { storage?.setItem(APPLICATION_THEME_STORAGE_KEY, JSON.stringify(preference)); }
  catch { /* Optional preferences cannot block Canvas use. */ }
  return preference;
};

const isPlacement = (value: unknown): value is ContextPanelPlacement =>
  value === "right" || value === "bottom" || value === "floating";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const loadWorkbenchPreferences = (
  storage: PreferenceStorage | null = resolveStorage(),
): WorkbenchPreferences => {
  const defaults = createDefaults();
  const applicationTheme = readApplicationTheme(storage);
  if (applicationTheme) defaults.canvasTheme = applicationTheme.theme;
  if (!storage) {
    return defaults;
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return defaults;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }
    const candidate = parsed as Partial<WorkbenchPreferences>;
    const position = candidate.floatingPanelPosition;

    return {
      gridVisible:
        typeof candidate.gridVisible === "boolean"
          ? candidate.gridVisible
          : defaults.gridVisible,
      canvasTheme: applicationTheme?.theme ?? (isCanvasThemeId(candidate.canvasTheme)
        ? candidate.canvasTheme
        : defaults.canvasTheme),
      contextPanelOpen:
        typeof candidate.contextPanelOpen === "boolean"
          ? candidate.contextPanelOpen
          : defaults.contextPanelOpen,
      contextPanelPlacement: "bottom",
      floatingPanelPosition:
        position &&
        isFiniteNumber(position.x) &&
        isFiniteNumber(position.y)
          ? { x: position.x, y: position.y }
          : defaults.floatingPanelPosition,
      shortcuts: normalizeCanvasShortcutPreferences(candidate.shortcuts),
    };
  } catch {
    return defaults;
  }
};

export const saveWorkbenchPreferences = (
  preferences: WorkbenchPreferences,
  storage: PreferenceStorage | null = resolveStorage(),
): void => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // UI preferences are optional and must never prevent canvas work.
  }
};
