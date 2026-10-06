import { describe, expect, it } from "vitest";
import {
  loadWorkbenchPreferences,
  saveWorkbenchPreferences,
  APPLICATION_THEME_STORAGE_KEY,
  readApplicationTheme,
  writeApplicationTheme,
  type WorkbenchPreferences,
} from "./workbenchPreferences";
import { DEFAULT_CANVAS_THEME_ID } from "./canvasThemeContract";

const createStorage = (initialValue: string | null = null) => {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue;
    },
    read: () => value,
  };
};

describe("工作台 UI 偏好", () => {
  it("应用主题覆盖旧文档工作台偏好，普通偏好写入不能倒退主题", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    const stale = loadWorkbenchPreferences(storage);
    writeApplicationTheme("blue", "white", storage);
    saveWorkbenchPreferences(stale, storage);
    expect(loadWorkbenchPreferences(storage).canvasTheme).toBe("blue");
    expect(readApplicationTheme(storage)).toEqual({ theme: "blue", lastLight: "blue" });
  });
  it("新窗口从黑色主题回到全应用此前的浅色主题", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    writeApplicationTheme("black", "purple", storage);
    expect(readApplicationTheme(storage)).toEqual({ theme: "black", lastLight: "purple" });
    expect(loadWorkbenchPreferences(storage).canvasTheme).toBe("black");
    entries.set(APPLICATION_THEME_STORAGE_KEY, JSON.stringify({ theme: "black", lastLight: "black" }));
    expect(readApplicationTheme(storage)?.lastLight).toBe("white");
  });
  it("损坏或不可写的应用偏好不阻塞本地主题选择", () => {
    expect(readApplicationTheme(createStorage('{"theme":"unknown"}'))).toBeNull();
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readApplicationTheme(denied)).toBeNull();
    expect(writeApplicationTheme("green", "white", denied)).toEqual({ theme: "green", lastLight: "green" });
  });
  it("在缺少或损坏的本地值时回退到安全默认值", () => {
    expect(loadWorkbenchPreferences(createStorage())).toEqual({
      gridVisible: false,
      canvasTheme: DEFAULT_CANVAS_THEME_ID,
      contextPanelOpen: false,
      contextPanelPlacement: "bottom",
      floatingPanelPosition: { x: 24, y: 92 },
      shortcuts: {
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
      },
    });

    expect(loadWorkbenchPreferences(createStorage("{not-json"))).toEqual({
      gridVisible: false,
      canvasTheme: DEFAULT_CANVAS_THEME_ID,
      contextPanelOpen: false,
      contextPanelPlacement: "bottom",
      floatingPanelPosition: { x: 24, y: 92 },
      shortcuts: {
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
      },
    });
  });

  it("恢复网格与详情展开状态，但始终把交接栏固定在下方", () => {
    const restored = loadWorkbenchPreferences(
      createStorage(
        JSON.stringify({
          gridVisible: true,
          canvasTheme: "blue",
          contextPanelOpen: false,
          contextPanelPlacement: "floating",
          floatingPanelPosition: { x: 480, y: 136 },
          shortcuts: { selection: ["G"] },
        }),
      ),
    );

    expect(restored).toEqual({
      gridVisible: true,
      canvasTheme: "blue",
      contextPanelOpen: false,
      contextPanelPlacement: "bottom",
      floatingPanelPosition: { x: 480, y: 136 },
      shortcuts: {
        selection: ["G"],
        hand: ["H"],
        laser: ["K"],
        "selection-tool": [],
        "create-description": [],
        "quick-annotation": [],
        "create-folder": [],
        "import-image": [],
        overview: [],
        arrange: [],
      },
    });

    expect(
      loadWorkbenchPreferences(
        createStorage(
          JSON.stringify({
            contextPanelPlacement: "center",
            floatingPanelPosition: { x: "bad", y: 20 },
          }),
        ),
    ).contextPanelPlacement,
    ).toBe("bottom");
    const legacy = loadWorkbenchPreferences(
      createStorage(
        JSON.stringify({
          canvasBackgroundColor: "#dde4e7",
          canvasTheme: "not-a-theme",
        }),
      ),
    );
    expect(legacy.canvasTheme).toBe(DEFAULT_CANVAS_THEME_ID);
    expect(legacy).not.toHaveProperty("canvasBackgroundColor");
  });

  it("仅将 UI 偏好写入本地存储", () => {
    const storage = createStorage();
    const preferences: WorkbenchPreferences = {
      gridVisible: true,
      canvasTheme: "green",
      contextPanelOpen: false,
      contextPanelPlacement: "bottom",
      floatingPanelPosition: { x: 42, y: 104 },
      shortcuts: {
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
      },
    };

    saveWorkbenchPreferences(preferences, storage);
    expect(JSON.parse(storage.read() ?? "")).toEqual(preferences);
    expect(JSON.parse(storage.read() ?? "")).not.toHaveProperty(
      "canvasBackgroundColor",
    );
  });
});
