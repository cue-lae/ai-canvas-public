import { defineConfig } from "vitest/config";

const excalidrawTestFiles = [
  "src/ui/CanvasContextMenu.test.tsx",
  "src/ui/CanvasBusinessNotice.test.tsx",
  "src/domain/canvasClipboard.test.ts",
  "src/services/canvasClipboard.test.ts",
  "src/domain/annotationSelection.test.ts",
  "src/domain/descriptions.test.ts",
  "src/domain/folderScene.test.ts",
  "src/domain/focusedPublish.test.ts",
  "src/domain/projectFile.test.ts",
  "src/domain/reconcile.test.ts",
  "src/services/canvasSnapshot.test.ts",
  "src/services/persistence.test.ts",
  "src/ui/descriptionHostController.test.ts",
  "src/ui/descriptionPresentation.test.ts",
  "src/ui/globalHistorySceneSync.test.ts",
];

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    workspace: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: excalidrawTestFiles,
        },
      },
      {
        test: {
          name: "excalidraw-jsdom",
          environment: "jsdom",
          include: excalidrawTestFiles,
          setupFiles: ["./src/test/vitest.setup.ts"],
          server: {
            deps: {
              inline: [
                "@excalidraw/excalidraw",
                "@excalidraw/laser-pointer",
                "open-color",
                "roughjs",
              ],
            },
          },
        },
      },
    ],
  },
});
