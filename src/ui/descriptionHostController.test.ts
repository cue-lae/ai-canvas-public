import { describe, expect, it } from "vitest";
import { createDescriptionCanvasPresentation } from "./descriptionPresentation";
import { createEmptyBusinessState, ROOT_FOLDER_ID, type BusinessState } from "../domain/types";
import { createDescriptionHostController } from "./descriptionHostController";

const createHarness = () => {
  let business: BusinessState = {
    ...createEmptyBusinessState("description-host"),
    imageAssets: {
      "image-a": {
        id: "image-a",
        fileId: "file-a",
        name: "test.png",
        mimeType: "image/png",
        naturalWidth: 100,
        naturalHeight: 100,
        source: "local",
        createdAt: "2026-08-12T00:00:00.000Z",
        folderId: ROOT_FOLDER_ID,
      },
    },
    regions: {
      "region-a": {
        id: "region-a",
        imageId: "image-a",
        elementId: "region-element-a",
        geometry: null,
        active: true,
        status: "invalid",
        folderId: ROOT_FOLDER_ID,
      },
    },
  };
  let activeDescriptionId: string | null = null;
  let editorFocusDescriptionId: string | null = null;
  let descriptionToolActive = true;
  let visualSelectionClears = 0;
  let anchorDragStarts = 0;
  let anchorMoveCommits = 0;
  let businessCommits = 0;
  const status: string[] = [];
  const codexContextClears: boolean[] = [];
  let id = 0;
  const setString = (
    setter: (next: string | null) => void,
    next: string | null | ((current: string | null) => string | null),
    current: () => string | null,
  ) => setter(typeof next === "function" ? next(current()) : next);

  const controller = createDescriptionHostController({
    commitBusiness: (nextOrUpdater) => {
      businessCommits += 1;
      business =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(business)
          : nextOrUpdater;
    },
    createId: (prefix) => `${prefix}-${++id}`,
    getBusiness: () => business,
    viewportZoom: 1,
    resolveAnchorPlacement: (anchor) => ({
      anchor: { x: anchor.x + 1, y: anchor.y + 2 },
      imageBinding: { imageId: "image-a", relativeX: 0.25, relativeY: 0.5 },
    }),
    setActiveDescriptionId: (next) =>
      setString(
        (value) => {
          activeDescriptionId = value;
        },
        next,
        () => activeDescriptionId,
      ),
    setEditorFocusDescriptionId: (next) =>
      setString(
        (value) => {
          editorFocusDescriptionId = value;
        },
        next,
        () => editorFocusDescriptionId,
      ),
    setDescriptionToolActive: (next) => {
      descriptionToolActive =
        typeof next === "function" ? next(descriptionToolActive) : next;
    },
    clearCodexContext: () => codexContextClears.push(true),
    setStatus: (message) => status.push(message),
  });
  controller.setRuntimePort({
    clearVisualSelection: () => {
      visualSelectionClears += 1;
    },
    onAnchorDragStart: () => {
      anchorDragStarts += 1;
    },
    onAnchorMoveCommitted: () => {
      anchorMoveCommits += 1;
    },
  });

  return {
    controller,
    get business(): BusinessState {
      return business;
    },
    get activeDescriptionId() {
      return activeDescriptionId;
    },
    get editorFocusDescriptionId() {
      return editorFocusDescriptionId;
    },
    get descriptionToolActive() {
      return descriptionToolActive;
    },
    get visualSelectionClears() {
      return visualSelectionClears;
    },
    get anchorDragStarts() {
      return anchorDragStarts;
    },
    get anchorMoveCommits() {
      return anchorMoveCommits;
    },
    get businessCommits() {
      return businessCommits;
    },
    get status() {
      return status;
    },
    get codexContextClears() {
      return codexContextClears;
    },
  };
};

