export const CANVAS_SHORTCUT_IDS = [
  "selection",
  "hand",
  "laser",
  "selection-tool",
  "create-description",
  "quick-annotation",
  "create-folder",
  "import-image",
  "overview",
  "arrange",
] as const;

export type CanvasShortcutId = (typeof CANVAS_SHORTCUT_IDS)[number];

export type CanvasShortcutPreferences = Readonly<
  Record<CanvasShortcutId, readonly string[]>
>;

export const CANVAS_SHORTCUT_LABELS: Readonly<Record<CanvasShortcutId, string>> = {
  selection: "选择工具",
  hand: "平移工具",
  laser: "激光笔",
  "selection-tool": "统一选区工具",
  "create-description": "新建说明",
  "quick-annotation": "快速标注",
  "create-folder": "新建 Folder",
  "import-image": "导入图片",
  overview: "全览画布",
  arrange: "整理画布",
};

const createDefaults = (): CanvasShortcutPreferences => ({
  selection: ["V", "1"],
  hand: ["H"],
  laser: ["K"],
  "selection-tool": [],
  "create-description": [],
  "quick-annotation": [],
  "create-folder": [],
  "import-image": [],
  overview: [],
  arrange: [],
});

export const createCanvasShortcutPreferences = (): CanvasShortcutPreferences =>
  createDefaults();

type ShortcutModifier = "Ctrl" | "Alt" | "Shift";

const reservedShortcuts = new Set([
  "Ctrl+Z",
  "Ctrl+Y",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+X",
  "Ctrl+V",
  "Ctrl+R",
  "Ctrl+W",
  "Ctrl+L",
  "Ctrl+T",
  "Ctrl+N",
  "Ctrl+O",
  "Ctrl+P",
  "Ctrl+S",
  "Ctrl+F",
  ...Array.from({ length: 10 }, (_, index) => `Ctrl+${index}`),
]);

const modifierOrder: readonly ShortcutModifier[] = ["Ctrl", "Alt", "Shift"];

const normalizeBaseKey = (value: string): string | null => {
  const normalized = value.length === 1 ? value.toUpperCase() : value;
  return /^[A-Z0-9]$/.test(normalized) ? normalized : null;
};

export const normalizeCanvasShortcut = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const modifier = parts.length === 2 ? parts[0] : null;
  const base = normalizeBaseKey(parts.at(-1) ?? "");
  if (!base) return null;
  if (modifier !== null && !modifierOrder.includes(modifier as ShortcutModifier)) {
    return null;
  }
  return modifier ? `${modifier}+${base}` : base;
};

export const shortcutFromKeyboardEvent = (
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "code">>,
): string | null => {
  if (event.metaKey) return null;
  const modifiers = [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
  ].filter((modifier): modifier is ShortcutModifier => modifier !== null);
  if (modifiers.length > 1) return null;
  const base =
    normalizeBaseKey(event.key) ??
    (/^Key([A-Z])$/.exec(event.code ?? "")?.[1] ?? null) ??
    (/^Digit([0-9])$/.exec(event.code ?? "")?.[1] ?? null);
  return base ? `${modifiers[0] ? `${modifiers[0]}+` : ""}${base}` : null;
};

export const formatCanvasShortcut = (shortcut: string): string =>
  shortcut.replace("+", " + ");

export const formatCanvasShortcutList = (
  shortcuts: readonly string[],
): string =>
  shortcuts.length === 0
    ? "未设置"
    : shortcuts.map(formatCanvasShortcut).join(" / ");

export const createCanvasShortcutRows = (
  preferences: CanvasShortcutPreferences,
): readonly Readonly<{
  id: CanvasShortcutId;
  label: string;
  shortcuts: readonly string[];
  display: string;
}>[] =>
  CANVAS_SHORTCUT_IDS.map((id) => ({
    id,
    label: CANVAS_SHORTCUT_LABELS[id],
    shortcuts: preferences[id],
    display: formatCanvasShortcutList(preferences[id]),
  }));

const sanitizeShortcutList = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizeCanvasShortcut);
  if (normalized.some((shortcut) => shortcut === null)) return null;
  const shortcuts = normalized as string[];
  if (new Set(shortcuts).size !== shortcuts.length) return null;
  return shortcuts;
};

const shortcutsMatch = (
  actual: readonly string[],
  expected: readonly string[],
): boolean =>
  actual.length === expected.length &&
  actual.every((shortcut) => expected.includes(shortcut));

