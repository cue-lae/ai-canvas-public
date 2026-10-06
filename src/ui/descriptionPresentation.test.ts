import { describe, expect, it } from "vitest";
import { createEmptyBusinessState, ROOT_FOLDER_ID, type BusinessState } from "../domain/types";
import { createDescriptionCanvasPresentation } from "./descriptionPresentation";

const presentationState = (): BusinessState => {
  const state = createEmptyBusinessState("presentation-doc");
  return {
    ...state,
    document: {
      ...state.document,
      descriptionIds: ["description-a", "description-b"],
      descriptionReferenceIds: ["reference-a", "reference-b"],
      descriptionScopeLinkIds: ["scope-a"],
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
    descriptions: {
      "description-a": {
        id: "description-a",
        text: "保留唯一正文",
        active: true,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
        folderId: ROOT_FOLDER_ID,
      },
      "description-b": {
        id: "description-b",
        text: "",
        active: true,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
        folderId: ROOT_FOLDER_ID,
      },
    },
    descriptionReferences: {
      "reference-a": {
        id: "reference-a",
        descriptionId: "description-a",
        anchor: { x: 20, y: 30 },
        collapsed: false,
        active: true,
        folderId: ROOT_FOLDER_ID,
      },
      "reference-b": {
        id: "reference-b",
        descriptionId: "description-b",
        anchor: { x: 40, y: 50 },
        collapsed: true,
        active: true,
        folderId: ROOT_FOLDER_ID,
      },
    },
    descriptionScopeLinks: {
      "scope-a": {
        id: "scope-a",
        descriptionId: "description-a",
        regionId: "region-a",
        folderId: ROOT_FOLDER_ID,
      },
    },
  };
};

describe("description presentation boundary", () => {
  it("derives description-only presentation from business data and scope DTOs", () => {
    const presentation = createDescriptionCanvasPresentation(
      presentationState(),
      [
        {
          regionId: "region-a",
          number: 1,
          imageId: "image-a",
          imageNumber: 1,
        },
      ],
    );

    expect(presentation.items).toEqual([
      expect.objectContaining({
        id: "description-a",
        text: "保留唯一正文",
        regionIds: ["region-a"],
      }),
      expect.objectContaining({
        id: "description-b",
        regionIds: [],
      }),
    ]);
    expect(presentation.scopes).toEqual([
      { regionId: "region-a", number: 1, imageId: "image-a", imageNumber: 1 },
    ]);
    expect(presentation.boundRegionIds).toEqual(new Set(["region-a"]));
    expect(presentation).toMatchObject({
      filledDescriptionCount: 1,
      canvasLevelDescriptionCount: 1,
      descriptionScopeLinkCount: 1,
    });
  });

  it("groups scopes by system image number and projects shared description labels", () => {
    const state = presentationState();
    state.document.descriptionScopeLinkIds = ["scope-a", "scope-b"];
    state.descriptionScopeLinks["scope-b"] = {
      id: "scope-b", descriptionId: "description-b", regionId: "region-a",
      folderId: ROOT_FOLDER_ID,
    };
    const presentation = createDescriptionCanvasPresentation(state, [
      { regionId: "region-a", number: 1, imageId: "image-a", imageNumber: 1, thumbnailUrl: "data:image/a" },
      { regionId: "region-b", number: 2, imageId: "image-b", imageNumber: 2 },
    ]);

    expect(presentation.scopeGroups).toEqual([
      expect.objectContaining({ imageId: "image-a", imageNumber: 1, scopes: [expect.objectContaining({ regionId: "region-a" })] }),
      expect.objectContaining({ imageId: "image-b", imageNumber: 2, scopes: [expect.objectContaining({ regionId: "region-b" })] }),
    ]);
    expect(presentation.regionBindings.get("region-a")).toEqual([
      { id: "description-a", number: 1 },
      { id: "description-b", number: 2 },
    ]);
  });
});
