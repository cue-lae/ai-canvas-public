import { describe, expect, it } from "vitest";
import { createCanvasSelection } from "./canvasSelection";
import { resolveContextInformationSelection } from "./contextInformationSelection";

describe("上下文信息栏选择解析", () => {
  it("当前图片选择稳定显示图片信息", () => {
    expect(
      resolveContextInformationSelection({
        selection: createCanvasSelection({ imagePlacementIds: ["placement-1"] }),
        imageIdByPlacementId: { "placement-1": "image-1" },
        imageLayerId: null,
        selectedRegionImageId: null,
      }),
    ).toEqual({ kind: "image", imageId: "image-1" });
  });

  it("单选说明显示说明，清空选择后回到 Folder 上下文", () => {
    expect(
      resolveContextInformationSelection({
        selection: createCanvasSelection({ descriptionIds: ["description-1"] }),
        imageIdByPlacementId: {},
        imageLayerId: null,
        selectedRegionImageId: null,
      }),
    ).toEqual({ kind: "description", descriptionId: "description-1" });
    expect(
      resolveContextInformationSelection({
        selection: createCanvasSelection(),
        imageIdByPlacementId: {},
        imageLayerId: null,
        selectedRegionImageId: "stale-image",
      }),
    ).toEqual({ kind: "folder" });
  });

  it("多选显示数量摘要，不随机挑选对象", () => {
    expect(
      resolveContextInformationSelection({
        selection: createCanvasSelection({
          imagePlacementIds: ["placement-1"],
          descriptionIds: ["description-1"],
        }),
        imageIdByPlacementId: { "placement-1": "image-1" },
        imageLayerId: null,
        selectedRegionImageId: null,
      }),
    ).toEqual({
      kind: "selection",
      imageCount: 1,
      regionCount: 0,
      descriptionCount: 1,
    });
  });
});