const isValidShortcutListForAction = (
  id: CanvasShortcutId,
  shortcuts: readonly string[],
): boolean => {
  if (id === "selection") {
    return shortcuts.length === 1 || shortcutsMatch(shortcuts, createDefaults().selection);
  }
  return shortcuts.length <= 1;
};

export const normalizeCanvasShortcutPreferences = (
  value: unknown,
): CanvasShortcutPreferences => {
  const defaults = createDefaults();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<Record<CanvasShortcutId, unknown>>;
  const parsed = {} as Record<CanvasShortcutId, readonly string[]>;
  for (const id of CANVAS_SHORTCUT_IDS) {
    const shortcuts = sanitizeShortcutList(candidate[id]);
    const validShape =
      shortcuts !== null &&
      isValidShortcutListForAction(id, shortcuts) &&
      shortcuts.every((shortcut) => !reservedShortcuts.has(shortcut));
    parsed[id] = validShape ? shortcuts : defaults[id];
  }

  const defaultOwner = new Map<string, CanvasShortcutId>();
  for (const id of CANVAS_SHORTCUT_IDS) {
    defaults[id].forEach((shortcut) => defaultOwner.set(shortcut, id));
  }
  const customIds = CANVAS_SHORTCUT_IDS.filter(
    (id) => !shortcutsMatch(parsed[id], defaults[id]),
  );
  const duplicateCustomShortcuts = new Set<string>();
  const seenCustomShortcuts = new Set<string>();
  for (const id of customIds) {
    for (const shortcut of parsed[id]) {
      if (seenCustomShortcuts.has(shortcut)) duplicateCustomShortcuts.add(shortcut);
      seenCustomShortcuts.add(shortcut);
    }
  }

  const resolved = {} as Record<CanvasShortcutId, readonly string[]>;
  for (const id of CANVAS_SHORTCUT_IDS) {
    const conflictsWithBuiltInDefault = customIds.includes(id) && parsed[id].some(
      (shortcut) => defaultOwner.get(shortcut) !== undefined && defaultOwner.get(shortcut) !== id,
    );
    const conflictsWithCustom = customIds.includes(id) && parsed[id].some(
      (shortcut) => duplicateCustomShortcuts.has(shortcut),
    );
    resolved[id] = conflictsWithBuiltInDefault || conflictsWithCustom ? defaults[id] : parsed[id];
  }
  return resolved;
};

export type CanvasShortcutAssignment =
  | { ok: true; preferences: CanvasShortcutPreferences }
  | { ok: false; reason: "invalid" | "reserved" | "conflict"; conflictId?: CanvasShortcutId };

export type CanvasShortcutRestore =
  | { ok: true; preferences: CanvasShortcutPreferences }
  | { ok: false; reason: "conflict"; conflictId: CanvasShortcutId };

export const assignCanvasShortcut = (
  preferences: CanvasShortcutPreferences,
  id: CanvasShortcutId,
  shortcut: string,
): CanvasShortcutAssignment => {
  const normalized = normalizeCanvasShortcut(shortcut);
  if (!normalized) return { ok: false, reason: "invalid" };
  if (reservedShortcuts.has(normalized)) return { ok: false, reason: "reserved" };
  const conflictId = CANVAS_SHORTCUT_IDS.find(
    (candidate) => candidate !== id && preferences[candidate].includes(normalized),
  );
  if (conflictId) return { ok: false, reason: "conflict", conflictId };
  return {
    ok: true,
    preferences: {
      ...preferences,
      [id]: [normalized],
    },
  };
};

export const restoreCanvasShortcutDefault = (
  preferences: CanvasShortcutPreferences,
  id: CanvasShortcutId,
): CanvasShortcutRestore => {
  const defaults = createDefaults();
  const conflictId = CANVAS_SHORTCUT_IDS.find(
    (candidate) =>
      candidate !== id &&
      defaults[id].some((shortcut) => preferences[candidate].includes(shortcut)),
  );
  if (conflictId) return { ok: false, reason: "conflict", conflictId };
  return {
    ok: true,
    preferences: {
      ...preferences,
      [id]: defaults[id],
    },
  };
};

export const restoreAllCanvasShortcutDefaults = (): CanvasShortcutPreferences =>
  createDefaults();

export const resolveCanvasShortcut = (
  preferences: CanvasShortcutPreferences,
  shortcut: string | null,
): CanvasShortcutId | null => {
  if (!shortcut) return null;
  return (
    CANVAS_SHORTCUT_IDS.find((id) => preferences[id].includes(shortcut)) ?? null
  );
};