describe("description host controller boundary", () => {
  it("keeps description actions pure while outer callbacks retain selection and history effects", () => {
    const harness = createHarness();

    harness.controller.create({ x: 10, y: 20 });
    const descriptionId = "description-1";
    expect(harness.business.descriptions[descriptionId]).toBeDefined();
    expect(harness.activeDescriptionId).toBe(descriptionId);
    expect(harness.editorFocusDescriptionId).toBe(descriptionId);
    expect(harness.descriptionToolActive).toBe(false);
    expect(harness.visualSelectionClears).toBe(1);

    harness.controller.activate(descriptionId);
    harness.controller.setText(descriptionId, "唯一正文");
    harness.controller.setReferenceUrl(descriptionId, "https://example.com/reference");
    harness.controller.toggleScope(descriptionId, "region-a");
    harness.controller.startAnchorDrag();
    harness.controller.moveAnchor(descriptionId, { x: 40, y: 50 }, true);

    expect(harness.business.descriptions[descriptionId]?.text).toBe("唯一正文");
    expect(harness.business.descriptions[descriptionId]?.referenceUrl).toBe(
      "https://example.com/reference",
    );
    expect(Object.values(harness.business.descriptionScopeLinks)).toEqual([
      expect.objectContaining({
        descriptionId,
        regionId: "region-a",
      }),
    ]);
    expect(
      Object.values(harness.business.descriptionReferences)[0],
    ).toMatchObject({
      anchor: { x: 41, y: 52 },
      imageBinding: { imageId: "image-a", relativeX: 0.25, relativeY: 0.5 },
    });
    expect(harness.anchorDragStarts).toBe(1);
    expect(harness.anchorMoveCommits).toBe(1);
    expect(harness.codexContextClears).toHaveLength(5);
    expect(harness.status.at(-1)).toContain("当前图片");

    harness.controller.delete(descriptionId);
    expect(harness.business.descriptions[descriptionId]).toBeUndefined();
    expect(harness.activeDescriptionId).toBeNull();
    expect(harness.editorFocusDescriptionId).toBeNull();
    expect(harness.visualSelectionClears).toBe(3);
  });

  it("switches a relationship label to one open description without changing ranges", () => {
    const harness = createHarness();
    harness.controller.create({ x: 10, y: 20 });
    harness.controller.create({ x: 30, y: 40 });
    harness.controller.toggleScope("description-1", "region-a");
    harness.controller.toggleScope("description-3", "region-a");

    harness.controller.switchTo("description-3");

    expect(harness.activeDescriptionId).toBe("description-3");
    expect(harness.business.descriptionReferences["description-reference-4"].collapsed).toBe(false);
    expect(harness.business.descriptionReferences["description-reference-2"].collapsed).toBe(true);
    expect(Object.values(harness.business.descriptionScopeLinks)).toHaveLength(2);
  });

  it("creates workspace descriptions through the same business commit path", () => {
    const harness = createHarness();

    harness.controller.createWorkspace({
      anchor: { x: 8, y: 9 },
      focusEditor: true,
    });
    expect(harness.businessCommits).toBe(1);
    expect(harness.business.descriptions["description-1"]).toBeDefined();
    expect(
      Object.values(harness.business.descriptionScopeLinks),
    ).toHaveLength(0);
    expect(harness.editorFocusDescriptionId).toBe("description-1");

    harness.controller.createWorkspace({
      anchor: { x: 12, y: 15 },
      regionId: "region-a",
      focusEditor: false,
    });
    expect(harness.businessCommits).toBe(2);
    expect(harness.activeDescriptionId).toBe("description-3");
    expect(harness.editorFocusDescriptionId).toBeNull();
    expect(Object.values(harness.business.descriptionScopeLinks)).toEqual([
      expect.objectContaining({
        descriptionId: "description-3",
        regionId: "region-a",
      }),
    ]);
  });

  it("keeps active and collapsed independent through both collapse entries and a rerender", () => {
    const harness = createHarness();
    harness.controller.create({ x: 10, y: 20 });
    const descriptionId = "description-1";

    // Anchor and minus both call the same host collapse port. The active
    // description remains stable while the persisted visual state is closed.
    harness.controller.setCollapsed(descriptionId, true);
    expect(harness.activeDescriptionId).toBe(descriptionId);
    expect(harness.editorFocusDescriptionId).toBeNull();
    expect(
      createDescriptionCanvasPresentation(harness.business, []).items[0]
        ?.collapsed,
    ).toBe(true);

    // This mirrors the overlay's next render after focus/selection effects;
    // no controller action may re-expand the persisted reference.
    harness.controller.setEditorFocus(descriptionId, false);
    expect(
      createDescriptionCanvasPresentation(harness.business, []).items[0]
        ?.collapsed,
    ).toBe(true);

    harness.controller.activate(descriptionId);
    expect(harness.activeDescriptionId).toBe(descriptionId);
    expect(
      createDescriptionCanvasPresentation(harness.business, []).items[0]
        ?.collapsed,
    ).toBe(false);
  });
});
