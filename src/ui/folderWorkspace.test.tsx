import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FolderWorkspace,
  folderDropTargetAtViewportPoint,
  focusEnvironmentRects,
  overlappingDescriptionIds,
} from "./folderWorkspace";

const noop = vi.fn();

describe("FolderWorkspace", () => {
  it("hit-tests the topmost visible Folder from canonical bounds under zoom and pan", () => {
    const folder = (id: string, x: number) => ({
      folder: {
        id,
        schemaVersion: 2 as const,
        kind: "folder" as const,
        name: id,
        imageAssetIds: [],
        descriptionIds: [],
        focusImageIds: [],
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      },
      bounds: { x, y: 30, width: 100, height: 80 },
    });
    const viewport = {
      zoom: 2,
      scrollX: -10,
      scrollY: -5,
      offsetLeft: 100,
      offsetTop: 50,
    };
    const items = [folder("folder-a", 20), folder("folder-b", 40)];
    expect(
      folderDropTargetAtViewportPoint(
        { clientX: 190, clientY: 130 },
        viewport,
        items,
      ),
    ).toBe("folder-b");
    expect(
      folderDropTargetAtViewportPoint(
        { clientX: 20, clientY: 20 },
        viewport,
        items,
      ),
    ).toBeNull();
  });

  it("finds only descriptions whose live screen rectangles overlap the focus image", () => {
    expect(
      [...overlappingDescriptionIds(
        { left: 100, top: 100, right: 500, bottom: 400 },
        [
          { id: "overlap", left: 480, top: 120, right: 620, bottom: 310 },
          { id: "clear", left: 520, top: 120, right: 660, bottom: 310 },
          { id: "edge-only", left: 500, top: 120, right: 640, bottom: 310 },
        ],
      )],
    ).toEqual(["overlap"]);
  });

  it("derives a seam-free four-segment environment around the live focus rect", () => {
    expect(
      focusEnvironmentRects(
        { left: 200, top: 100, width: 500, height: 400 },
        { width: 1200, height: 900 },
      ),
    ).toEqual([
      { id: "top", left: 0, top: 0, width: 1200, height: 100 },
      { id: "right", left: 700, top: 100, width: 500, height: 400 },
      { id: "bottom", left: 0, top: 500, width: 1200, height: 400 },
      { id: "left", left: 0, top: 100, width: 200, height: 400 },
    ]);
  });

  it("leaves Folder creation to the shared overview tool rail", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "overview", selectedFolderId: null }}
        items={[]}
        descriptions={[]}
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );
    expect(html).not.toContain("建立文件夹");
    expect(html).toContain('data-folder-layer="overview"');
  });

  it("renders a selected Folder with an independent enter action", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "preview", selectedFolderId: "folder-a" }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: ["image-a"],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
            bounds: { x: 100, y: 80, width: 232, height: 156 },
            previewImageUrl: "data:image/png;base64,AAAA",
          },
        ]}
        descriptions={[]}
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 88,
          offsetTop: 89,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );
    expect(html).toContain("Folder A");
    expect(html).toContain("进入");
    expect(html).toContain("双击进入");
    expect(html).toContain("folder-workspace-more");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("收起");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("left:100px");
    expect(html).toContain("top:80px");
    expect(html).toContain("width:232px");
    expect(html).toContain("height:156px");
  });

  it("marks only the active Folder as the transient drop target", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "overview", selectedFolderId: null }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: [],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-08T00:00:00.000Z",
              updatedAt: "2026-09-08T00:00:00.000Z",
            },
            bounds: { x: 100, y: 80, width: 136, height: 164 },
          },
        ]}
        descriptions={[]}
        folderDropTargetId="folder-a"
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );
    expect(html).toContain("folder-workspace-item is-drop-target");
    expect(html).toContain("收进 Folder");
  });

  it("renders the active drop payload and prompt inside the Folder", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "overview", selectedFolderId: null }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: [],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-08T00:00:00.000Z",
              updatedAt: "2026-09-08T00:00:00.000Z",
            },
            bounds: { x: 100, y: 80, width: 136, height: 164 },
          },
        ]}
        descriptions={[
          {
            id: "description-a",
            folderId: "folder-root",
            label: "说明 1",
            text: "待放入说明",
            anchor: { x: 40, y: 40 },
          },
        ]}
        selectedDescriptionIds={["description-a"]}
        imageDropPreviews={[
          {
            id: "placement-a",
            imageUrl: "data:image/png;base64,BBBB",
            bounds: { x: 90, y: 70, width: 120, height: 90 },
            angle: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
        ]}
        folderDropTargetId="folder-a"
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );

    expect(html).toContain("folder-description-item is-canvas-selected is-drop-preview");
    expect(html).toContain('class="folder-drop-image-preview-tray"');
    expect(html).toContain('data-preview-count="1"');
    expect(html).toContain('src="data:image/png;base64,BBBB"');
    expect(html).toContain('opacity:0.95');
    expect(html).toContain('class="folder-workspace-drop-prompt-text"');
    expect(html).not.toContain('class="folder-drop-image-preview-layer"');
    expect(html).toContain("收进 Folder");
  });

  it("marks a successful Folder drop as a separate transient state", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "overview", selectedFolderId: null }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: ["image-a"],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-08T00:00:00.000Z",
              updatedAt: "2026-09-08T00:00:00.000Z",
            },
            bounds: { x: 100, y: 80, width: 136, height: 164 },
          },
        ]}
        descriptions={[]}
        folderDropSuccessId="folder-a"
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );
    expect(html).toContain("folder-workspace-item is-drop-success");
    expect(html).not.toContain("收进 Folder");
  });

  it("keeps compact size while separating the preview source from its content", () => {
    const item = {
      folder: {
        id: "folder-a",
        schemaVersion: 2 as const,
        kind: "folder" as const,
        name: "Folder A",
        imageAssetIds: ["image-a"],
        descriptionIds: [],
        focusImageIds: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      bounds: { x: 100, y: 80, width: 136, height: 164 },
    };
    const render = (layer: "overview" | "preview") =>
      renderToStaticMarkup(
        <FolderWorkspace
          navigation={
            layer === "overview"
              ? { layer, selectedFolderId: null }
              : { layer, selectedFolderId: "folder-a" }
          }
          items={[item]}
          descriptions={[]}
          viewport={{
            zoom: 0.5,
            scrollX: 0,
            scrollY: 0,
            offsetLeft: 0,
            offsetTop: 0,
          }}
          onSelectFolder={noop}
          onEnterFolder={noop}
          onMoveFolder={noop}
          onDeleteFolder={noop}
          onUngroupFolder={noop}
          onSelectDescription={noop}
          onMoveDescription={noop}
        />,
      );

    const overview = render("overview");
    const preview = render("preview");
    expect(overview).toContain("left:50px");
    expect(preview).toContain("left:50px");
    expect(preview).toContain("top:40px");
    expect(overview).toContain("top:40px");
    for (const html of [overview, preview]) {
      expect(html).toContain("width:68px");
      expect(html).toContain("height:82px");
    }
  });

  it("keeps non-current Folder surfaces as dimmed preview context", () => {
    const folder = (id: string, name: string, x: number) => ({
      folder: {
        id,
        schemaVersion: 2 as const,
        kind: "folder" as const,
        name,
        imageAssetIds: [],
        descriptionIds: [],
        focusImageIds: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      bounds: { x, y: 80, width: 136, height: 164 },
    });
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "preview", selectedFolderId: "folder-a" }}
        items={[folder("folder-a", "Folder A", 100), folder("folder-b", "Folder B", 400)]}
        descriptions={[]}
        viewport={{
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );

    expect(html).toContain("Folder A");
    expect(html).toContain("Folder B");
    expect(html).toContain('data-folder-preview-state="selected"');
    expect(html).toContain('data-folder-preview-state="context"');
    expect(html).toContain('aria-disabled="true"');
    expect(html.match(/folder-workspace-enter/g)).toHaveLength(1);
    expect(html.match(/class="folder-workspace-more"/g)).toHaveLength(1);
    expect(html).not.toContain('role="menu"');
  });

  it("keeps preview members read-only and exposes Folder marquee metadata", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{ layer: "preview", selectedFolderId: "folder-a" }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: [],
              descriptionIds: ["description-a"],
              focusImageIds: [],
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
            bounds: { x: 800, y: 80, width: 232, height: 156 },
          },
        ]}
        descriptions={[
          {
            id: "description-a",
            folderId: "folder-a",
            label: "说明 1",
            text: "只读预览",
            anchor: { x: 360, y: 80 },
          },
        ]}
        viewport={{ zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );

    expect(html).toContain('data-canvas-object="folder"');
    expect(html).toContain('data-folder-id="folder-a"');
    expect(html).toContain('data-description-id="description-a" disabled=""');
    expect(html).not.toContain("收起");
  });

  it("keeps Root folders and only direct-parent descriptions in Root image focus", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{
          layer: "image",
          selectedFolderId: "folder-root",
          imageId: "image-root",
        }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Folder A",
              imageAssetIds: [],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
            bounds: { x: 800, y: 80, width: 232, height: 156 },
          },
        ]}
        descriptions={[
          {
            id: "description-root",
            folderId: "folder-root",
            label: "Root description",
            text: "Root context",
            anchor: { x: 360, y: 80 },
          },
          {
            id: "description-child",
            folderId: "folder-a",
            label: "Child description",
            text: "Must stay hidden",
            anchor: { x: 560, y: 80 },
          },
        ]}
        focusImageBounds={{ x: 120, y: 200, width: 600, height: 400 }}
        viewport={{ zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );

    expect(html).toContain("Folder A");
    expect(html).toContain("Root context");
    expect(html).not.toContain("Must stay hidden");
    expect(html).toContain("is-focus-context");
    expect(html).toContain('aria-disabled="true"');
  });

  it("hides a Root folder card that overlaps the focused image", () => {
    const html = renderToStaticMarkup(
      <FolderWorkspace
        navigation={{
          layer: "image",
          selectedFolderId: "folder-root",
          imageId: "image-root",
        }}
        items={[
          {
            folder: {
              id: "folder-a",
              schemaVersion: 2,
              kind: "folder",
              name: "Overlapping Folder",
              imageAssetIds: [],
              descriptionIds: [],
              focusImageIds: [],
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
            bounds: { x: 160, y: 240, width: 232, height: 156 },
          },
        ]}
        descriptions={[]}
        focusImageBounds={{ x: 120, y: 200, width: 600, height: 400 }}
        viewport={{ zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 }}
        onSelectFolder={noop}
        onEnterFolder={noop}
        onMoveFolder={noop}
        onDeleteFolder={noop}
        onUngroupFolder={noop}
        onSelectDescription={noop}
        onMoveDescription={noop}
      />,
    );

    expect(html).toContain('data-folder-layer="image"');
    expect(html).not.toContain("Overlapping Folder");
  });
});
