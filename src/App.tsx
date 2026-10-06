import {
  CaptureUpdateAction,
  DefaultSidebar,
  Excalidraw,
  MainMenu,
  elementPartiallyOverlapsWithOrContainsBBox,
  exportToBlob,
  getCommonBounds,
  getVisibleSceneBounds,
  newElementWith,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { scheduleCanvasHostReady } from "./services/canvasHostReady";
import { CanvasClipboardError, createCanvasClipboard, prepareCanvasPaste, normalizeClipboardSceneOrder, type CanvasClipboardSelection } from "./domain/canvasClipboard";
import { CANVAS_CLIPBOARD_MIME, decodeCanvasClipboard, writeCanvasClipboard } from "./services/canvasClipboard";
import { documentFiles } from "./services/documentFiles";
import { renameCanvasFolder } from "./domain/folderNames";
import { CanvasBusinessNotice, type CanvasBusinessNoticeData } from "./ui/CanvasBusinessNotice";
import { CanvasContextMenu } from "./ui/CanvasContextMenu";
import { canvasContextItems, contextClipboardSelection, contextRegionLabel, type CanvasContextTarget, type CanvasContextCommand, type CanvasContextItem } from "./ui/canvasContextMenuPolicy";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElement,
  NonDeleted,
  Ordered,
} from "@excalidraw/excalidraw/element/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  appendUnique,
  createEmptyBusinessState,
  ROOT_FOLDER_ID,
  type BusinessState,
  type BusinessStateV2,
  type P0Bundle,
  type ValidationIssue,
} from "./domain/types";
import {
  createVisibleFolder,
  compactFolderSurfaceBounds,
  deleteVisibleFolderWithContents,
  deleteFolderDirectObjects,
  deprojectFolderSceneChange,
  folderSceneElementIds,
  folderSceneBounds,
  folderPreviewLayout,
  migrateBusinessStateToV2,
  moveFolderContents,
  projectFolderScene,
  removeVisibleFolderPreservingContents,
  requiredDirectObjectsForReparent,
  reparentDirectObjects,
  stampSceneFolderOwnership,
  stabilizeFolderProjectionRuntimeMetadata,
  synchronizeImageBoundSceneElements,
  synchronizeEmptyFolderCovers,
  visibleFolderSceneElements,
  type FolderPreviewViewport,
  type FolderPreviewStage,
  type FolderProjectionMode,
  type FolderSceneBounds,
  type FolderSceneProjection,
} from "./domain/folderScene";
import { type GlobalHistorySource } from "./domain/globalHistoryTimeline";
import {
  arrangeCanvasObjects,
  resolveCanvasArrangeDescriptionImageId,
} from "./domain/canvasArrangeLayout";
import { bringImageLayerGroupToFront } from "./domain/imageLayerOrder";
import { calculateRegionGeometry } from "./domain/geometry";
import {
  bindDescriptionAnchorToImage,
  type DescriptionBindingImageFrame,
} from "./domain/descriptionImageBinding";
import {
  aiCanvasProjectFilename,
  parseAiCanvasProjectFile,
  serializeAiCanvasProjectFile,
  type ParsedAiCanvasProject,
} from "./domain/projectFile";
import {
  addFocusedImage,
  buildFocusedCanvasContext,
  didFocusedImageIdsChange,
  focusedPublishLimits,
  focusedPublishableImageFormatsLabel,
  getFocusedPublishPreflightError,
  isFocusedAnnotationSemanticElementKind,
  isFocusedPublishableImageMimeType,
  normalizeFocusedImageIds,
  removeFocusedImage,
  type FocusedCanvasContext,
} from "./domain/focusedPublish";
import {
  buildCodexVisualContext,
  bridgePublishableImageFormatsLabel,
  findActiveAnnotationForRegion,
  isBridgePublishableImageMimeType,
  type CodexVisualContext,
} from "./domain/codexContext";
import {
  reconcileBusinessState,
  type SceneElementLike,
} from "./domain/reconcile";
import {
  activeDescriptionEntries,
  createDescription,
  expandDescriptionReference,
  moveDescriptionReference,
  normalizeDescriptionBusinessState,
  reconcileDescriptionImageBindings,
  removeRegionSelection,
  translateSelectedDescriptionReferences,
  toggleDescriptionScope,
} from "./domain/descriptions";
import {
  ANNOTATION_CARD_PLACEHOLDER,
  ANNOTATION_CARD_FONT_FAMILY,
  ANNOTATION_CARD_ROUNDNESS,
  BUBBLE_CARD_PLACEHOLDER,
  BUBBLE_LEGACY_REFERENCE_STYLE_VERSION,
  BUBBLE_LEADER_KIND,
  BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION,
  BUBBLE_REFERENCE_STYLE_VERSION,
  BUBBLE_TEXT_KIND,
  createAnnotationCardBoundsForText,
  createAnnotationCardElements,
  createBubbleAnnotationElements,
  createImageElement,
  createRegionElement,
  getAnnotationLeaderLayout,
  getAnnotationLeaderLayoutFromEdgeAnchors,
  getReadableTextColor,
  createOrdinaryTextBoxElements,
  normalizeAnnotationCardGroupIds,
  retargetBubbleAnnotationElements,
  stableId,
  synchronizeBubbleAnnotationElements,
  synchronizeOrdinaryTextBoxElements,
  type AnnotationCardBounds,
} from "./excalidraw/scene";
import {
  isExplicitToolSessionElement,
  isManualAnnotationLeaderAnchors,
  snapManualAnnotationArrow,
} from "./excalidraw/annotationToolInteraction";
import {
  createBinaryFileData,
  createRegionMask,
  createRegionPng,
  downloadBlob,
  PixelAccessError,
  probeRemotePixelRead,
  readLocalImage,
  type LoadedLocalImage,
} from "./services/imageProcessing";
import {
  CanvasContextBridgeError,
  publishFocusedCanvasContext,
  publishNoActiveRegion,
  publishReadyCanvasContext,
} from "./services/canvasContextBridge";
import {
  CanvasSnapshotError,
  createCanvasSnapshot,
} from "./services/canvasSnapshot";
import { createHostDocumentOpenGate } from "./services/hostDocumentOpen";
import { createDocumentFingerprint, createDocumentSaveState, restoredDocumentReady, type DocumentSaveResult } from "./services/documentSaveState";
import { installNativeDocumentCloseStateResponder, installNativeDocumentRenameListener, nativeDocumentIdentity, nativeDocumentPort, readHostDocumentPresentation, readNativeMenuClipboard, requestNativeDocumentSave, sendNativeDocumentState, type HostDocumentPresentation } from "./services/hostDocumentSession";
import {
  loadP0Bundle,
  sanitizeAppState,
  saveP0Bundle,
} from "./services/persistence";
import {
  runPerformanceBenchmark,
  seedBenchmarkScene,
  type PerformanceBenchmarkResult,
} from "./performance/benchmark";
import {
  loadWorkbenchPreferences,
  saveWorkbenchPreferences,
  APPLICATION_THEME_STORAGE_KEY,
  readApplicationTheme,
  writeApplicationTheme,
  type ContextPanelPlacement,
} from "./ui/workbenchPreferences";
import {
  assignCanvasShortcut,
  CANVAS_SHORTCUT_LABELS,
  createCanvasShortcutRows,
  restoreAllCanvasShortcutDefaults,
  restoreCanvasShortcutDefault,
  shortcutFromKeyboardEvent,
  type CanvasShortcutId,
} from "./ui/canvasShortcutPreferences";
import {
  BubbleCanvasOverlay,
  type BubbleCanvasViewport,
} from "./ui/BubbleCanvasOverlay";
import { SelectionCanvasOverlay } from "./ui/SelectionCanvasOverlay";
import { QuickAnnotationOverlay } from "./ui/QuickAnnotationOverlay";
import {
  createQuickAnnotation,
  resizeQuickAnnotation,
  deleteQuickAnnotation,
  setQuickAnnotationCollapsed,
  setQuickAnnotationLabelAnchor,
  setQuickAnnotationText,
  translateQuickAnnotation,
} from "./ui/quickAnnotations";
import { DescriptionWorkspace } from "./ui/DescriptionWorkspace";
import { CanvasBridgeConnection } from "./ui/CanvasBridgeConnection";
import { CANVAS_SELECTION_STATUS, createCanvasStatusPresentation } from "./ui/canvasStatusPresentation";
import {
  FolderWorkspace,
  folderDropTargetAtViewportPoint,
  viewportRect as folderWorkspaceViewportRect,
  type FolderDropImagePreview,
  type FolderWorkspaceItem,
  type FolderNavigationState,
  type FolderPreviewMotionState,
} from "./ui/folderWorkspace";
import { createDescriptionHostController } from "./ui/descriptionHostController";
import { ImageRotationFeedback } from "./ui/ImageRotationFeedback";
import {
  DESCRIPTION_CREATION_IMAGE_GAP_PX,
  descriptionCreationCardSize,
  placeNewDescriptionOutsideImages,
} from "./ui/descriptionCreationPlacement";
import { createDescriptionCanvasPresentation } from "./ui/descriptionPresentation";
import {
  clampSelectionTranslationToImageBounds,
  ellipseFrameForHandle,
  getSelectionElements,
  selectionImageOrdinalMap,
  selectionNumberMap,
  selectionPointFrame,
  selectionScenePoints,
  orthogonalRectanglePointsFromVertex,
  selectionKindOf,
  type SelectionElementLike,
  type SelectionKind,
} from "./ui/selectionGeometry";
import { CanvasToolIcon } from "./ui/CanvasToolIcon";
import {
  marqueeSelectsBounds,
  type CanvasMarqueeSelectionMode,
  type CanvasObjectSelectionCandidate,
} from "./ui/canvasObjectSelection";
import {
  type CanvasPointerSessionKind,
} from "./ui/canvasPointerArbitration";
import {
  EMPTY_CANVAS_SELECTION,
  createCanvasSelection,
  nativeSelectionMirrorsEqual,
  projectCanvasSelectionToNativeElementIds,
  type CanvasSelection,
} from "./ui/canvasSelection";
import {
  useCanvasInteractionRuntime,
  createCanvasHistoryRuntime,
  createCanvasPointerRuntime,
  type CanvasInteractionSnapshot,
} from "./ui/canvasInteractionRuntime";
import {
  createCanvasHistoryController,
  createCanvasKeyboardController,
  createCanvasPointerController,
  createCanvasSelectionController,
  createDescriptionRuntimeAdapter,
  fitImportedImageToViewport,
  hitTestCanvasImageEntry,
  imageDetailViewportPlan,
  resolveMeasuredViewportSize,
  resolveCanvasImageEntryId,
  resolveUniformImageTranslation,
  resolveSelectionToolMenuKey,
  attachFolderPreviewWheelGuard,
  shouldBlockPreviewPan,
  shouldClaimCanvasImageDoubleClick,
} from "./ui/canvasInteractionHostController";
import { resolveContextInformationSelection } from "./ui/contextInformationSelection";
import type { CanvasNativeToolShortcut } from "./ui/canvasKeyboardRouter";
import { createCanvasSessionResetState } from "./ui/canvasSessionReset";
import {
  isAllowedNativeCanvasTool,
  isBlockedNativeToolShortcut,
} from "./ui/nativeToolShortcutGuard";
import {
  CANVAS_HELP_DEVELOPER,
  gridControlState,
} from "./ui/canvasWorkspaceContract";
import {
  CANVAS_THEMES,
  CANVAS_THEME_IDS,
  canvasThemeAppState,
  canvasThemeCssVariables,
  resolveCanvasThemeToggle,
  type CanvasThemeId,
  type LightCanvasThemeId,
} from "./ui/canvasThemeContract";

type ActiveSceneElements = ReturnType<
  ExcalidrawImperativeAPI["getSceneElements"]
>;
type UpdateScenePayload = Parameters<
  ExcalidrawImperativeAPI["updateScene"]
>[0];

interface PendingRegion {
  imageId: string;
  selectionKind: SelectionKind;
}

interface PendingManualAnnotation {
  imageId: string;
  regionId: string;
  annotationId: string;
  stage: "text" | "leader";
  existingElementIds: Set<string>;
  draftCardId?: string;
  draftTextId?: string;
}

interface PendingProjectOpen {
  fileName: string;
  project: ParsedAiCanvasProject;
}

type AppGlobalHistorySnapshot = CanvasInteractionSnapshot<
  BusinessState,
  readonly ExcalidrawElement[]
>;

interface AssetValidationResult {
  regionId: string;
  clippedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cropBytes: number;
  selectionMaskBytes: number;
  originalMaskBytes: number;
  outOfBoundsClipped: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  outOfBoundsCropBytes: number;
}

interface SelectedBubbleAnnotation {
  bubbleId: string;
  regionId: string | null;
  text: string;
}

type CanvasViewport = BubbleCanvasViewport;

type PreparedCodexContext = CodexVisualContext | FocusedCanvasContext;

type FolderPreviewMotion = Readonly<{
  folderId: string;
  imageIds: readonly string[];
  descriptionIds: readonly string[];
}>;

interface NativeFolderDropGesture {
  pointerId: number;
  draggedPlacementId: string | null;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  targetFolderId: string | null;
  snapshot: AppGlobalHistorySnapshot;
}

interface MixedDescriptionDragGesture {
  descriptionIds: readonly string[];
  imageIds: readonly string[];
  snapshot: AppGlobalHistorySnapshot;
}

interface FolderDropDirectSelection {
  imageIds: readonly string[];
  descriptionIds: readonly string[];
}

const folderProjectionMode = (
  navigation: FolderNavigationState,
  previewViewport?: FolderPreviewViewport,
  previewImageId?: string,
  previewImageIds?: readonly string[],
): FolderProjectionMode =>
  navigation.layer === "overview"
    ? { type: "overview" }
    : navigation.layer === "preview"
      ? {
          type: "preview",
          folderId: navigation.selectedFolderId,
          viewport: previewViewport,
          ...(previewImageId ? { previewImageId } : {}),
          ...(previewImageIds && previewImageIds.length > 0 ? { previewImageIds } : {}),
        }
      : navigation.layer === "folder"
        ? { type: "folder", folderId: navigation.selectedFolderId }
        : navigation.layer === "image"
          ? {
              type: "image",
              folderId: navigation.selectedFolderId,
              imageId: navigation.imageId,
            }
          : {
              type: "description-bindings",
              folderId: navigation.selectedFolderId,
              descriptionId: navigation.descriptionId,
            };

const folderScopeId = (
  navigation: FolderNavigationState,
  business: BusinessStateV2,
): string =>
  navigation.layer === "folder" ||
  navigation.layer === "image" ||
  navigation.layer === "description"
    ? navigation.selectedFolderId
    : business.rootFolderId;

const folderDropDirectSelection = ({
  business,
  selection,
  draggedPlacementId = null,
  draggedDescriptionId = null,
}: {
  business: BusinessStateV2;
  selection: CanvasSelection;
  draggedPlacementId?: string | null;
  draggedDescriptionId?: string | null;
}): FolderDropDirectSelection => {
  const useSelection =
    (draggedPlacementId !== null &&
      selection.imagePlacementIds.includes(draggedPlacementId)) ||
    (draggedDescriptionId !== null &&
      selection.descriptionIds.includes(draggedDescriptionId));
  const placementIds = useSelection
    ? selection.imagePlacementIds
    : draggedPlacementId
      ? [draggedPlacementId]
      : [];
  const descriptionIds = useSelection
    ? selection.descriptionIds
    : draggedDescriptionId
      ? [draggedDescriptionId]
      : [];
  return {
    imageIds: [
      ...new Set(
        placementIds.flatMap((placementId) => {
          const placement = business.imagePlacements[placementId];
          const image = placement
            ? business.imageAssets[placement.imageId]
            : null;
          return placement &&
            image &&
            (placement.folderId ?? business.rootFolderId) ===
              business.rootFolderId &&
            (image.folderId ?? business.rootFolderId) === business.rootFolderId
            ? [image.id]
            : [];
        }),
      ),
    ],
    descriptionIds: [
      ...new Set(
        descriptionIds.filter((descriptionId) => {
          const description = business.descriptions[descriptionId];
          return (
            description &&
            (description.folderId ?? business.rootFolderId) ===
              business.rootFolderId
          );
        }),
      ),
    ],
  };
};

const isFocusedCanvasContext = (
  context: PreparedCodexContext,
): context is FocusedCanvasContext =>
  context.format === "ai-canvas-focused-context";

const isViewportVisibleElement = (
  element: ExcalidrawElement,
  viewportBounds: readonly [number, number, number, number],
): boolean =>
  !element.isDeleted &&
  elementPartiallyOverlapsWithOrContainsBBox(
    element as NonDeleted<ExcalidrawElement>,
    viewportBounds,
  );

interface FloatingPanelDrag {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

const asSceneElements = (
  elements: readonly ExcalidrawElement[],
): readonly SceneElementLike[] =>
  elements as unknown as readonly SceneElementLike[];

const formatNumber = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "未测";

const selectedByKind = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  kind: "image",
): ExcalidrawElement | null =>
  elements.find(
    (element) =>
      appState.selectedElementIds[element.id] &&
      element.customData?.kind === kind &&
      !element.isDeleted,
  ) ?? null;

const annotationElementKinds = new Set([
  "region",
  "annotation",
  "annotation-card",
  "annotation-leader",
]);

const associatedRegionId = (element: ExcalidrawElement): string | null => {
  if (
    !annotationElementKinds.has(String(element.customData?.kind)) ||
    typeof element.customData?.regionId !== "string"
  ) {
    return null;
  }
  return element.customData.regionId;
};

const bubbleIdOf = (element: ExcalidrawElement): string | null =>
  (element.customData?.bubbleVisualStyle === BUBBLE_REFERENCE_STYLE_VERSION ||
    element.customData?.bubbleVisualStyle ===
      BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION ||
    element.customData?.bubbleVisualStyle ===
      BUBBLE_LEGACY_REFERENCE_STYLE_VERSION) &&
  typeof element.customData?.bubbleId === "string"
    ? element.customData.bubbleId
    : null;

const selectedBubbleAnnotationFromElements = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
): SelectedBubbleAnnotation | null => {
  const selectedBubbleElement = elements.find(
    (element) =>
      !element.isDeleted &&
      selectedElementIds[element.id] &&
      bubbleIdOf(element) !== null,
  );
  const bubbleId = selectedBubbleElement
    ? bubbleIdOf(selectedBubbleElement)
    : null;
  if (!bubbleId) {
    return null;
  }
  const leader = elements.find(
    (element) =>
      !element.isDeleted &&
      element.customData?.kind === BUBBLE_LEADER_KIND &&
      bubbleIdOf(element) === bubbleId,
  );
  const regionId =
    typeof leader?.customData?.targetRegionId === "string"
      ? leader.customData.targetRegionId
      : null;
  const text = elements.find(
    (element): element is Ordered<ExcalidrawTextElement> =>
      !element.isDeleted &&
      element.type === "text" &&
      element.customData?.kind === BUBBLE_TEXT_KIND &&
      bubbleIdOf(element) === bubbleId,
  );
  if (!text) {
    return null;
  }
  return {
    bubbleId,
    regionId,
    text:
      text.customData?.placeholder === "true" &&
      text.text === BUBBLE_CARD_PLACEHOLDER
        ? ""
        : text.text,
  };
};

const annotationBounds = (
  element: Pick<
    ExcalidrawElement,
    "x" | "y" | "width" | "height" | "angle"
  >,
): AnnotationCardBounds => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  angle: element.angle,
});

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      "button, a, input, textarea, select, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [contenteditable='true'], [contenteditable='plaintext-only']",
    ),
  );
};

const isTextEntryKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [role='textbox'], [contenteditable='true'], [contenteditable='plaintext-only']",
    ),
  );
};

const isSelectedDescriptionKeyboardTarget = (
  target: EventTarget | null,
  selection: CanvasSelection,
): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const button = target.closest<HTMLButtonElement>(
    "button[data-canvas-object='description']",
  );
  const descriptionId = button?.dataset.descriptionId;
  return Boolean(
    descriptionId && selection.descriptionIds.includes(descriptionId),
  );
};

const isAnnotationCardPart = (
  element: ExcalidrawElement,
  regionId: string,
): boolean =>
  associatedRegionId(element) === regionId &&
  element.customData?.kind !== "region";

const updateAnnotationSelectionPresentation = (
  element: ExcalidrawElement,
  _activeRegionId: string | null,
): ExcalidrawElement => {
  const regionId = associatedRegionId(element);
  const kind = element.customData?.kind;
  if (!regionId || !kind) {
    return element;
  }

  if (kind === "annotation-card" && element.type === "rectangle") {
    if (
      element.strokeWidth === 2 &&
      element.roundness?.type === ANNOTATION_CARD_ROUNDNESS.type
    ) {
      return element;
    }
    return newElementWith(element, {
      strokeWidth: 2,
      roundness: ANNOTATION_CARD_ROUNDNESS,
    });
  }

  if (kind === "annotation" && element.type === "text") {
    if (element.fontFamily === ANNOTATION_CARD_FONT_FAMILY) {
      return element;
    }
    return newElementWith(element, {
      fontFamily: ANNOTATION_CARD_FONT_FAMILY,
    });
  }
  return element;
};

const synchronizeAnnotationCardElements = (
  elements: readonly ExcalidrawElement[],
  activeRegionId: string | null,
): readonly ExcalidrawElement[] => {
  const regions = new Map<string, ExcalidrawElement>();
  const cards = new Map<string, ExcalidrawElement>();

  elements.forEach((element) => {
    if (element.isDeleted) {
      return;
    }
    const regionId = associatedRegionId(element);
    if (!regionId) {
      return;
    }
    if (element.customData?.kind === "region") {
      regions.set(regionId, element);
    } else if (element.customData?.kind === "annotation-card") {
      cards.set(regionId, element);
    }
  });

  return elements.map((element) => {
    const regionId = associatedRegionId(element);
    const region = regionId ? regions.get(regionId) : null;
    const card = regionId ? cards.get(regionId) : null;
    let next = updateAnnotationSelectionPresentation(element, activeRegionId);
    const groupIds = normalizeAnnotationCardGroupIds({
      kind: next.customData?.kind,
      annotationId: next.customData?.annotationId,
      groupIds: next.groupIds,
    });
    if (groupIds !== next.groupIds) {
      next = newElementWith(next, {
        groupIds,
      });
    }

    if (!region || !card || !regionId) {
      return next;
    }

    if (element.customData?.kind === "annotation-leader") {
      const anchors =
        element.customData?.annotationMode === "manual" &&
        isManualAnnotationLeaderAnchors(
          element.customData.manualLeaderAnchors,
        )
          ? element.customData.manualLeaderAnchors
          : null;
      const layout = anchors
        ? getAnnotationLeaderLayoutFromEdgeAnchors(
            annotationBounds(region),
            annotationBounds(card),
            anchors.card,
            anchors.selection,
          )
        : getAnnotationLeaderLayout(
            annotationBounds(region),
            annotationBounds(card),
          );
      const end = layout.points[1];
      const currentEnd = "points" in next ? next.points[1] : null;
      if (
        next.x !== layout.x ||
        next.y !== layout.y ||
        !currentEnd ||
        currentEnd[0] !== end[0] ||
        currentEnd[1] !== end[1]
      ) {
        next = newElementWith(next, layout);
      }
    }
    return next;
  });
};

const sceneElementsChanged = (
  current: readonly ExcalidrawElement[],
  next: readonly ExcalidrawElement[],
): boolean =>
  current.length !== next.length ||
  current.some((element, index) => {
    const nextElement = next[index];
    return (
      element !== nextElement &&
      JSON.stringify(element) !== JSON.stringify(nextElement)
    );
  });

const viewportRectsOverlap = (
  left: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  right: Readonly<{ left: number; top: number; right: number; bottom: number }>,
): boolean =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

const cloneGlobalHistorySnapshot = (
  snapshot: AppGlobalHistorySnapshot,
): AppGlobalHistorySnapshot => structuredClone(snapshot);

const globalHistorySnapshotsEqual = (
  left: AppGlobalHistorySnapshot,
  right: AppGlobalHistorySnapshot,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const cloneGlobalHistoryScene = (
  scene: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => structuredClone(scene);

const globalHistoryScenesEqual = (
  left: readonly ExcalidrawElement[],
  right: readonly ExcalidrawElement[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const App = () => {
  const [canvasContext, setCanvasContext] = useState<{
    target: CanvasContextTarget; clientPoint: { x: number; y: number }; scenePoint: { x: number; y: number }; folderId: string;
  } | null>(null);
  const closeCanvasContext = useCallback(() => setCanvasContext(null), []);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [canvasSessionKey, setCanvasSessionKey] = useState(0);
  const [isCanvasHelpOpen, setIsCanvasHelpOpen] = useState(false);
  const [isShortcutManagerOpen, setIsShortcutManagerOpen] = useState(false);
  const [shortcutCaptureId, setShortcutCaptureId] =
    useState<CanvasShortcutId | null>(null);
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null);
  const [isSelectionToolMenuOpen, setIsSelectionToolMenuOpen] = useState(false);
  const [lastSelectionTool, setLastSelectionTool] =
    useState<SelectionKind>("rectangle");
  const [pendingProjectOpen, setPendingProjectOpen] =
    useState<PendingProjectOpen | null>(null);
  const [business, setBusiness] = useState<BusinessState>(() =>
    createEmptyBusinessState(nativeDocumentIdentity()?.documentId),
  );
  const documentSaveRef = useRef(createDocumentSaveState(nativeDocumentIdentity()?.documentId ?? business.document.id));
  const documentFingerprintRef = useRef(createDocumentFingerprint());
  const documentBaselineReadyRef = useRef(false);
  const [hostPresentation, setHostPresentation] = useState<HostDocumentPresentation>(
    nativeDocumentIdentity()?.presentation === "lightweight" ? "lightweight" : "normal",
  );
  const documentUserEpochRef = useRef(0);
  const pendingSavedRestoreRef = useRef<{
    requestId: string; userEpoch: number; expected: Parameters<typeof restoredDocumentReady>[1];
  } | null>(null);
  const finishSavedRestoreRef = useRef<(bundle: P0Bundle) => boolean>(() => false);
  const nativeCloseStateRef = useRef<() => { revision: number; dirty: boolean } | undefined>(() => undefined);
  const nativeSaveActionRef = useRef<(saveAs?: boolean) => Promise<DocumentSaveResult>>(async () => ({
    documentId: documentSaveRef.current.documentId, requestId: "", revision: documentSaveRef.current.revision, status: "failed",
  }));
  const hasCanvasImages = Object.keys(business.imageAssets).length > 0;
  const businessRef = useRef(business);
  const [folderNavigation, setFolderNavigation] =
    useState<FolderNavigationState>({
      layer: "overview",
      selectedFolderId: null,
    });
  const folderNavigationRef = useRef(folderNavigation);
  const [folderPreviewMotion, setFolderPreviewMotion] =
    useState<FolderPreviewMotion | null>(null);
  const folderPreviewMotionRef = useRef<FolderPreviewMotion | null>(null);
  const [folderPreviewClosing, setFolderPreviewClosing] = useState(false);
  const folderPreviewClosingRef = useRef(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedCanvasImageId, setSelectedCanvasImageId] = useState<string | null>(
    null,
  );
  const [focusImageIds, setFocusImageIds] = useState<string[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [activeDescriptionId, setActiveDescriptionId] = useState<string | null>(
    null,
  );
  const [descriptionEditorFocusId, setDescriptionEditorFocusId] = useState<
    string | null
  >(null);
  const [isDescriptionToolActive, setIsDescriptionToolActive] = useState(false);
  const [isQuickAnnotationToolActive, setIsQuickAnnotationToolActive] =
    useState(false);
  const [selectedQuickAnnotationId, setSelectedQuickAnnotationId] = useState<
    string | null
  >(null);
  const [isDescriptionWorkspaceOpen, setIsDescriptionWorkspaceOpen] =
    useState(false);
  const [hasDescriptionEditorContentUnderlay, setHasDescriptionEditorContentUnderlay] =
    useState(false);
  const [hasSelectionToolContentUnderlay, setHasSelectionToolContentUnderlay] =
    useState(false);
  const [hasCanvasMenuContentUnderlay, setHasCanvasMenuContentUnderlay] =
    useState(false);
  const [hasCanvasViewControlsContentUnderlay, setHasCanvasViewControlsContentUnderlay] =
    useState(false);
  const [selectedBubbleAnnotation, setSelectedBubbleAnnotation] = useState<
    SelectedBubbleAnnotation | null
  >(null);
  const [selectedOrdinaryRectangle, setSelectedOrdinaryRectangle] =
    useState(false);
  const [activeSelectionTool, setActiveSelectionTool] =
    useState<SelectionKind | null>(null);
  const [activeSelectionImageId, setActiveSelectionImageId] =
    useState<string | null>(null);
  const [isBubbleToolActive, setIsBubbleToolActive] = useState(false);
  const [manualAnnotationStage, setManualAnnotationStage] = useState<
    "idle" | PendingManualAnnotation["stage"]
  >("idle");
  const [annotationText, setAnnotationText] = useState("");
  const [mockAnswer, setMockAnswer] = useState(
    "本地模拟：建议降低色彩饱和度，并使用暖灰或亚麻色材质与浅色原木协调。",
  );
  const [corsUrl, setCorsUrl] = useState("");
  const [status, setStatus] = useState("等待导入本地图片。");
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(
    null,
  );
  const [folderDropImagePreviews, setFolderDropImagePreviews] = useState<
    readonly FolderDropImagePreview[]
  >([]);
  const [folderDropSuccessId, setFolderDropSuccessId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [businessNotice, setBusinessNotice] = useState<CanvasBusinessNoticeData | null>(null);
  const businessNoticeRef = useRef<CanvasBusinessNoticeData | null>(null);
  const businessNoticeResolveRef = useRef<((accepted: boolean, value?: string) => void) | null>(null);
  const clipboardBusyRef = useRef(false);
  const clipboardPointRef = useRef<Readonly<{x:number;y:number}> | null>(null);
  const clipboardPastePortRef = useRef<((text:string,files:readonly File[])=>Promise<void>) | null>(null);
  const showBusinessNotice = useCallback((notice: CanvasBusinessNoticeData) => new Promise<boolean>(resolve => {
    businessNoticeResolveRef.current?.(false);
    businessNoticeResolveRef.current=resolve;businessNoticeRef.current=notice;setBusinessNotice(notice);
  }),[]);
  const showBusinessNamePrompt = useCallback((title: string, label: string, initialValue: string) => new Promise<string | null>(resolve => {
    businessNoticeResolveRef.current?.(false);
    const notice: CanvasBusinessNoticeData = { title, message: "修改名称不会改变其中的内容或关联。", input: {label, initialValue}, confirmLabel: "重命名", cancelLabel: "取消" };
    businessNoticeResolveRef.current = (accepted, value) => resolve(accepted ? value ?? null : null);
    businessNoticeRef.current = notice; setBusinessNotice(notice);
  }), []);
  const closeBusinessNotice = useCallback((accepted: boolean, value?: string) => {
    const resolve=businessNoticeResolveRef.current;
    businessNoticeResolveRef.current=null;businessNoticeRef.current=null;setBusinessNotice(null);resolve?.(accepted, value);
  },[]);
  useEffect(()=>()=>{businessNoticeResolveRef.current?.(false);businessNoticeResolveRef.current=null;},[]);
  const [benchmark, setBenchmark] =
    useState<PerformanceBenchmarkResult | null>(null);
  const [assetValidation, setAssetValidation] =
    useState<AssetValidationResult | null>(null);
  const [codexContext, setCodexContext] =
    useState<PreparedCodexContext | null>(null);
  const [workbenchPreferences, setWorkbenchPreferences] = useState(() =>
    loadWorkbenchPreferences(),
  );
  const lastLightCanvasThemeRef = useRef<LightCanvasThemeId>("white");
  const initialCanvasDataRef = useRef({
    appState: {
      gridModeEnabled: workbenchPreferences.gridVisible,
      ...canvasThemeAppState(workbenchPreferences.canvasTheme),
    },
  });
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>({
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    offsetLeft: 0,
    offsetTop: 0,
  });
  const benchmarkRef = useRef<PerformanceBenchmarkResult | null>(null);
  const pendingRegionRef = useRef<PendingRegion | null>(null);
  const pathDraftUndoRef = useRef<(() => number | null) | null>(null);
  const pendingManualAnnotationRef = useRef<PendingManualAnnotation | null>(null);
  const pendingOrdinaryTextBoxRef = useRef<Set<string> | null>(null);
  const pendingBubbleRef = useRef(false);
  const floatingPanelDragRef = useRef<FloatingPanelDrag | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const canvasShortcutActionRef = useRef<(shortcut: CanvasShortcutId) => void>(
    () => undefined,
  );
  const canvasPanelRef = useRef<HTMLElement | null>(null);
  const canvasViewControlsRef = useRef<HTMLDivElement | null>(null);
  const latestElementsRef = useRef<readonly ExcalidrawElement[]>([]);
  const latestFilesRef = useRef<BinaryFiles>({});
  const folderProjectionRef = useRef<FolderSceneProjection | null>(null);
  const folderDropTargetIdRef = useRef<string | null>(null);
  const folderDropImagePreviewFrameRef = useRef<number | null>(null);
  const nativeFolderDropGestureRef = useRef<NativeFolderDropGesture | null>(null);
  const mixedDescriptionDragRef = useRef<MixedDescriptionDragGesture | null>(
    null,
  );
  const folderParentViewportRef = useRef<CanvasViewport | null>(null);
  // Folder detail viewports are session-local presentation state. Keep them
  // outside business data so returning to a Folder restores the user's last
  // pan/zoom without changing persisted scene semantics.
  const folderViewportRef = useRef<Record<string, CanvasViewport>>({});
  const pendingFolderViewportRestoreRef = useRef<{
    folderId: string;
    viewport: CanvasViewport;
  } | null>(null);
  const folderDetailParentViewportRef = useRef<CanvasViewport | null>(null);
  const focusedImageFitCancelRef = useRef<(() => void) | null>(null);
  const interactionRuntime = useCanvasInteractionRuntime<
    BusinessState,
    readonly ExcalidrawElement[]
  >({
    cloneSnapshot: cloneGlobalHistorySnapshot,
    snapshotsEqual: globalHistorySnapshotsEqual,
    cloneScene: cloneGlobalHistoryScene,
    scenesEqual: globalHistoryScenesEqual,
  });
  const {
    canvasSelection,
    canvasSelectionRef,
    updateCanvasSelection,
    isCanvasMenuOpen,
    setIsCanvasMenuOpen,
    applyCanvasMenuAction,
    canvasPointerSessionRef,
    canvasMarqueeRect,
    setCanvasMarqueeRect,
    globalHistoryRef,
    pendingGlobalHistoryCommitRef,
    globalHistoryReplayGateRef,
    nativeHistoryGestureBarrierRef,
    globalHistoryScenePreviewRef,
  } = interactionRuntime;
  const canvasHistoryRuntime = useMemo(
    () => createCanvasHistoryRuntime({
      globalHistoryRef,
      pendingGlobalHistoryCommitRef,
      globalHistoryReplayGateRef,
      nativeHistoryGestureBarrierRef,
      globalHistoryScenePreviewRef,
    }),
    [
      globalHistoryRef,
      pendingGlobalHistoryCommitRef,
      globalHistoryReplayGateRef,
      nativeHistoryGestureBarrierRef,
      globalHistoryScenePreviewRef,
    ],
  );
  const canvasPointerRuntime = useMemo(
    () => createCanvasPointerRuntime({ canvasPointerSessionRef, updateCanvasSelection }),
    [canvasPointerSessionRef, updateCanvasSelection],
  );
  const historyApplyRef = useRef<(snapshot: AppGlobalHistorySnapshot) => void>(
    () => undefined,
  );

  useEffect(() => {
    folderNavigationRef.current = folderNavigation;
  }, [folderNavigation]);

  useEffect(() => {
    const panel = canvasPanelRef.current;
    if (!panel) return;
    return attachFolderPreviewWheelGuard(
      panel,
      () => folderNavigationRef.current.layer === "preview",
    );
  }, []);

  const clearFolderPreviewMotion = useCallback(() => {
    folderPreviewClosingRef.current = false;
    setFolderPreviewClosing(false);
    folderPreviewMotionRef.current = null;
    setFolderPreviewMotion(null);
  }, []);

  const requestFolderPreviewClose = useCallback(() => {
    if (folderNavigationRef.current.layer !== "preview") return;
    folderPreviewClosingRef.current = true;
    setFolderPreviewClosing(true);
  }, []);

  const reopenFolderPreview = useCallback(() => {
    folderPreviewClosingRef.current = false;
    setFolderPreviewClosing(false);
  }, []);

  const finishFolderPreviewClose = useCallback(() => {
    if (!folderPreviewClosingRef.current || folderNavigationRef.current.layer !== "preview") return;
    clearFolderPreviewMotion();
    const next: FolderNavigationState = { layer: "overview", selectedFolderId: null };
    folderNavigationRef.current = next;
    setFolderNavigation(next);
    setStatus("已退出文件夹局部预览。");
  }, [clearFolderPreviewMotion]);

  useEffect(() => {
    if (folderNavigation.layer === "overview") return;
    setWorkbenchPreferences((current) =>
      current.contextPanelOpen
        ? { ...current, contextPanelOpen: false }
        : current,
    );
  }, [folderNavigation.layer]);

  const captureGlobalHistorySnapshot = useCallback(
    (): AppGlobalHistorySnapshot => ({
      business: businessRef.current,
      scene: latestElementsRef.current,
      selection: canvasSelectionRef.current,
    }),
    [],
  );

  const historyController = useMemo(
    () =>
      createCanvasHistoryController(canvasHistoryRuntime, {
        capture: captureGlobalHistorySnapshot,
        apply: (snapshot) => historyApplyRef.current(snapshot),
        setStatus,
        schedule: (callback) => window.setTimeout(callback, 0),
        cancelSchedule: (timer) => window.clearTimeout(timer),
      }),
    [canvasHistoryRuntime, captureGlobalHistorySnapshot],
  );
  const queueGlobalHistoryCommit = useCallback(
    (source: GlobalHistorySource, operation: string) =>
      historyController.queue(source, operation),
    [historyController],
  );

  const commitBusiness = useCallback(
    (
      nextOrUpdater: BusinessState | ((state: BusinessState) => BusinessState),
      historyOperation = "host-business",
      recordHistory = true,
    ) => {
      const next =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(businessRef.current)
          : nextOrUpdater;
      const normalized = migrateBusinessStateToV2(
        normalizeDescriptionBusinessState(next),
      );
      if (
        recordHistory &&
        JSON.stringify(normalized) !== JSON.stringify(businessRef.current)
      ) {
        queueGlobalHistoryCommit("host", historyOperation);
      }
      businessRef.current = normalized;
      setBusiness(normalized);
    },
    [queueGlobalHistoryCommit],
  );

  const renderCanonicalScene = useCallback(
    ({
      canonical,
      ownerState = businessRef.current,
      appState,
      captureUpdate = CaptureUpdateAction.NEVER,
    }: {
      canonical: readonly ExcalidrawElement[];
      ownerState?: BusinessState;
      appState?: Partial<AppState>;
      captureUpdate?: UpdateScenePayload["captureUpdate"];
    }) => {
      if (!api) return;
      const scopedBusiness = migrateBusinessStateToV2(ownerState);
      const currentElements = api.getSceneElementsIncludingDeleted();
      const previewNavigation = folderNavigationRef.current;
      const previewAppState = api.getAppState();
      const previewPanel = canvasPanelRef.current;
      const previewViewport: FolderPreviewViewport | undefined =
        previewNavigation.layer === "preview"
          ? {
              width: previewPanel?.clientWidth ?? window.innerWidth,
              height: previewPanel?.clientHeight ?? window.innerHeight,
              zoom: previewAppState.zoom.value,
              scrollX: previewAppState.scrollX,
              scrollY: previewAppState.scrollY,
              offsetLeft: previewAppState.offsetLeft,
              offsetTop: previewAppState.offsetTop,
            }
          : undefined;
      const projection = stabilizeFolderProjectionRuntimeMetadata(
        projectFolderScene(
          canonical,
          scopedBusiness,
          folderProjectionMode(
            previewNavigation,
            previewViewport,
            undefined,
            folderPreviewMotionRef.current?.folderId ===
              previewNavigation.selectedFolderId
              ? folderPreviewMotionRef.current.imageIds
              : undefined,
          ),
        ),
        currentElements,
      );
      const currentById = new Map(
        currentElements.map((element) => [element.id, element]),
      );
      const transientIds = new Set(projection.projectedElementIds);
      const renderedElements = projection.elements.map((element) => {
        const current = currentById.get(element.id);
        const presentationChanged =
          current &&
          (current.opacity !== element.opacity ||
            current.locked !== element.locked ||
            current.isDeleted !== element.isDeleted);
        // Excalidraw owns and may replace or mutate the objects handed to it
        // during a native gesture. Keep the canonical objects detached from
        // that renderer boundary so the next frame still has a real baseline.
        if (!presentationChanged) {
          return { ...element } as ExcalidrawElement;
        }
        transientIds.add(element.id);
        const versionBump = newElementWith(
          current,
          {
            opacity: element.opacity,
            locked: element.locked,
            isDeleted: element.isDeleted,
          },
          true,
        );
        return {
          ...element,
          version: versionBump.version,
          versionNonce: versionBump.versionNonce,
          updated: versionBump.updated,
        } as ExcalidrawElement;
      });
      const renderedProjection = {
        ...projection,
        elements: renderedElements,
        projectedElementIds: transientIds,
      };
      folderProjectionRef.current = renderedProjection;
      api.updateScene({
        elements: renderedElements,
        ...(appState
          ? { appState: appState as UpdateScenePayload["appState"] }
          : {}),
        captureUpdate,
      });
    },
    [api],
  );

  const updateFolderDropTarget = useCallback((folderId: string | null) => {
    if (folderDropTargetIdRef.current === folderId) return;
    folderDropTargetIdRef.current = folderId;
    setFolderDropTargetId(folderId);
  }, []);

  const bringSelectedImageToFront = useCallback(
    (imageId: string) => {
      if (!api) return;
      const layer = folderNavigationRef.current.layer;
      if (layer !== "overview" && layer !== "folder") return;
      const current = latestElementsRef.current;
      const next = bringImageLayerGroupToFront(current, imageId);
      if (next === current) return;
      latestElementsRef.current = next;
      renderCanonicalScene({ canonical: next, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [api, renderCanonicalScene],
  );

  const clearFolderDropImagePreviews = useCallback(() => {
    if (folderDropImagePreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(folderDropImagePreviewFrameRef.current);
      folderDropImagePreviewFrameRef.current = null;
    }
    setFolderDropImagePreviews([]);
  }, []);

  const scheduleFolderDropImagePreviews = useCallback(
    (targetFolderId: string | null, draggedPlacementId: string | null) => {
      if (!api || !targetFolderId) {
        clearFolderDropImagePreviews();
        return;
      }
      if (folderDropImagePreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(folderDropImagePreviewFrameRef.current);
      }
      folderDropImagePreviewFrameRef.current = window.requestAnimationFrame(() => {
        folderDropImagePreviewFrameRef.current = null;
        const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
        const selectedPlacementIds = draggedPlacementId
          ? canvasSelectionRef.current.imagePlacementIds.includes(draggedPlacementId)
            ? canvasSelectionRef.current.imagePlacementIds
            : [draggedPlacementId]
          : canvasSelectionRef.current.imagePlacementIds;
        const elements = api.getSceneElements();
        const files = api.getFiles();
        const previews = selectedPlacementIds.flatMap((placementId) => {
          const placement = scopedBusiness.imagePlacements[placementId];
          if (
            !placement?.active ||
            (placement.folderId ?? scopedBusiness.rootFolderId) !==
              scopedBusiness.rootFolderId
          ) {
            return [];
          }
          const element = elements.find(
            (candidate) =>
              !candidate.isDeleted &&
              candidate.type === "image" &&
              candidate.customData?.placementId === placementId,
          );
          if (!element || element.type !== "image" || !element.fileId) return [];
          const imageUrl = files[element.fileId]?.dataURL;
          if (!imageUrl) return [];
          return [
            {
              id: placementId,
              imageUrl,
              bounds: {
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
              },
              angle: element.angle,
              scaleX: element.scale[0],
              scaleY: element.scale[1],
              opacity: element.opacity / 100,
            },
          ];
        });
        setFolderDropImagePreviews(previews);
      });
    },
    [api, canvasSelectionRef, clearFolderDropImagePreviews],
  );

  const handleFolderDropTargetChange = useCallback(
    (folderId: string | null, draggedDescriptionId: string | null = null) => {
      updateFolderDropTarget(folderId);
      const draggedPlacementId =
        nativeFolderDropGestureRef.current?.draggedPlacementId ?? null;
      if (
        draggedPlacementId ||
        (draggedDescriptionId &&
          canvasSelectionRef.current.descriptionIds.includes(draggedDescriptionId))
      ) {
        scheduleFolderDropImagePreviews(folderId, draggedPlacementId);
      } else {
        clearFolderDropImagePreviews();
      }
    },
    [
      canvasSelectionRef,
      clearFolderDropImagePreviews,
      scheduleFolderDropImagePreviews,
      updateFolderDropTarget,
    ],
  );

  useEffect(() => {
    if (folderDropSuccessId === null) return undefined;
    const timer = window.setTimeout(() => setFolderDropSuccessId(null), 180);
    return () => window.clearTimeout(timer);
  }, [folderDropSuccessId]);

  useEffect(() => {
    if (folderNavigation.layer !== "overview") {
      nativeFolderDropGestureRef.current = null;
      updateFolderDropTarget(null);
      clearFolderDropImagePreviews();
    }
  }, [
    clearFolderDropImagePreviews,
    folderNavigation.layer,
    updateFolderDropTarget,
  ]);

  const currentFolderDropItems = useCallback((): readonly FolderWorkspaceItem[] => {
    const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
    return Object.values(scopedBusiness.folders).flatMap((folder) => {
      if (folder.kind === "root") return [];
      const bounds = folderSceneBounds(
        scopedBusiness,
        latestElementsRef.current,
        folder.id,
      );
      return bounds
        ? [{ folder, bounds: compactFolderSurfaceBounds(bounds) }]
        : [];
    });
  }, []);

  const folderDropTargetAtClientPoint = useCallback(
    (point: Readonly<{ clientX: number; clientY: number }>): string | null => {
      if (!api || folderNavigationRef.current.layer !== "overview") return null;
      const appState = api.getAppState();
      return folderDropTargetAtViewportPoint(
        point,
        {
          zoom: appState.zoom.value,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          offsetLeft: appState.offsetLeft,
          offsetTop: appState.offsetTop,
        },
        currentFolderDropItems(),
      );
    },
    [api, currentFolderDropItems],
  );

  const discardPendingNativeHistory = useCallback(() => {
    const pending = pendingGlobalHistoryCommitRef.current;
    if (pending?.timer !== null && pending?.timer !== undefined) {
      window.clearTimeout(pending.timer);
    }
    pendingGlobalHistoryCommitRef.current = null;
    historyController.finishNativeGesture(null);
  }, [historyController, pendingGlobalHistoryCommitRef]);

  const applyExistingFolderDrop = useCallback(
    ({
      business,
      elements,
      targetFolderId,
      directSelection,
    }: {
      business: BusinessStateV2;
      elements: readonly ExcalidrawElement[];
      targetFolderId: string;
      directSelection: FolderDropDirectSelection;
    }): readonly ExcalidrawElement[] | null => {
      if (
        directSelection.imageIds.length === 0 &&
        directSelection.descriptionIds.length === 0
      ) {
        setStatus("只有父级画布中的直接图片或说明可以加入文件夹。");
        return null;
      }
      const required = requiredDirectObjectsForReparent({
        business,
        imageIds: directSelection.imageIds,
        descriptionIds: directSelection.descriptionIds,
      });
      if (required.imageIds.length > 0 || required.descriptionIds.length > 0) {
        setStatus(
          `暂未加入：还需同时选择 ${required.imageIds.length} 张关联图片和 ${required.descriptionIds.length} 条关联说明。`,
        );
        return null;
      }
      try {
        const reparented = reparentDirectObjects({
          business,
          targetFolderId,
          imageIds: directSelection.imageIds,
          descriptionIds: directSelection.descriptionIds,
        });
        const synchronized = synchronizeEmptyFolderCovers({
          business: reparented,
          elements: stampSceneFolderOwnership({
            business: reparented,
            elements,
          }),
        });
        queueGlobalHistoryCommit("host", "folder-add-existing");
        latestElementsRef.current = synchronized.elements;
        commitBusiness(synchronized.business, "folder-add-existing", false);
        renderCanonicalScene({
          canonical: synchronized.elements,
          ownerState: synchronized.business,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        updateCanvasSelection(EMPTY_CANVAS_SELECTION);
        setSelectedImageId(null);
        setSelectedCanvasImageId(null);
        setSelectedRegionId(null);
        setActiveDescriptionId(null);
        setDescriptionEditorFocusId(null);
        setIsDescriptionWorkspaceOpen(false);
        setFolderDropSuccessId(targetFolderId);
        setStatus(
          `已加入文件夹：${directSelection.imageIds.length} 张图片、${directSelection.descriptionIds.length} 条说明。`,
        );
        return synchronized.elements;
      } catch (error) {
        setStatus(
          `暂未加入文件夹：${error instanceof Error ? error.message : "关系闭包校验失败"}`,
        );
        return null;
      }
    },
    [commitBusiness, queueGlobalHistoryCommit, renderCanonicalScene, updateCanvasSelection],
  );

  const resolveDescriptionAnchorPlacement = useCallback(
    (anchor: Readonly<{ x: number; y: number }>) => {
      const imageFramesById = new Map<string, DescriptionBindingImageFrame>();
      Object.values(businessRef.current.imagePlacements)
        .filter((placement) => placement.active)
        .forEach((placement, zIndex) => {
          imageFramesById.set(placement.imageId, {
            imageId: placement.imageId,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            angle: placement.angle,
            scale: placement.scale,
            zIndex,
          });
        });
      (api?.getSceneElements() ?? []).forEach((element, zIndex) => {
        if (
          element.type === "image" &&
          !element.isDeleted &&
          typeof element.customData?.imageId === "string"
        ) {
          imageFramesById.set(element.customData.imageId, {
            imageId: element.customData.imageId,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            angle: element.angle,
            scale: element.scale,
            zIndex,
          });
        }
      });
      return bindDescriptionAnchorToImage(anchor, [...imageFramesById.values()]);
    },
    [api],
  );

  const descriptionHost = useMemo(
    () =>
      createDescriptionHostController({
        commitBusiness,
        createId: stableId,
        getBusiness: () => businessRef.current,
        viewportZoom: canvasViewport.zoom,
        resolveAnchorPlacement: resolveDescriptionAnchorPlacement,
        setActiveDescriptionId,
        setEditorFocusDescriptionId: setDescriptionEditorFocusId,
        setDescriptionToolActive: setIsDescriptionToolActive,
        clearCodexContext: () => setCodexContext(null),
        setStatus,
      }),
    [canvasViewport.zoom, commitBusiness, resolveDescriptionAnchorPlacement],
  );

  useEffect(() => {
    descriptionHost.setRuntimePort(
      createDescriptionRuntimeAdapter({
        clearSelection: () => updateCanvasSelection(EMPTY_CANVAS_SELECTION),
        synchronizeTransient: () => historyController.synchronizeTransient(),
        moveStart: () => applyCanvasMenuAction("move-start"),
        flush: () => historyController.flush(),
      }),
    );
    return () => descriptionHost.setRuntimePort({});
  }, [
    applyCanvasMenuAction,
    descriptionHost,
    historyController,
    updateCanvasSelection,
  ]);

  useEffect(() => {
    if (api) {
      historyController.synchronize();
    }
  }, [api, historyController]);

  const nativeSelectionMirror = useMemo(
    () =>
      projectCanvasSelectionToNativeElementIds(
        canvasSelection,
        Object.values(business.imagePlacements),
      ),
    [business.imagePlacements, canvasSelection],
  );

  useEffect(() => {
    if (
      !api ||
      nativeSelectionMirrorsEqual(
        api.getAppState().selectedElementIds,
        nativeSelectionMirror,
      )
    ) {
      return;
    }
    api.updateScene({
      appState: { selectedElementIds: nativeSelectionMirror },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, nativeSelectionMirror]);

  useEffect(() => {
    if (!api) {
      return;
    }
    const theme = canvasThemeAppState(workbenchPreferences.canvasTheme);
    if (pendingSavedRestoreRef.current) {
      Object.assign(pendingSavedRestoreRef.current.expected, theme);
    }
    const current = api.getAppState();
    if (current.theme !== theme.theme || current.viewBackgroundColor !== theme.viewBackgroundColor) {
      api.updateScene({ appState: theme, captureUpdate: CaptureUpdateAction.NEVER });
    }
  }, [api, workbenchPreferences.canvasTheme]);

  const applyGlobalHistorySnapshot = useCallback(
    (snapshot: AppGlobalHistorySnapshot) => {
      globalHistoryReplayGateRef.current.begin(snapshot.scene);
      const restoredBusiness = migrateBusinessStateToV2(snapshot.business);
      businessRef.current = restoredBusiness;
      setBusiness(restoredBusiness);
      latestElementsRef.current = snapshot.scene;
      // History replay restores canonical scene/business state, so any
      // in-flight preview-only motion must be discarded before projecting the
      // restored scene. Otherwise its stale imageIds keep members hidden
      // after the animation layer has already disappeared.
      folderPreviewMotionRef.current = null;
      setFolderPreviewMotion(null);
      updateCanvasSelection(snapshot.selection);
      const selectedPlacementId = snapshot.selection.imagePlacementIds[0] ?? null;
      const selectedPlacement = selectedPlacementId
        ? snapshot.business.imagePlacements[selectedPlacementId]
        : null;
      setSelectedImageId(selectedPlacement?.imageId ?? null);
      setSelectedCanvasImageId(selectedPlacement?.imageId ?? null);
      setSelectedRegionId(snapshot.selection.regionIds[0] ?? null);
      setActiveDescriptionId(snapshot.selection.descriptionIds[0] ?? null);
      setDescriptionEditorFocusId(null);
      setIsDescriptionWorkspaceOpen(false);
      renderCanonicalScene({
        canonical: snapshot.scene,
        ownerState: restoredBusiness,
        appState: {
          selectedElementIds: projectCanvasSelectionToNativeElementIds(
            snapshot.selection,
            Object.values(restoredBusiness.imagePlacements),
          ),
        },
      });
    },
    [renderCanonicalScene, updateCanvasSelection],
  );
  historyApplyRef.current = applyGlobalHistorySnapshot;

  const replayGlobalHistory = useCallback(
    (direction: "undo" | "redo") => {
      historyController.replay(direction);
    },
    [historyController],
  );

  const handleSceneChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const previousElements = latestElementsRef.current;
      const canonicalIncoming = folderProjectionRef.current
        ? deprojectFolderSceneChange(elements, folderProjectionRef.current)
        : elements;
      latestFilesRef.current = files;
      const controlledNativeSelection = projectCanvasSelectionToNativeElementIds(
        canvasSelectionRef.current,
        Object.values(businessRef.current.imagePlacements),
      );
      setWorkbenchPreferences((current) =>
        current.gridVisible === appState.gridModeEnabled
          ? current
          : { ...current, gridVisible: appState.gridModeEnabled },
      );
      if (!isAllowedNativeCanvasTool(appState.activeTool.type, {
        manualAnnotationStage: pendingManualAnnotationRef.current?.stage ?? null,
        ordinaryTextPending: pendingOrdinaryTextBoxRef.current !== null,
      })) {
        api?.setActiveTool({ type: "selection" });
      }
      const imageBoundElements = synchronizeImageBoundSceneElements(
        canonicalIncoming,
        previousElements,
      );
      const selectedAnnotationElement = imageBoundElements.find(
        (element) =>
          controlledNativeSelection[element.id] &&
          !element.isDeleted &&
          associatedRegionId(element),
      );
      const nextSelectedBubbleAnnotation = selectedBubbleAnnotationFromElements(
        imageBoundElements,
        controlledNativeSelection,
      );
      const selectedAnnotationRegionId = selectedAnnotationElement
        ? associatedRegionId(selectedAnnotationElement)
        : nextSelectedBubbleAnnotation?.regionId ?? null;
      const annotationSynchronizedElements = synchronizeAnnotationCardElements(
        imageBoundElements,
        selectedAnnotationRegionId,
      );
      const bubbleSynchronizedElements = synchronizeBubbleAnnotationElements(
        annotationSynchronizedElements,
        controlledNativeSelection,
      );
      let synchronizedElements = synchronizeOrdinaryTextBoxElements(
        bubbleSynchronizedElements,
      );
      if (
        pendingBubbleRef.current &&
        appState.activeTool.type !== "selection"
      ) {
        pendingBubbleRef.current = false;
        setIsBubbleToolActive(false);
      }
      const ordinaryTextBaseline = pendingOrdinaryTextBoxRef.current;
      if (ordinaryTextBaseline) {
        const ordinaryText = synchronizedElements.find(
          (element): element is Ordered<ExcalidrawTextElement> =>
            element.type === "text" &&
            !element.isDeleted &&
            !ordinaryTextBaseline.has(element.id) &&
            !element.customData?.kind &&
            Boolean(element.text.trim()),
        );
        if (ordinaryText) {
          const boxed = createOrdinaryTextBoxElements(ordinaryText);
          synchronizedElements = synchronizedElements.flatMap((element) =>
            element.id === ordinaryText.id
              ? [boxed.frame, boxed.text]
              : [element],
          );
          pendingOrdinaryTextBoxRef.current = null;
        }
      }
      // Detach canonical scene objects from Excalidraw's native scene before
      // storing the next-frame baseline. Native drag frames may reuse their
      // element objects even when the array passed to onChange is new.
      synchronizedElements = synchronizedElements.map(
        (element) => ({ ...element }) as ExcalidrawElement,
      );
      latestElementsRef.current = synchronizedElements;
      const result = reconcileBusinessState(
        businessRef.current,
        asSceneElements(synchronizedElements),
        new Set(Object.keys(files)),
      );
      const nextRegions = { ...result.state.regions };
      const nextRegionIds = [...result.state.document.regionIds];
      synchronizedElements.forEach((element) => {
        if (
          element.isDeleted ||
          element.customData?.kind !== "region" ||
          typeof element.customData.regionId !== "string" ||
          typeof element.customData.imageId !== "string"
        ) {
          return;
        }
        const regionId = element.customData.regionId;
        const imageId = element.customData.imageId;
        const imageElement = synchronizedElements.find(
          (candidate): candidate is ExcalidrawImageElement =>
            !candidate.isDeleted &&
            candidate.type === "image" &&
            candidate.customData?.imageId === imageId,
        );
        const imageAsset = result.state.imageAssets[imageId];
        let geometry = nextRegions[regionId]?.geometry ?? null;
        if (imageElement && imageAsset) {
          try {
            geometry = calculateRegionGeometry(
              {
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
                angle: element.angle,
                scaleX:
                  "scale" in element ? element.scale?.[0] ?? 1 : 1,
                scaleY:
                  "scale" in element ? element.scale?.[1] ?? 1 : 1,
              },
              {
                x: imageElement.x,
                y: imageElement.y,
                width: imageElement.width,
                height: imageElement.height,
                angle: imageElement.angle,
                scaleX: imageElement.scale?.[0] ?? 1,
                scaleY: imageElement.scale?.[1] ?? 1,
                naturalWidth: imageAsset.naturalWidth,
                naturalHeight: imageAsset.naturalHeight,
                crop: imageElement.crop ?? null,
              },
            );
          } catch {
            geometry = null;
          }
        }
        nextRegions[regionId] = {
          ...(nextRegions[regionId] ?? {
            id: regionId,
            imageId,
            elementId: element.id,
            geometry: null,
            active: true,
            status: "invalid" as const,
          }),
          id: regionId,
          imageId,
          elementId: element.id,
          geometry,
          active: true,
          status: geometry ? "valid" : "invalid",
        };
        if (!nextRegionIds.includes(regionId)) {
          nextRegionIds.push(regionId);
        }
      });
      let nextBusinessState: BusinessState = {
        ...result.state,
        document: { ...result.state.document, regionIds: nextRegionIds },
        regions: nextRegions,
        annotations: result.state.annotations,
      };
      const imageFrames = Object.values(nextBusinessState.imagePlacements)
        .filter((placement) => placement.active)
        .map(
          (placement, zIndex) =>
            ({
              imageId: placement.imageId,
              x: placement.x,
              y: placement.y,
              width: placement.width,
              height: placement.height,
              angle: placement.angle,
              scale: placement.scale,
              zIndex,
            }) satisfies DescriptionBindingImageFrame,
        );
      nextBusinessState = reconcileDescriptionImageBindings(
        nextBusinessState,
        imageFrames,
      );
      if (
        nativeHistoryGestureBarrierRef.current.active &&
        canvasSelectionRef.current.descriptionIds.length > 0
      ) {
        const selectedImageIds = canvasSelectionRef.current.imagePlacementIds.flatMap(
          (placementId) => {
            const placement = businessRef.current.imagePlacements[placementId];
            return placement?.active ? [placement.imageId] : [];
          },
        );
        const imageTranslation = resolveUniformImageTranslation(
          previousElements,
          synchronizedElements,
          selectedImageIds,
        );
        if (imageTranslation) {
          nextBusinessState = translateSelectedDescriptionReferences(
            businessRef.current,
            nextBusinessState,
            canvasSelectionRef.current.descriptionIds,
            { x: imageTranslation.dx, y: imageTranslation.dy },
          );
        }
      }
      const businessChanged =
        JSON.stringify(nextBusinessState) !== JSON.stringify(businessRef.current);
      businessRef.current = nextBusinessState;
      if (businessChanged) {
        setBusiness(nextBusinessState);
      }
      historyController.finishSceneChange(previousElements, synchronizedElements);
      if (pendingSavedRestoreRef.current) finishSavedRestoreRef.current({
        format: "ai-canvas-excalidraw-p0", version: 3, savedAt: new Date().toISOString(),
        business: businessRef.current, scene: { elements: latestElementsRef.current, files, appState: sanitizeAppState(appState) },
      });
      setIssues((current) =>
        JSON.stringify(current) === JSON.stringify(result.issues)
          ? current
          : result.issues,
      );
      setCanvasViewport((current) => {
        const next = {
          zoom: appState.zoom.value,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          offsetLeft: appState.offsetLeft,
          offsetTop: appState.offsetTop,
        };
        return current.zoom === next.zoom &&
          current.scrollX === next.scrollX &&
          current.scrollY === next.scrollY &&
          current.offsetLeft === next.offsetLeft &&
          current.offsetTop === next.offsetTop
          ? current
          : next;
      });

      const selectedImage = selectedByKind(
        synchronizedElements,
        { ...appState, selectedElementIds: controlledNativeSelection },
        "image",
      );
      const hasSelectedOrdinaryRectangle = synchronizedElements.some(
        (element) =>
          controlledNativeSelection[element.id] &&
          element.type === "rectangle" &&
          element.customData?.kind !== "region" &&
          element.customData?.kind !== "annotation-card" &&
          element.customData?.kind !== "ordinary-text-box" &&
          element.customData?.kind !== "bubble-card" &&
          element.customData?.kind !== "bubble-shadow" &&
          element.customData?.kind !== "image-shadow" &&
          !element.isDeleted,
      );
      const directlySelectedImageId =
        typeof selectedImage?.customData?.imageId === "string"
          ? selectedImage.customData.imageId
          : null;
      setSelectedCanvasImageId(directlySelectedImageId);
      setSelectedImageId((current) =>
        directlySelectedImageId
          ? directlySelectedImageId
          : selectedAnnotationRegionId
            ? nextBusinessState.regions[selectedAnnotationRegionId]?.imageId ??
              synchronizedElements.find(
                (element) =>
                  element.id ===
                  nextBusinessState.regions[selectedAnnotationRegionId]
                    ?.elementId,
              )?.customData?.imageId ??
              null
            : current && nextBusinessState.imageAssets[current]
              ? current
              : null,
      );
      setSelectedRegionId((current) =>
        current && nextBusinessState.regions[current] ? current : null,
      );
      setSelectedBubbleAnnotation((current) =>
        nextSelectedBubbleAnnotation ?? current,
      );
      setSelectedOrdinaryRectangle(hasSelectedOrdinaryRectangle);

      const projection = stabilizeFolderProjectionRuntimeMetadata(
        projectFolderScene(
          synchronizedElements,
          migrateBusinessStateToV2(nextBusinessState),
          folderProjectionMode(
            folderNavigationRef.current,
            folderNavigationRef.current.layer === "preview"
            ? {
                  width:
                    canvasPanelRef.current?.clientWidth ?? window.innerWidth,
                  height:
                    canvasPanelRef.current?.clientHeight ?? window.innerHeight,
                  zoom: appState.zoom.value,
                  scrollX: appState.scrollX,
                  scrollY: appState.scrollY,
                  offsetLeft: appState.offsetLeft,
                  offsetTop: appState.offsetTop,
                }
              : undefined,
            undefined,
            folderPreviewMotionRef.current?.folderId ===
              folderNavigationRef.current.selectedFolderId
              ? folderPreviewMotionRef.current.imageIds
              : undefined,
          ),
        ),
        elements,
      );
      if (api && sceneElementsChanged(elements, projection.elements)) {
        renderCanonicalScene({
          canonical: synchronizedElements,
          ownerState: nextBusinessState,
        });
      } else {
        folderProjectionRef.current = projection;
      }
    },
    [api, historyController, renderCanonicalScene],
  );

  useLayoutEffect(() => {
    if (!api) return;
    renderCanonicalScene({ canonical: latestElementsRef.current });
    const pendingRestore = pendingFolderViewportRestoreRef.current;
    if (
      pendingRestore &&
      folderNavigation.layer === "folder" &&
      folderNavigation.selectedFolderId === pendingRestore.folderId
    ) {
      pendingFolderViewportRestoreRef.current = null;
      api.updateScene({
        appState: {
          zoom: { value: pendingRestore.viewport.zoom } as AppState["zoom"],
          scrollX: pendingRestore.viewport.scrollX,
          scrollY: pendingRestore.viewport.scrollY,
          offsetLeft: pendingRestore.viewport.offsetLeft,
          offsetTop: pendingRestore.viewport.offsetTop,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, [
    api,
    folderNavigation,
    folderPreviewMotion,
    renderCanonicalScene,
  ]);

  const handleBubbleAnchorChange = useCallback(
    (
      bubbleId: string,
      target: Readonly<{ x: number; y: number }>,
      commit: boolean,
    ) => {
      if (!api) {
        return;
      }
      const elements = api.getSceneElements();
      const retargeted = retargetBubbleAnnotationElements(
        elements,
        bubbleId,
        target,
      );
      if (!sceneElementsChanged(elements, retargeted)) {
        return;
      }
      api.updateScene({
        elements: retargeted,
        captureUpdate: commit
          ? CaptureUpdateAction.IMMEDIATELY
          : CaptureUpdateAction.NEVER,
      });
    },
    [api],
  );

  const handleImportImage = useCallback(
    async (file: File, dropPoint?: Readonly<{ x: number; y: number }>, clipboard?: {loaded: LoadedLocalImage;folderId:string}) => {
      if (!api) {
        return;
      }
      if (!isBridgePublishableImageMimeType(file.type)) {
        setCodexContext(null);
        setStatus(
          `当前导入入口只支持 ${bridgePublishableImageFormatsLabel}；SVG 目前不能导入画布或发布给 Codex。`,
        );
        return;
      }
      setBusy(true);
      try {
        const loaded = clipboard?.loaded ?? await readLocalImage(file);
        const imageId = stableId("image");
        const placementId = stableId("placement");
        const fileId = stableId("file");
        const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
        const ownerId = folderScopeId(
          folderNavigationRef.current,
          scopedBusiness,
        );
        if(clipboard && ownerId!==clipboard.folderId)throw new CanvasClipboardError("invalid","目标位置已变化，尚未粘贴。");
        const canvasBounds = canvasPanelRef.current?.getBoundingClientRect();
        const measuredViewport = resolveMeasuredViewportSize({
          viewportWidth: canvasBounds?.width,
          viewportHeight: canvasBounds?.height,
          fallbackWidth: window.innerWidth,
          fallbackHeight: window.innerHeight,
        });
        const fitted = fitImportedImageToViewport({
          naturalWidth: loaded.width,
          naturalHeight: loaded.height,
          viewportWidth: measuredViewport.width,
          viewportHeight: measuredViewport.height,
        });
        const baseElement = createImageElement({
          fileId,
          imageId,
          placementId,
          x:
            dropPoint?.x ??
            100 + businessRef.current.document.imageAssetIds.length * 36,
          y:
            dropPoint?.y ??
            100 + businessRef.current.document.imageAssetIds.length * 28,
          width: fitted.width,
          height: fitted.height,
        });
        const element = newElementWith(baseElement, {
          customData: {
            ...baseElement.customData,
            folderId: ownerId,
          },
        });
        const binaryFile = createBinaryFileData(fileId, loaded);

        commitBusiness((current) => {
          const currentV2 = migrateBusinessStateToV2(current);
          return {
            ...currentV2,
            document: {
              ...currentV2.document,
              imageAssetIds: appendUnique(
                currentV2.document.imageAssetIds,
                imageId,
              ),
              imagePlacementIds: appendUnique(
                currentV2.document.imagePlacementIds,
                placementId,
              ),
            },
            imageAssets: {
              ...currentV2.imageAssets,
              [imageId]: {
                id: imageId,
                fileId,
                name: file.name,
                mimeType: loaded.mimeType,
                naturalWidth: loaded.width,
                naturalHeight: loaded.height,
                source: "local",
                createdAt: new Date().toISOString(),
                folderId: ownerId,
              },
            },
            imagePlacements: {
              ...currentV2.imagePlacements,
              [placementId]: {
                id: placementId,
                imageId,
                elementId: element.id,
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
                angle: element.angle,
                scale: element.scale,
                crop: element.crop ?? null,
                active: true,
                folderId: ownerId,
              },
            },
            folders: {
              ...currentV2.folders,
              [ownerId]: {
                ...currentV2.folders[ownerId],
                imageAssetIds: appendUnique(
                  currentV2.folders[ownerId].imageAssetIds,
                  imageId,
                ),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }, clipboard ? "粘贴图片" : "host-business");
        updateCanvasSelection(EMPTY_CANVAS_SELECTION);
        setSelectedImageId(null);
        setSelectedCanvasImageId(null);
        api.addFiles([binaryFile]);
        const synchronized = synchronizeEmptyFolderCovers({
          business: migrateBusinessStateToV2(businessRef.current),
          elements: [...latestElementsRef.current, element],
        });
        const importedElements=clipboard?normalizeClipboardSceneOrder(synchronized.elements):synchronized.elements;
        latestElementsRef.current = importedElements;
        commitBusiness(synchronized.business, "image-import", false);
        renderCanonicalScene({
          canonical: importedElements,
          ownerState: synchronized.business,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setStatus(
          `已导入 ${file.name}（${loaded.width} × ${loaded.height}）。`,
        );
      } catch (error) {
        if(clipboard)throw error;
        setStatus(
          `导入失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
      } finally {
        if (!clipboard) setBusy(false); // The outer clipboard batch owns its input barrier.
      }
    },
    [api, commitBusiness, renderCanonicalScene, updateCanvasSelection],
  );

  const clipboardTarget = useCallback((target: EventTarget | null) => {
    if(businessNoticeRef.current || isTextEntryKeyboardTarget(target))return false;
    return target===document.body || target===document.documentElement || (target instanceof Node && !!canvasPanelRef.current?.contains(target));
  },[]);

  const clipboardSelection = useCallback(():CanvasClipboardSelection=>{
    const navigation=folderNavigationRef.current;
    if(navigation.layer==="preview")return {folderIds:[navigation.selectedFolderId]};
    return {...canvasSelectionRef.current,quickAnnotationIds:selectedQuickAnnotationId?[selectedQuickAnnotationId]:[]};
  },[selectedQuickAnnotationId]);

  const explainClipboardFailure = useCallback((error:unknown,title:string)=>{
    const known=error instanceof CanvasClipboardError;
    const missing=known && error.missingImageIds.length
      ? "\n"+error.missingImageIds.slice(0,5).map(id=>businessRef.current.imageAssets[id]?.name??"关联图片").join("、")
      : "";
    void showBusinessNotice({title,message:(known?error.message:"剪贴板操作未完成，请重试。")+missing});
  },[showBusinessNotice]);

  const copyCanvasContent = useCallback(async(event?:ClipboardEvent,explicit?:CanvasClipboardSelection)=>{
    event?.preventDefault();event?.stopImmediatePropagation();
    if(!api || busy || clipboardBusyRef.current || pendingSavedRestoreRef.current || businessNoticeRef.current){setStatus("画布正在处理操作，尚未复制。");return;}
    try{
      const content=createCanvasClipboard(migrateBusinessStateToV2(businessRef.current),latestElementsRef.current,api.getFiles(),explicit??clipboardSelection());
      clipboardBusyRef.current=true;
      await writeCanvasClipboard(content,event);
      setStatus("已复制选中内容及其关联，可粘贴到其他画布标签。");
    }catch(error){explainClipboardFailure(error,"尚未复制");}
    finally{clipboardBusyRef.current=false;}
  },[api,busy,clipboardSelection,explainClipboardFailure]);

  const pasteCanvasContent = useCallback(async(text:string,imageFiles:readonly File[], placement?:{point:{x:number;y:number};folderId:string})=>{
    if(!api || busy || clipboardBusyRef.current || pendingSavedRestoreRef.current || businessNoticeRef.current){setStatus("画布正在处理操作，尚未粘贴。");return;}
    const navigation=folderNavigationRef.current;
    if(navigation.layer!=="overview" && navigation.layer!=="folder"){
      void showBusinessNotice({title:"请选择粘贴位置",message:"请先回到主画布，或打开目标文件夹后再粘贴。"});return;
    }
    const ownerId=folderScopeId(navigation,migrateBusinessStateToV2(businessRef.current));
    if (placement && placement.folderId !== ownerId) {
      void showBusinessNotice({title:"尚未粘贴",message:"目标画布层级已经改变，请重新选择粘贴位置。"});return;
    }
    const bounds=canvasPanelRef.current?.getBoundingClientRect();
    const point=placement?.point??clipboardPointRef.current??viewportCoordsToSceneCoords({clientX:(bounds?.left??0)+(bounds?.width??window.innerWidth)/2,clientY:(bounds?.top??0)+(bounds?.height??window.innerHeight)/2},api.getAppState());
    let before:AppGlobalHistorySnapshot|null=null;
    let writeStarted=false;
    clipboardBusyRef.current=true;setBusy(true);
    try{
      const content=decodeCanvasClipboard(text);
      if(!content && imageFiles.length===0)throw new CanvasClipboardError("invalid",text.trim()?"画布不直接粘贴独立文字。请在说明输入框中粘贴文字。":"剪贴板中没有可粘贴的图片或画布内容。");
      if(imageFiles.some(file=>!isBridgePublishableImageMimeType(file.type)))throw new CanvasClipboardError("invalid",`仅支持粘贴 ${bridgePublishableImageFormatsLabel} 图片。`);
      const loaded=content?[]:await Promise.all(imageFiles.map(file=>readLocalImage(file)));
      if(folderScopeId(folderNavigationRef.current,migrateBusinessStateToV2(businessRef.current))!==ownerId || canvasPointerSessionRef.current.kind!=="idle" || nativeHistoryGestureBarrierRef.current.active)throw new CanvasClipboardError("invalid","画布正在变化，尚未粘贴。请结束当前操作后重试。");
      historyController.flush();
      before=structuredClone(captureGlobalHistorySnapshot());
      if(content){
        const currentFiles=api.getFiles();
        const prepared=prepareCanvasPaste(content,{business:migrateBusinessStateToV2(businessRef.current),elements:latestElementsRef.current,files:currentFiles,folderId:ownerId},point,stableId);
        writeStarted=true;
        queueGlobalHistoryCommit("host","粘贴内容");
        api.addFiles(Object.entries(prepared.files).filter(([id])=>!currentFiles[id]).map(([,file])=>file));
        latestFilesRef.current=prepared.files;latestElementsRef.current=prepared.elements;
        commitBusiness(prepared.business,"粘贴内容",false);
        const selected={
          imagePlacementIds:prepared.added.imagePlacementIds.filter(id=>prepared.business.imagePlacements[id].folderId===ownerId),
          descriptionIds:prepared.added.descriptionIds.filter(id=>prepared.business.descriptions[id].folderId===ownerId),regionIds:[],
        };
        updateCanvasSelection(selected);setSelectedQuickAnnotationId(null);
        renderCanonicalScene({canonical:prepared.elements,ownerState:prepared.business,captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        setStatus("已粘贴为独立副本，原画布内容保持不变。");
      }else{
        writeStarted=true;
        for(let index=0;index<imageFiles.length;index++)await handleImportImage(imageFiles[index],{x:point.x+index*28,y:point.y+index*28},{loaded:loaded[index],folderId:ownerId});
        const added=Object.values(businessRef.current.imagePlacements).filter(row=>row.active&&!before!.business.imagePlacements[row.id]).map(row=>row.id);
        updateCanvasSelection({imagePlacementIds:added,descriptionIds:[],regionIds:[]});
        setSelectedCanvasImageId(added.length===1?businessRef.current.imagePlacements[added[0]].imageId:null);
        setSelectedImageId(added.length===1?businessRef.current.imagePlacements[added[0]].imageId:null);
        setStatus(`已粘贴 ${imageFiles.length} 张图片。`);
      }
    }catch(error){
      if(before && writeStarted){historyApplyRef.current(before);historyController.flush();}
      explainClipboardFailure(error,"尚未粘贴");
    }finally{clipboardBusyRef.current=false;setBusy(false);}
  },[api,busy,showBusinessNotice,historyController,captureGlobalHistorySnapshot,queueGlobalHistoryCommit,commitBusiness,renderCanonicalScene,updateCanvasSelection,handleImportImage,explainClipboardFailure]);

  clipboardPastePortRef.current=pasteCanvasContent;
  // Excalidraw shallow-compares callback props. Keep these identities stable so
  // its onChange notification cannot feed back into a fresh renderer update.
  const handleClipboardPointerUpdate=useCallback<NonNullable<ExcalidrawProps["onPointerUpdate"]>>(({pointer})=>{
    clipboardPointRef.current={x:pointer.x,y:pointer.y};
  },[]);
  const handleNativeClipboardPaste=useCallback<NonNullable<ExcalidrawProps["onPaste"]>>((data,event)=>{
    void clipboardPastePortRef.current?.(event?.clipboardData?.getData(CANVAS_CLIPBOARD_MIME)||data.text||"",[]);
    return false;
  },[]);

  useEffect(()=>{
    const copy=(event:ClipboardEvent)=>{if(clipboardTarget(event.target))void copyCanvasContent(event);};
    const cut=(event:ClipboardEvent)=>{
      if(!clipboardTarget(event.target))return;
      event.preventDefault();event.stopImmediatePropagation();
      void showBusinessNotice({title:"请使用复制",message:"当前画布内容支持复制和粘贴，暂不执行剪切，以保留原内容。"});
    };
    const paste=(event:ClipboardEvent)=>{
      if(!clipboardTarget(event.target))return;
      event.preventDefault();event.stopImmediatePropagation();
      const data=event.clipboardData;
      void pasteCanvasContent(data?.getData(CANVAS_CLIPBOARD_MIME)||data?.getData("text/plain")||"",Array.from(data?.files??[]));
    };
    document.addEventListener("copy",copy,true);document.addEventListener("cut",cut,true);document.addEventListener("paste",paste,true);
    return ()=>{document.removeEventListener("copy",copy,true);document.removeEventListener("cut",cut,true);document.removeEventListener("paste",paste,true);};
  },[clipboardTarget,copyCanvasContent,pasteCanvasContent,showBusinessNotice]);

  const beginAnnotationSelection = useCallback((selectionKind: SelectionKind, imageIdOverride?: string) => {
    const imageId = imageIdOverride ?? selectedImageId;
    if (!api || !imageId) {
      setStatus("请先选中一张图片，再创建标注选区。");
      return;
    }
    applyCanvasMenuAction("tool-switch");
    pendingRegionRef.current = {
      imageId,
      selectionKind,
    };
    setActiveSelectionTool(selectionKind);
    setActiveSelectionImageId(imageId);
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setIsBubbleToolActive(false);
    setIsDescriptionToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    api.setActiveTool({ type: "selection" });
    setStatus(
      selectionKind === "path"
        ? "路径选区：逐点点击落锚点，点击首锚点闭合；按 Esc 取消。"
        : `${selectionKind === "rectangle" ? "矩形" : "椭圆"}选区：请在图片内拖出范围；按 Esc 取消。`,
    );
  }, [api, applyCanvasMenuAction, selectedImageId, updateCanvasSelection]);

  const chooseAnnotationSelection = useCallback(
    (selectionKind: SelectionKind) => {
      setLastSelectionTool(selectionKind);
      setIsSelectionToolMenuOpen(false);
      beginAnnotationSelection(selectionKind);
    },
    [beginAnnotationSelection],
  );

  const activateCanvasTool = useCallback(
    (
      tool:
        | "selection"
        | "text"
        | "hand"
        | "line"
        | "arrow"
        | "laser",
      label: string,
    ) => {
      if (!api) {
        return;
      }
      applyCanvasMenuAction("tool-switch");
      pendingRegionRef.current = null;
      setActiveSelectionTool(null);
      setActiveSelectionImageId(null);
      pendingManualAnnotationRef.current = null;
      pendingBubbleRef.current = false;
      setIsBubbleToolActive(false);
      setIsDescriptionToolActive(false);
      setIsQuickAnnotationToolActive(false);
      setSelectedQuickAnnotationId(null);
      pendingOrdinaryTextBoxRef.current =
        tool === "text"
          ? new Set(api.getSceneElements().map((element) => element.id))
          : null;
      setManualAnnotationStage("idle");
      if (tool === "text") {
        api.updateScene({
          appState: { currentItemFontFamily: ANNOTATION_CARD_FONT_FAMILY },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      api.setActiveTool({ type: tool });
      setStatus(`${label}已启动。`);
    },
    [api, applyCanvasMenuAction],
  );

  const beginBubbleAnnotation = useCallback(() => {
    if (!api) {
      return;
    }
    applyCanvasMenuAction("tool-switch");
    pendingRegionRef.current = null;
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = true;
    setManualAnnotationStage("idle");
    setIsBubbleToolActive(true);
    setIsDescriptionToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    api.setActiveTool({ type: "selection" });
    setStatus("批注气泡模式已启动：请单击图片或画布上的目标点。");
  }, [api, applyCanvasMenuAction]);

  const cancelPendingAnnotationSelection = useCallback(() => {
    if (
      !pendingRegionRef.current &&
      !pendingManualAnnotationRef.current &&
      !pendingOrdinaryTextBoxRef.current &&
      !pendingBubbleRef.current &&
      !isDescriptionToolActive &&
      !isQuickAnnotationToolActive
    ) {
      return;
    }
    pendingRegionRef.current = null;
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setIsBubbleToolActive(false);
    setIsDescriptionToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    api?.setActiveTool({ type: "selection" });
    setStatus("已取消当前标注创建；普通画笔、文字和箭头不会被自动识别为标注。");
  }, [api, isDescriptionToolActive, isQuickAnnotationToolActive]);

  const beginManualAnnotation = useCallback(() => {
    if (!api || !selectedRegionId) {
      setStatus("请先选中一个标注选区，再进入手动标注模式。");
      return;
    }
    const region = businessRef.current.regions[selectedRegionId];
    if (!region) {
      setStatus("选中的标注选区不存在，无法开始手动标注。");
      return;
    }
    const existing = Object.values(businessRef.current.annotations).find(
      (annotation) => annotation.regionId === selectedRegionId,
    );
    pendingRegionRef.current = null;
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setIsBubbleToolActive(false);
    setIsDescriptionToolActive(false);
    pendingManualAnnotationRef.current = {
      imageId: region.imageId,
      regionId: selectedRegionId,
      annotationId: existing?.id ?? stableId("annotation"),
      stage: "text",
      existingElementIds: new Set(
        api.getSceneElements().map((element) => element.id),
      ),
    };
    setManualAnnotationStage("text");
    api.updateScene({
      appState: { currentItemFontFamily: ANNOTATION_CARD_FONT_FAMILY },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.setActiveTool({ type: "text" });
    setStatus(
      "手动标注第 1 步：在画布上放置并输入文字框；确认文字后会进入引线吸附步骤。",
    );
  }, [api, selectedRegionId]);

  const toggleGrid = useCallback(() => {
    setWorkbenchPreferences((current) => {
      const gridVisible = gridControlState(
        api?.getAppState().gridModeEnabled ?? current.gridVisible,
      ).nextNativeGridModeEnabled;
      api?.updateScene({
        appState: { gridModeEnabled: gridVisible },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return { ...current, gridVisible };
    });
  }, [api]);

  const setCanvasTheme = useCallback(
    (canvasTheme: CanvasThemeId) => {
      const preference = writeApplicationTheme(canvasTheme, lastLightCanvasThemeRef.current);
      lastLightCanvasThemeRef.current = preference.lastLight;
      setWorkbenchPreferences((current) => ({
        ...current,
        canvasTheme,
      }));
    },
    [],
  );

  useEffect(() => {
    const synchronize = () => {
      const preference = readApplicationTheme();
      if (!preference) return;
      lastLightCanvasThemeRef.current = preference.lastLight;
      setWorkbenchPreferences(current => current.canvasTheme === preference.theme
        ? current : { ...current, canvasTheme: preference.theme });
    };
    const receive = (event: StorageEvent) => {
      if (event.key === APPLICATION_THEME_STORAGE_KEY) synchronize();
    };
    synchronize();
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, []);

  const setCanvasZoom = useCallback(
    (nextZoom: number) => {
      if (!api) return;
      const appState = api.getAppState();
      const panel = canvasPanelRef.current;
      const currentZoom = appState.zoom.value;
      const clampedZoom = Math.min(4, Math.max(0.1, nextZoom));
      if (clampedZoom === currentZoom) return;
      const panelWidth = panel?.clientWidth ?? window.innerWidth;
      const panelHeight = panel?.clientHeight ?? window.innerHeight;
      const centerSceneX =
        -appState.scrollX + panelWidth / (2 * currentZoom);
      const centerSceneY =
        -appState.scrollY + panelHeight / (2 * currentZoom);
      api.updateScene({
        appState: {
          zoom: { value: clampedZoom } as AppState["zoom"],
          scrollX: panelWidth / (2 * clampedZoom) - centerSceneX,
          scrollY: panelHeight / (2 * clampedZoom) - centerSceneY,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [api],
  );

  const adjustCanvasZoom = useCallback(
    (step: number) => {
      const currentPercent = Math.round(
        (api?.getAppState().zoom.value ?? 1) * 100,
      );
      setCanvasZoom((currentPercent + step * 10) / 100);
    },
    [api, setCanvasZoom],
  );

  const toggleContextPanel = useCallback(() => {
    if (!workbenchPreferences.contextPanelOpen) {
      setIsDescriptionWorkspaceOpen(false);
      setDescriptionEditorFocusId(null);
    }
    setWorkbenchPreferences((current) => ({
      ...current,
      contextPanelOpen: !current.contextPanelOpen,
    }));
  }, [workbenchPreferences.contextPanelOpen]);

  const setContextPanelPlacement = useCallback(
    (placement: ContextPanelPlacement) => {
      setWorkbenchPreferences((current) => ({
        ...current,
        contextPanelOpen: true,
        contextPanelPlacement: placement,
      }));
    },
    [],
  );

  const startFloatingPanelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workbenchPreferences.contextPanelPlacement !== "floating") {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest("button, input, label, textarea, summary")) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      floatingPanelDragRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - workbenchPreferences.floatingPanelPosition.x,
        offsetY: event.clientY - workbenchPreferences.floatingPanelPosition.y,
      };
    },
    [
      workbenchPreferences.contextPanelPlacement,
      workbenchPreferences.floatingPanelPosition.x,
      workbenchPreferences.floatingPanelPosition.y,
    ],
  );

  const moveFloatingPanel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = floatingPanelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const maxX = Math.max(16, window.innerWidth - 344);
      const maxY = Math.max(76, window.innerHeight - 168);
      setWorkbenchPreferences((current) => ({
        ...current,
        floatingPanelPosition: {
          x: Math.min(maxX, Math.max(16, event.clientX - drag.offsetX)),
          y: Math.min(maxY, Math.max(76, event.clientY - drag.offsetY)),
        },
      }));
    },
    [],
  );

  const stopFloatingPanelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = floatingPanelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      floatingPanelDragRef.current = null;
    },
    [],
  );

  const bindPendingManualAnnotation = useCallback(() => {
    if (!api || !pendingManualAnnotationRef.current) {
      return;
    }
    const pending = pendingManualAnnotationRef.current;

    if (pending.stage === "text") {
      const candidate = api
        .getSceneElements()
        .find(
          (element): element is Ordered<ExcalidrawTextElement> =>
            isExplicitToolSessionElement(
              element,
              "text",
              pending.existingElementIds,
            ) &&
            element.type === "text" &&
            Boolean(element.text.trim()),
        );
      const regionElement = api
        .getSceneElements()
        .find(
          (element) =>
            element.id ===
            businessRef.current.regions[pending.regionId]?.elementId,
        );
      if (!candidate) {
        return;
      }
      if (!regionElement) {
        pendingManualAnnotationRef.current = null;
        setManualAnnotationStage("idle");
        setStatus("目标标注选区已不存在，未创建手动标注。");
        return;
      }

      const generated = createAnnotationCardElements({
        annotationId: pending.annotationId,
        regionId: pending.regionId,
        selection: annotationBounds(regionElement),
        card: createAnnotationCardBoundsForText(annotationBounds(candidate)),
        text: candidate.text,
      });
      const draftCard = newElementWith(generated.card, {
        customData: {
          kind: "manual-annotation-draft-card",
          annotationId: pending.annotationId,
          regionId: pending.regionId,
          imageId: pending.imageId,
        },
      });
      const draftText = newElementWith(generated.text, {
        customData: {
          kind: "manual-annotation-draft-text",
          annotationId: pending.annotationId,
          regionId: pending.regionId,
          imageId: pending.imageId,
          placeholder: "false",
        },
      });
      const nextElements: readonly ExcalidrawElement[] = [
        ...api
          .getSceneElements()
          .filter((element) => element.id !== candidate.id),
        draftCard,
        draftText,
      ];
      pendingManualAnnotationRef.current = {
        ...pending,
        stage: "leader",
        existingElementIds: new Set(nextElements.map((element) => element.id)),
        draftCardId: draftCard.id,
        draftTextId: draftText.id,
      };
      api.updateScene({
        elements: nextElements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.setActiveTool({ type: "arrow" });
      setManualAnnotationStage("leader");
      setStatus(
        "手动标注第 2 步：从文字框拖一条引线到选区边缘；两端靠近后会自动吸附并保存为标注。",
      );
      return;
    }

    const arrowCandidate = api
      .getSceneElements()
      .find((element) =>
        isExplicitToolSessionElement(
          element,
          "arrow",
          pending.existingElementIds,
        ),
      );
    if (!arrowCandidate) {
      return;
    }
    const allElements = api.getSceneElementsIncludingDeleted();
    const regionElement = allElements.find(
      (element) =>
        !element.isDeleted &&
        element.id === businessRef.current.regions[pending.regionId]?.elementId,
    );
    const draftCard = allElements.find(
      (element) =>
        !element.isDeleted && element.id === pending.draftCardId,
    );
    const draftText = allElements.find(
      (element): element is Ordered<ExcalidrawTextElement> =>
        !element.isDeleted &&
        element.id === pending.draftTextId &&
        element.type === "text",
    );
    if (!regionElement || !draftCard || !draftText || arrowCandidate.type !== "arrow") {
      pendingManualAnnotationRef.current = null;
      setManualAnnotationStage("idle");
      setStatus("手动标注草稿不完整，未建立结构化标注。");
      return;
    }

    const snapped = snapManualAnnotationArrow({
      arrow: {
        x: arrowCandidate.x,
        y: arrowCandidate.y,
        points: arrowCandidate.points as readonly [number, number][],
      },
      card: annotationBounds(draftCard),
      selection: annotationBounds(regionElement),
    });
    if (!snapped) {
      pending.existingElementIds.add(arrowCandidate.id);
      setStatus("引线两端需分别靠近文字框和选区边缘；该普通箭头未被识别为标注，请重新绘制引线。");
      return;
    }

    const completedCard = newElementWith(draftCard, {
      customData: {
        kind: "annotation-card",
        annotationId: pending.annotationId,
        regionId: pending.regionId,
        imageId: pending.imageId,
        annotationMode: "manual",
      },
    });
    const completedText = newElementWith(draftText, {
      strokeColor: getReadableTextColor(draftCard.backgroundColor),
      customData: {
        kind: "annotation",
        annotationId: pending.annotationId,
        regionId: pending.regionId,
        imageId: pending.imageId,
        annotationMode: "manual",
        placeholder: draftText.text.trim() ? "false" : "true",
      },
    });
    const completedLeader = newElementWith(arrowCandidate, {
      ...snapped,
      startArrowhead: null,
      endArrowhead: "arrow",
      strokeColor: "#0f766e",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      customData: {
        kind: "annotation-leader",
        annotationId: pending.annotationId,
        regionId: pending.regionId,
        imageId: pending.imageId,
        annotationMode: "manual",
        manualLeaderAnchors: snapped.anchors,
      },
    });
    const nextElements = allElements.map((element) => {
      if (element.id === draftCard.id) {
        return completedCard;
      }
      if (element.id === draftText.id) {
        return completedText;
      }
      if (element.id === arrowCandidate.id) {
        return completedLeader;
      }
      if (isAnnotationCardPart(element, pending.regionId)) {
        return newElementWith(element, { isDeleted: true });
      }
      return element;
    });
    commitBusiness((current) => ({
      ...current,
      document: {
        ...current.document,
        annotationIds: appendUnique(
          current.document.annotationIds,
          pending.annotationId,
        ),
      },
      annotations: {
        ...current.annotations,
        [pending.annotationId]: {
          id: pending.annotationId,
          regionId: pending.regionId,
          elementId: completedText.id,
          text: completedText.text,
          active: true,
        },
      },
    }));
    pendingManualAnnotationRef.current = null;
    setManualAnnotationStage("idle");
    updateCanvasSelection(
      createCanvasSelection({ regionIds: [pending.regionId] }),
    );
    api.updateScene({
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: "selection" });
    setAnnotationText(completedText.text);
    setStatus("手动标注已建立：文字框与引线已吸附并关联到当前选区。");
  }, [api, commitBusiness, updateCanvasSelection]);

  const handlePointerDown = useCallback(
    (
      _activeTool: AppState["activeTool"],
      pointerDownState: PointerDownState,
    ) => {
      if (!api) {
        return;
      }
      if (pendingBubbleRef.current) {
        pendingBubbleRef.current = false;
        setIsBubbleToolActive(false);
        const bubble = createBubbleAnnotationElements({
          bubbleId: stableId("bubble"),
          target: pointerDownState.origin,
        });
        window.setTimeout(() => {
          api.updateScene({
            elements: [
              ...api.getSceneElements(),
              bubble.leader,
              bubble.targetDot,
              bubble.card,
              bubble.text,
            ],
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
          api.setActiveTool({ type: "selection" });
          setStatus("已创建批注气泡；可双击框内文字编辑，单独选择引线即可删除。");
        }, 0);
        return;
      }
    },
    [api],
  );

  const handlePointerUp = useCallback((_activeTool: AppState["activeTool"]) => {
    const renderedElements = api?.getSceneElementsIncludingDeleted() ?? [];
    let sceneElements = folderProjectionRef.current
      ? deprojectFolderSceneChange(renderedElements, folderProjectionRef.current)
      : renderedElements;
    const folderDropGesture = nativeFolderDropGestureRef.current;
    nativeFolderDropGestureRef.current = null;
    updateFolderDropTarget(null);
    clearFolderDropImagePreviews();
    if (
      folderDropGesture?.moved &&
      folderDropGesture.targetFolderId &&
      folderNavigationRef.current.layer === "overview"
    ) {
      const current = migrateBusinessStateToV2(businessRef.current);
      const directSelection = folderDropDirectSelection({
        business: current,
        selection: canvasSelectionRef.current,
        draggedPlacementId: folderDropGesture.draggedPlacementId,
      });
      const dropped = applyExistingFolderDrop({
        business: current,
        elements: sceneElements,
        targetFolderId: folderDropGesture.targetFolderId,
        directSelection,
      });
      if (!dropped) {
        discardPendingNativeHistory();
        historyApplyRef.current(folderDropGesture.snapshot);
        historyController.synchronizeTransient();
        return;
      }
      sceneElements = dropped;
    }
    if (api) {
      historyController.finishNativeGesture(sceneElements);
    } else {
      historyController.finishNativeGesture(null);
    }
    if (pendingManualAnnotationRef.current) {
      bindPendingManualAnnotation();
    }
  }, [
    api,
    applyExistingFolderDrop,
    bindPendingManualAnnotation,
    clearFolderDropImagePreviews,
    discardPendingNativeHistory,
    historyController,
    updateFolderDropTarget,
  ]);

  const selectFolder = useCallback((folderId: string) => {
    reopenFolderPreview();
    const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
    const folder = scopedBusiness.folders[folderId];
    if (!folder || folderId === scopedBusiness.rootFolderId) {
      setStatus("目标文件夹不存在，未打开预览。");
      return;
    }
    const imageIds = folder.imageAssetIds.filter((imageId) => {
      const imageFileId = scopedBusiness.imageAssets[imageId]?.fileId;
      return Boolean(
        imageFileId &&
          latestFilesRef.current[imageFileId]?.dataURL &&
          latestElementsRef.current.some(
            (element) =>
              !element.isDeleted &&
              element.type === "image" &&
              element.customData?.imageId === imageId,
          ),
      );
    });
    const hasMotionSource = imageIds.length > 0 || folder.descriptionIds.length > 0;
    if (hasMotionSource) {
      const motion = {
        folderId,
        imageIds,
        descriptionIds: folder.descriptionIds,
      };
      folderPreviewMotionRef.current = motion;
      setFolderPreviewMotion(motion);
    } else {
      clearFolderPreviewMotion();
    }
    if (folderNavigationRef.current.layer === "overview") {
      folderParentViewportRef.current = canvasViewport;
    }
    const next: FolderNavigationState = {
      layer: "preview",
      selectedFolderId: folderId,
    };
    folderNavigationRef.current = next;
    // Hide the canonical preview members before the temporary motion layer
    // paints.  React's layout effect will render the same projection again,
    // but doing this synchronously closes the one-frame handoff in which the
    // final image slot could expose the canonical white image rectangle.
    if (api) {
      renderCanonicalScene({
        canonical: latestElementsRef.current,
        ownerState: scopedBusiness,
      });
    }
    setFolderNavigation(next);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setSelectedImageId(null);
    setSelectedCanvasImageId(null);
    setSelectedRegionId(null);
    setActiveDescriptionId(null);
    setDescriptionEditorFocusId(null);
    setIsDescriptionWorkspaceOpen(false);
    setStatus("已打开文件夹只读局部预览；点击画布空白处退出，双击或按 Enter 进入。");
  }, [api, canvasViewport, clearFolderPreviewMotion, renderCanonicalScene, updateCanvasSelection, reopenFolderPreview]);

  const getMarqueeCandidates = useCallback((): readonly CanvasObjectSelectionCandidate[] => {
    const root = canvasPanelRef.current;
    const hostCandidates: CanvasObjectSelectionCandidate[] = root
      ? Array.from(root.querySelectorAll<HTMLElement>("[data-canvas-object]")).flatMap((element) => {
          const kind = element.dataset.canvasObject;
          const id = kind === "description" ? element.dataset.descriptionId : kind === "region" ? element.dataset.regionId : undefined;
          if (!id || (kind !== "description" && kind !== "region")) return [];
          const bounds = element.getBoundingClientRect();
          return [{ kind, id, bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } }];
        })
      : [];
    const appState = api?.getAppState();
    const imageCandidates: CanvasObjectSelectionCandidate[] = appState && api
      ? api.getSceneElements().flatMap((element) => {
          if (folderProjectionRef.current?.hiddenElementIds.has(element.id)) return [];
          const placementId = typeof element.customData?.placementId === "string" ? element.customData.placementId : null;
          if (element.isDeleted || element.type !== "image" || !placementId || !businessRef.current.imagePlacements[placementId]) return [];
          const topLeft = sceneCoordsToViewportCoords({ sceneX: element.x, sceneY: element.y }, appState);
          const bottomRight = sceneCoordsToViewportCoords({ sceneX: element.x + element.width, sceneY: element.y + element.height }, appState);
          return [{ kind: "image" as const, id: placementId, bounds: { left: Math.min(topLeft.x, bottomRight.x), top: Math.min(topLeft.y, bottomRight.y), right: Math.max(topLeft.x, bottomRight.x), bottom: Math.max(topLeft.y, bottomRight.y) } }];
        })
      : [];
    return [...hostCandidates, ...imageCandidates];
  }, [api]);

  const canvasPointerController = useMemo(
    () => createCanvasPointerController(canvasPointerRuntime, {
      getCanvasRoot: () => canvasPanelRef.current,
      getMarqueeCandidates,
      onBlankClick: () => {
        if (isDescriptionWorkspaceOpen) {
          setStatus("说明编辑器保持展开；请点击收拢箭头退出。");
          return;
        }
        if (folderNavigationRef.current.layer === "preview") {
          requestFolderPreviewClose();
        }
        setSelectedImageId(null);
        setSelectedCanvasImageId(null);
        setSelectedRegionId(null);
        setActiveDescriptionId(null);
        setDescriptionEditorFocusId(null);
        setIsDescriptionWorkspaceOpen(false);
        setStatus(CANVAS_SELECTION_STATUS);
      },
      onMarqueeSelection: (selected) => {
        const selectedPlacement = selected.imagePlacementIds.length === 1 ? businessRef.current.imagePlacements[selected.imagePlacementIds[0]] : null;
        setSelectedImageId(selectedPlacement?.imageId ?? null);
        setSelectedCanvasImageId(selectedPlacement?.imageId ?? null);
        setSelectedRegionId(selected.regionIds.length === 1 ? selected.regionIds[0] : null);
        setStatus(CANVAS_SELECTION_STATUS);
      },
      onMarqueeBounds: (bounds, mode: CanvasMarqueeSelectionMode) => {
        if (folderNavigationRef.current.layer !== "overview") return false;
        const folderElement = Array.from(
          canvasPanelRef.current?.querySelectorAll<HTMLElement>("[data-folder-id]") ?? [],
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          return marqueeSelectsBounds(bounds, {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }, mode);
        });
        const folderId = folderElement?.dataset.folderId;
        if (!folderId) return false;
        selectFolder(folderId);
        setStatus("框选已选中文件夹；按 Delete 删除，按 Enter 进入。");
        return true;
      },
      onNativeImage: (input) => {
        const placementId = typeof input.hitElement?.customData?.placementId === "string" ? input.hitElement.customData.placementId : null;
        const placement = placementId ? businessRef.current.imagePlacements[placementId] : null;
        if (!placement) return;
        if (!canvasSelectionRef.current.imagePlacementIds.includes(placement.id)) {
          updateCanvasSelection(createCanvasSelection({ imagePlacementIds: [placement.id] }));
        }
        bringSelectedImageToFront(placement.imageId);
        setSelectedImageId(placement.imageId);
        setSelectedCanvasImageId(placement.imageId);
        setSelectedRegionId(null);
        setStatus(CANVAS_SELECTION_STATUS);
        if (!isDescriptionWorkspaceOpen) {
          setActiveDescriptionId(null);
          setDescriptionEditorFocusId(null);
          setIsDescriptionWorkspaceOpen(false);
        }
      },
      onNativeElement: () => {
        updateCanvasSelection(EMPTY_CANVAS_SELECTION);
        setSelectedImageId(null);
        setSelectedCanvasImageId(null);
        setSelectedRegionId(null);
        if (!isDescriptionWorkspaceOpen) {
          setActiveDescriptionId(null);
          setDescriptionEditorFocusId(null);
          setIsDescriptionWorkspaceOpen(false);
        }
      },
      onSynchronizeTransient: () => historyController.synchronizeTransient(),
      onBlockedFreedraw: () => api?.setActiveTool({ type: "selection" }),
      isCanvasMenuOpen: () => isCanvasMenuOpen,
      isInsideMenu: (target) => target instanceof Element && Boolean(target.closest(".canvas-workspace-menu")),
      applyMenuAction: applyCanvasMenuAction,
      setMarqueeRect: setCanvasMarqueeRect,
      getActiveToolType: () => api?.getAppState().activeTool.type ?? null,
      onNativeImageGestureStart: () => {
        if (api) historyController.beginNativeGesture(latestElementsRef.current);
      },
      onNativeGestureCancel: () => historyController.finishNativeGesture(null),
    }),
    [api, applyCanvasMenuAction, bringSelectedImageToFront, canvasPointerRuntime, requestFolderPreviewClose, getMarqueeCandidates, historyController, isCanvasMenuOpen, isDescriptionWorkspaceOpen, selectFolder, setCanvasMarqueeRect, updateCanvasSelection],
  );

  const handleAppPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => canvasPointerController.onAppPointerDown(event), [canvasPointerController]);
  const handleCanvasPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".quick-annotation-overlay")
    ) {
      return;
    }
    setSelectedQuickAnnotationId(null);
    if (shouldBlockPreviewPan({ layer: folderNavigationRef.current.layer, button: event.button })) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    canvasPointerController.onCanvasPointerDown(event);
  }, [canvasPointerController]);
  const handleCanvasPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".quick-annotation-overlay")
      ) {
        return;
      }
      canvasPointerController.onMove(event);
      const gesture = nativeFolderDropGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.moved =
        gesture.moved ||
        Math.hypot(
          event.clientX - gesture.startClientX,
          event.clientY - gesture.startClientY,
        ) >= 3;
      const targetFolderId = gesture.moved
        ? folderDropTargetAtClientPoint(event)
        : null;
      gesture.targetFolderId = targetFolderId;
      updateFolderDropTarget(targetFolderId);
      scheduleFolderDropImagePreviews(
        targetFolderId,
        gesture.draggedPlacementId,
      );
    },
    [
      canvasPointerController,
      folderDropTargetAtClientPoint,
      scheduleFolderDropImagePreviews,
      updateFolderDropTarget,
    ],
  );
  const clearCanvasPointerSession = useCallback(() => canvasPointerController.clear(), [canvasPointerController]);

  const handleCanvasPointerUpCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".quick-annotation-overlay")
      ) {
        return;
      }
      const gesture = nativeFolderDropGestureRef.current;
      if (gesture && gesture.pointerId === event.pointerId) {
        gesture.moved =
          gesture.moved ||
          Math.hypot(
            event.clientX - gesture.startClientX,
            event.clientY - gesture.startClientY,
          ) >= 3;
        gesture.targetFolderId = gesture.moved
          ? folderDropTargetAtClientPoint(event)
          : null;
      }
      canvasPointerController.onUp(event);
    },
    [canvasPointerController, folderDropTargetAtClientPoint],
  );
  const handleCanvasPointerCancelCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".quick-annotation-overlay")
      ) {
        return;
      }
      const gesture = nativeFolderDropGestureRef.current;
      canvasPointerController.onCancel(event);
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      nativeFolderDropGestureRef.current = null;
      updateFolderDropTarget(null);
      clearFolderDropImagePreviews();
      discardPendingNativeHistory();
      historyApplyRef.current(gesture.snapshot);
      historyController.synchronizeTransient();
      setStatus("已取消拖动；图片保持在拖动前位置。");
    },
    [
      canvasPointerController,
      clearFolderDropImagePreviews,
      discardPendingNativeHistory,
      historyController,
      updateFolderDropTarget,
    ],
  );

  useEffect(() => {
    if (!api) return;
    const unsubscribePointerDown = api.onPointerDown((activeTool, pointerDownState, event) => {
      historyController.flush();
      historyController.synchronize();
      const intent = canvasPointerController.onNativePointerDown({
        activeToolType: activeTool.type,
        hitElement: pointerDownState.hit.element,
        resize: pointerDownState.resize,
        hasControlledImageSelection: canvasSelectionRef.current.imagePlacementIds.some(
          (placementId) => businessRef.current.imagePlacements[placementId]?.active,
        ),
      }, event);
      const placementId =
        intent === "native-image" &&
        !pointerDownState.resize?.handleType &&
        !pointerDownState.resize?.isResizing &&
        typeof pointerDownState.hit.element?.customData?.placementId === "string"
          ? pointerDownState.hit.element.customData.placementId
          : null;
      const placement = placementId
        ? businessRef.current.imagePlacements[placementId]
        : null;
      if (
        placement &&
        folderNavigationRef.current.layer === "overview" &&
        (placement.folderId ?? businessRef.current.rootFolderId) ===
          businessRef.current.rootFolderId
      ) {
        nativeFolderDropGestureRef.current = {
          pointerId: event.pointerId,
          draggedPlacementId: placement.id,
          startClientX: event.clientX,
          startClientY: event.clientY,
          moved: false,
          targetFolderId: null,
          snapshot: cloneGlobalHistorySnapshot(
            captureGlobalHistorySnapshot(),
          ),
        };
        updateFolderDropTarget(null);
        clearFolderDropImagePreviews();
      } else {
        nativeFolderDropGestureRef.current = null;
        clearFolderDropImagePreviews();
      }
    });
    return unsubscribePointerDown;
  }, [
    api,
    canvasPointerController,
    captureGlobalHistorySnapshot,
    clearFolderDropImagePreviews,
    historyController,
    updateFolderDropTarget,
  ]);

  const selectionElements = useMemo(
    () =>
      getSelectionElements(
        latestElementsRef.current as unknown as readonly SelectionElementLike[],
      ),
    [business],
  );
  const selectionNumberByRegion = useMemo(
    () => selectionNumberMap(selectionElements),
    [selectionElements],
  );
  const imageNumberById = useMemo(
    () =>
      new Map(
        business.document.imageAssetIds.map((imageId, index) => [
          imageId,
          index + 1,
        ]),
      ),
    [business.document.imageAssetIds],
  );
  const visibleFolderIds = useMemo(() => {
    const scopedBusiness = migrateBusinessStateToV2(business);
    if (folderNavigation.layer === "overview") {
      return new Set([scopedBusiness.rootFolderId]);
    }
    if (folderNavigation.layer === "preview") {
      return new Set([
        scopedBusiness.rootFolderId,
        folderNavigation.selectedFolderId,
      ]);
    }
    return new Set([folderNavigation.selectedFolderId]);
  }, [business, folderNavigation]);
  const descriptionPresentationBusiness = useMemo(() => {
    const scopedBusiness = migrateBusinessStateToV2(business);
    const descriptions = Object.fromEntries(
      Object.entries(scopedBusiness.descriptions).filter(
        ([descriptionId, description]) =>
          visibleFolderIds.has(description.folderId ?? "") &&
          (folderNavigation.layer !== "description" ||
            folderNavigation.descriptionId === descriptionId),
      ),
    );
    const descriptionIds = new Set(Object.keys(descriptions));
    const descriptionReferences = Object.fromEntries(
      Object.entries(scopedBusiness.descriptionReferences).filter(([, reference]) =>
        descriptionIds.has(reference.descriptionId),
      ),
    );
    const descriptionScopeLinks = Object.fromEntries(
      Object.entries(scopedBusiness.descriptionScopeLinks).filter(([, link]) =>
        descriptionIds.has(link.descriptionId),
      ),
    );
    return {
      ...scopedBusiness,
      document: {
        ...scopedBusiness.document,
        descriptionIds: scopedBusiness.document.descriptionIds.filter((id) =>
          descriptionIds.has(id),
        ),
        descriptionReferenceIds:
          scopedBusiness.document.descriptionReferenceIds.filter((id) =>
            Boolean(descriptionReferences[id]),
          ),
        descriptionScopeLinkIds:
          scopedBusiness.document.descriptionScopeLinkIds.filter((id) =>
            Boolean(descriptionScopeLinks[id]),
          ),
      },
      descriptions,
      descriptionReferences,
      descriptionScopeLinks,
    };
  }, [business, folderNavigation, visibleFolderIds]);
  const descriptionScopeCandidates = useMemo(
    () =>
      selectionElements
        .filter((selection) => {
          const folderId = business.regions[selection.regionId]?.folderId;
          return folderId ? visibleFolderIds.has(folderId) : false;
        })
        .map((selection) => ({
        regionId: selection.regionId,
        number: selectionNumberByRegion.get(selection.regionId) ?? 0,
        imageId: selection.imageId,
        imageNumber: imageNumberById.get(selection.imageId) ?? 0,
        thumbnailUrl:
          business.imageAssets[selection.imageId]?.fileId
            ? latestFilesRef.current[
                business.imageAssets[selection.imageId].fileId
              ]?.dataURL
            : undefined,
      })),
    [
      business.imageAssets,
      business.regions,
      imageNumberById,
      selectionElements,
      selectionNumberByRegion,
      visibleFolderIds,
    ],
  );
  const descriptionPresentation = useMemo(
    () =>
      createDescriptionCanvasPresentation(
        descriptionPresentationBusiness,
        descriptionScopeCandidates,
      ),
    [descriptionPresentationBusiness, descriptionScopeCandidates],
  );
  const {
    items: descriptionItems,
    scopeGroups: descriptionScopeGroups,
    regionBindings: descriptionRegionBindings,
    boundRegionIds,
    filledDescriptionCount,
    canvasLevelDescriptionCount,
    descriptionScopeLinkCount,
  } = descriptionPresentation;

  const activeDescriptionRegionIds = useMemo(
    () =>
      new Set(
        descriptionItems.find((item) => item.id === activeDescriptionId)
          ?.regionIds ?? [],
      ),
    [activeDescriptionId, descriptionItems],
  );
  const activeCanvasToolType = api?.getAppState().activeTool.type ?? "selection";

  const createWorkspaceDescription = useCallback(
    (regionId?: string, focusEditor = true) => {
      if (!api) return;
      const descriptionId = stableId("description");
      const referenceId = stableId("description-reference");
      const currentBusiness = migrateBusinessStateToV2(businessRef.current);
      const folderId = folderScopeId(
        folderNavigationRef.current,
        currentBusiness,
      );
      const appState = api.getAppState();
      const zoom = appState.zoom.value;
      const scopeImageIds = new Set(currentBusiness.folders[folderId].imageAssetIds);
      const scopeImageElementIds = new Set(
        Object.values(currentBusiness.imagePlacements)
          .filter((placement) => placement.active && scopeImageIds.has(placement.imageId))
          .map((placement) => placement.elementId),
      );
      const imageBounds = api.getSceneElements()
        .filter((element) => element.type === "image" && !element.isDeleted &&
          scopeImageElementIds.has(element.id) &&
          !folderProjectionRef.current?.hiddenElementIds.has(element.id))
        .map((element) => getCommonBounds([element]));
      const [left, top, right, bottom] = getVisibleSceneBounds(appState);
      const editorWillBeVisible = focusEditor &&
        folderNavigationRef.current.layer !== "image" &&
        folderNavigationRef.current.layer !== "preview";
      const anchor = placeNewDescriptionOutsideImages({
        preferred: { x: -appState.scrollX + 180 / zoom, y: -appState.scrollY + 150 / zoom },
        size: descriptionCreationCardSize(zoom),
        imageBounds,
        viewport: [
          left + 80 / zoom,
          top + 110 / zoom,
          right - (24 + (editorWillBeVisible ? appState.width * 0.225 : 0)) / zoom,
          bottom - 80 / zoom,
        ],
        gap: DESCRIPTION_CREATION_IMAGE_GAP_PX / zoom,
      });
      commitBusiness((current) => {
        const created = expandDescriptionReference(
          createDescription(current, {
            descriptionId,
            referenceId,
            anchor,
            folderId,
          }),
          descriptionId,
        );
        return regionId
          ? toggleDescriptionScope(created, {
              descriptionId,
              regionId,
              linkId: stableId("description-scope"),
            })
          : created;
      }, "description-workspace-create");
      const synchronized = synchronizeEmptyFolderCovers({
        business: migrateBusinessStateToV2(businessRef.current),
        elements: latestElementsRef.current,
      });
      if (sceneElementsChanged(latestElementsRef.current, synchronized.elements)) {
        latestElementsRef.current = synchronized.elements;
        commitBusiness(
          synchronized.business,
          "description-workspace-create",
          false,
        );
        renderCanonicalScene({
          canonical: synchronized.elements,
          ownerState: synchronized.business,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
      setActiveDescriptionId(descriptionId);
      setDescriptionEditorFocusId(focusEditor ? descriptionId : null);
      setIsDescriptionWorkspaceOpen(focusEditor);
      updateCanvasSelection(
        regionId
          ? createCanvasSelection({ regionIds: [regionId] })
          : EMPTY_CANVAS_SELECTION,
      );
      setIsDescriptionToolActive(false);
      setCodexContext(null);
      setStatus(
        regionId
          ? "已建立说明并关联当前同 scope 选区。"
          : "已建立可独立移动的零绑定说明；编辑器已在当前画布内展开。",
      );
    },
    [
      api,
      commitBusiness,
      renderCanonicalScene,
      updateCanvasSelection,
    ],
  );

  const beginDescription = useCallback(() => {
    if (!api) {
      return;
    }
    applyCanvasMenuAction("tool-switch");
    pendingRegionRef.current = null;
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setIsBubbleToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    api.setActiveTool({ type: "selection" });

    createWorkspaceDescription(undefined, true);
  }, [
    api,
    applyCanvasMenuAction,
    createWorkspaceDescription,
  ]);

  const beginQuickAnnotation = useCallback(() => {
    if (!api) return;
    if (Object.keys(businessRef.current.imageAssets).length === 0) {
      setStatus("请先导入图片，再使用快速标注。");
      return;
    }
    applyCanvasMenuAction("tool-switch");
    pendingRegionRef.current = null;
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setIsBubbleToolActive(false);
    setIsDescriptionToolActive(false);
    setIsQuickAnnotationToolActive(true);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    api.setActiveTool({ type: "selection" });
    setStatus("快速标注已启动：单击添加点标注，拖动添加矩形标注；按 Esc 退出。");
  }, [api, applyCanvasMenuAction, updateCanvasSelection]);

  const handleQuickAnnotationCreate = useCallback(
    (
      input: { labelAnchor?: Readonly<{ x: number; y: number }>; labelSide?: "left" | "right" } & (
        | { imageId: string; mode: "point"; anchor: Readonly<{ x: number; y: number }>; text: string }
        | { imageId: string; mode: "rectangle"; anchor: Readonly<{ x: number; y: number }>; rectangle: Readonly<{ x: number; y: number; width: number; height: number }>; text: string }),
    ) => {
      const annotationId = stableId("quick-annotation");
      commitBusiness(
        (current) =>
          createQuickAnnotation(migrateBusinessStateToV2(current), {
            ...input,
            id: annotationId,
          }),
        "quick-annotation-create",
      );
      setSelectedQuickAnnotationId(annotationId);
      setCodexContext(null);
      setStatus(
        `${input.mode === "point" ? "点" : "矩形"}快速标注已创建；工具保持激活。`,
      );
    },
    [commitBusiness],
  );

  const handleQuickAnnotationCollapsed = useCallback(
    (annotationId: string, collapsed: boolean) => {
      commitBusiness(
        (current) =>
          setQuickAnnotationCollapsed(
            migrateBusinessStateToV2(current),
            annotationId,
            collapsed,
          ),
        collapsed ? "quick-annotation-collapse" : "quick-annotation-expand",
      );
      setSelectedQuickAnnotationId(annotationId);
    },
    [commitBusiness],
  );

  const handleQuickAnnotationText = useCallback(
    (annotationId: string, text: string) => {
      commitBusiness(
        (current) =>
          setQuickAnnotationText(
            migrateBusinessStateToV2(current),
            annotationId,
            text,
          ),
        "quick-annotation-edit",
      );
      setSelectedQuickAnnotationId(annotationId);
      setCodexContext(null);
      setStatus("快速标注文本已更新。");
    },
    [commitBusiness],
  );

  const handleQuickAnnotationMove = useCallback(
    (annotationId: string, delta: Readonly<{ x: number; y: number }>, labelAnchor: Readonly<{ x: number; y: number }>, labelSide: "left" | "right") => {
      commitBusiness(
        (current) =>
          translateQuickAnnotation(
            setQuickAnnotationLabelAnchor(migrateBusinessStateToV2(current), annotationId, labelAnchor, undefined, labelSide),
            annotationId,
            delta,
          ),
        "quick-annotation-move",
      );
      setSelectedQuickAnnotationId(annotationId);
      setCodexContext(null);
      setStatus("快速标注已移动。");
    },
    [commitBusiness],
  );

  const handleQuickAnnotationLabelMove = useCallback(
    (annotationId: string, labelAnchor: Readonly<{ x: number; y: number }>, labelSide: "left" | "right") => {
      commitBusiness(
        (current) =>
          setQuickAnnotationLabelAnchor(
            migrateBusinessStateToV2(current),
            annotationId,
            labelAnchor,
            undefined,
            labelSide,
          ),
        "quick-annotation-label-move",
      );
      setSelectedQuickAnnotationId(annotationId);
      setCodexContext(null);
      setStatus("快速标注标签已移动。");
    },
    [commitBusiness],
  );

  const handleQuickAnnotationResize = useCallback(
    (annotationId: string, rectangle: Readonly<{ x: number; y: number; width: number; height: number }>, labelAnchor: Readonly<{ x: number; y: number }>, labelSide: "left" | "right") => {
      commitBusiness((current) => resizeQuickAnnotation(
        setQuickAnnotationLabelAnchor(migrateBusinessStateToV2(current), annotationId, labelAnchor, undefined, labelSide),
        annotationId, rectangle,
      ), "quick-annotation-resize");
      setSelectedQuickAnnotationId(annotationId);
      setCodexContext(null);
      setStatus("快速标注范围已缩放。");
    }, [commitBusiness],
  );

  const deleteSelectedQuickAnnotation = useCallback((): boolean => {
    if (folderNavigationRef.current.layer === "preview") return false;
    if (!selectedQuickAnnotationId) return false;
    const annotation = migrateBusinessStateToV2(
      businessRef.current,
    ).quickAnnotations[selectedQuickAnnotationId];
    if (!annotation) {
      setSelectedQuickAnnotationId(null);
      return false;
    }
    commitBusiness(
      (current) =>
        deleteQuickAnnotation(
          migrateBusinessStateToV2(current),
          selectedQuickAnnotationId,
        ),
      "quick-annotation-delete",
    );
    setSelectedQuickAnnotationId(null);
    setCodexContext(null);
    setStatus(`已删除快速标注 Q${annotation.ordinal}。`);
    return true;
  }, [commitBusiness, selectedQuickAnnotationId]);

  const handleDescriptionActivate = useCallback(
    (descriptionId: string) => {
      descriptionHost.activate(descriptionId);
      updateCanvasSelection(createCanvasSelection({ descriptionIds: [descriptionId] }));
    },
    [descriptionHost, updateCanvasSelection],
  );

  const handleDescriptionSwitch = useCallback(
    (descriptionId: string) => {
      setIsDescriptionWorkspaceOpen(true);
      setWorkbenchPreferences((current) => ({
        ...current,
        contextPanelOpen: false,
      }));
      descriptionHost.switchTo(descriptionId);
      updateCanvasSelection(createCanvasSelection({ descriptionIds: [descriptionId] }));
    },
    [descriptionHost, updateCanvasSelection],
  );

  const scrollElementsAtCurrentZoom = useCallback(
    (elements: readonly ExcalidrawElement[]): boolean => {
      const panel = canvasPanelRef.current;
      if (!api || !panel || elements.length === 0) return false;
      const zoom = api.getAppState().zoom.value;
      const [left, top, right, bottom] = getCommonBounds(elements);
      api.updateScene({
        appState: {
          zoom: { value: zoom } as AppState["zoom"],
          scrollX: panel.clientWidth / (2 * zoom) - (left + right) / 2,
          scrollY: panel.clientHeight / (2 * zoom) - (top + bottom) / 2,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return true;
    },
    [api],
  );

  const focusDescriptionImage = useCallback(
    (imageId: string) => {
      const image = api
        ?.getSceneElements()
        .find(
          (element) =>
            element.type === "image" &&
            !element.isDeleted &&
            element.customData?.imageId === imageId,
      );
      if (image) {
        scrollElementsAtCurrentZoom([image]);
      }
    },
    [scrollElementsAtCurrentZoom],
  );

  const focusDescriptionScope = useCallback(
    (regionId: string) => {
      const selection = selectionElements.find(
        (candidate) => candidate.regionId === regionId,
      );
      if (selection) {
        scrollElementsAtCurrentZoom([
          selection.element as unknown as ExcalidrawElement,
        ]);
      }
    },
    [scrollElementsAtCurrentZoom, selectionElements],
  );

  const handleDescriptionEditorFocus = useCallback(
    (descriptionId: string, focused: boolean) => {
      descriptionHost.setEditorFocus(descriptionId, focused);
    },
    [descriptionHost],
  );

  const handleDescriptionWorkspaceOpenChange = useCallback((open: boolean) => {
    setIsDescriptionWorkspaceOpen(open);
    if (!open) {
      setDescriptionEditorFocusId(null);
    }
  }, []);

  const handleDescriptionTextChange = useCallback(
    (descriptionId: string, text: string) => {
      descriptionHost.setText(descriptionId, text);
    },
    [descriptionHost],
  );

  const handleDescriptionReferenceUrlChange = useCallback(
    (descriptionId: string, referenceUrl: string) => {
      descriptionHost.setReferenceUrl(descriptionId, referenceUrl);
    },
    [descriptionHost],
  );

  const handleDescriptionScopeToggle = useCallback(
    (descriptionId: string, regionId: string) => {
      descriptionHost.toggleScope(descriptionId, regionId);
    },
    [descriptionHost],
  );

  const deleteActiveDescription = useCallback(
    (descriptionId: string) => {
      descriptionHost.delete(descriptionId);
    },
    [descriptionHost],
  );
  const selectedSelection = useMemo(
    () =>
      selectionElements.find((selection) => selection.regionId === selectedRegionId) ??
      null,
    [selectedRegionId, selectionElements],
  );
  const selectedSelectionElement = selectedSelection?.element ?? null;
  const selectedSelectionInstruction =
    selectedSelectionElement &&
    typeof selectedSelectionElement.customData?.selectionInstruction === "string"
      ? selectedSelectionElement.customData.selectionInstruction
      : null;
  const selectedSelectionOrdinal = useMemo(() => {
    if (!selectedSelection || !selectedSelectionElement || !selectedRegionId) {
      return null;
    }
    return selectionImageOrdinalMap(selectionElements, selectedSelection.imageId).get(
      selectedRegionId,
    );
  }, [selectedRegionId, selectedSelection, selectedSelectionElement, selectionElements]);
  const selectedImageSelections = useMemo(
    () =>
      selectedSelection
        ? selectionElements.filter(
            (selection) => selection.imageId === selectedSelection.imageId,
          )
        : [],
    [selectedSelection, selectionElements],
  );
  const isSelectionInspectorActive = Boolean(
    selectedSelectionElement && !selectedBubbleAnnotation,
  );

  const handleSelectionCreate = useCallback(
    (
      kind: SelectionKind,
      scenePoints: readonly Readonly<{ x: number; y: number }>[],
    ) => {
      const pending = pendingRegionRef.current;
      if (!api || !pending || pending.selectionKind !== kind) {
        return;
      }
      const points =
        kind === "rectangle" && scenePoints.length === 2
          ? ([
              { x: Math.min(scenePoints[0].x, scenePoints[1].x), y: Math.min(scenePoints[0].y, scenePoints[1].y) },
              { x: Math.max(scenePoints[0].x, scenePoints[1].x), y: Math.min(scenePoints[0].y, scenePoints[1].y) },
              { x: Math.max(scenePoints[0].x, scenePoints[1].x), y: Math.max(scenePoints[0].y, scenePoints[1].y) },
              { x: Math.min(scenePoints[0].x, scenePoints[1].x), y: Math.max(scenePoints[0].y, scenePoints[1].y) },
            ] as const)
          : scenePoints;
      const frame = selectionPointFrame(points);
      if ((kind === "path" && points.length < 3) || frame.width < 2 || frame.height < 2) {
        setStatus("选区范围过小，请重新创建。");
        return;
      }
      const regionId = stableId("region");
      const regionFolderId =
        businessRef.current.imageAssets[pending.imageId]?.folderId ??
        migrateBusinessStateToV2(businessRef.current).rootFolderId;
      const host = createRegionElement({
        imageId: pending.imageId,
        regionId,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      });
      const selectionHost = newElementWith(host, {
        locked: true,
        opacity: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        customData: {
          ...host.customData,
          kind: "region",
          imageId: pending.imageId,
          regionId,
          selectionKind: kind,
          selectionInstruction: "",
          selectionInstructionStatus: "unfilled",
          folderId: regionFolderId,
          ...(kind === "ellipse" ? {} : { selectionPoints: frame.localPoints }),
        },
      });
      commitBusiness((current) => ({
        ...current,
        document: {
          ...current.document,
          regionIds: appendUnique(current.document.regionIds, regionId),
        },
        regions: {
          ...current.regions,
          [regionId]: {
            id: regionId,
            imageId: pending.imageId,
            elementId: selectionHost.id,
            geometry: null,
            active: true,
            status: "valid",
            folderId: regionFolderId,
          },
        },
      }));
      setSelectedBubbleAnnotation(null);
      setActiveDescriptionId(null);
      setDescriptionEditorFocusId(null);
      updateCanvasSelection(createCanvasSelection({ regionIds: [regionId] }));
      setSelectedRegionId(regionId);
      setSelectedImageId(pending.imageId);
      setAnnotationText("");
      api.updateScene({
        elements: [...api.getSceneElements(), selectionHost],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setStatus("已创建选区；可继续创建同类型选区，按 Esc 退出。");
    },
    [api, commitBusiness, updateCanvasSelection],
  );

  const handleSelectionCreationRejected = useCallback(() => {
    setStatus("请在当前图片内部创建至少 4 × 4 的选区。");
  }, []);

  const handleSelectionRegionSelect = useCallback(
    (regionId: string) => {
      if (!api) {
        return;
      }
      const selection = getSelectionElements(
        api.getSceneElements() as unknown as readonly SelectionElementLike[],
      ).find((candidate) => candidate.regionId === regionId);
      if (!selection) {
        return;
      }
      setSelectedBubbleAnnotation(null);
      updateCanvasSelection(
        createCanvasSelection({ regionIds: [selection.regionId] }),
      );
      setSelectedRegionId(selection.regionId);
      setSelectedImageId(selection.imageId);
      if (isDescriptionToolActive) {
        createWorkspaceDescription(selection.regionId, false);
        return;
      }
      if (!isDescriptionWorkspaceOpen) {
        setActiveDescriptionId(null);
        setDescriptionEditorFocusId(null);
      }
    },
    [
      api,
      createWorkspaceDescription,
      isDescriptionWorkspaceOpen,
      isDescriptionToolActive,
      updateCanvasSelection,
    ],
  );

  const handleSelectionRegionBadgeSelect = useCallback(
    (regionId: string) => {
      handleSelectionRegionSelect(regionId);
    },
    [handleSelectionRegionSelect],
  );

  const handleSelectionVertexChange = useCallback(
    (
      regionId: string,
      index: number,
      point: Readonly<{ x: number; y: number }>,
      commit: boolean,
      constrainToRectangle: boolean,
    ) => {
      if (folderNavigationRef.current.layer === "preview") {
        return;
      }
      if (!api) {
        return;
      }
      const element = api
        .getSceneElements()
        .find(
          (candidate) =>
            candidate.customData?.kind === "region" &&
            candidate.customData.regionId === regionId,
        );
      if (!element) {
        return;
      }
      const originalScenePoints = selectionScenePoints(
        element as unknown as SelectionElementLike,
      );
      const nextScenePoints =
        constrainToRectangle &&
        selectionKindOf(element as unknown as SelectionElementLike) ===
          "rectangle"
          ? orthogonalRectanglePointsFromVertex(originalScenePoints, index, point) ??
            originalScenePoints.map((candidate, candidateIndex) =>
              candidateIndex === index ? point : candidate,
            )
          : originalScenePoints.map((candidate, candidateIndex) =>
              candidateIndex === index ? point : candidate,
            );
      const frame = selectionPointFrame(nextScenePoints);
      const nextElement = newElementWith(element, {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        customData: {
          ...(element.customData ?? {}),
          selectionPoints: frame.localPoints,
        },
      });
      globalHistoryScenePreviewRef.current = !commit;
      if (commit) {
        queueGlobalHistoryCommit("host", "region-vertex");
      }
      api.updateScene({
        elements: api
          .getSceneElementsIncludingDeleted()
          .map((candidate) =>
            candidate.id === element.id ? nextElement : candidate,
          ),
        captureUpdate: commit
          ? CaptureUpdateAction.IMMEDIATELY
          : CaptureUpdateAction.NEVER,
      });
      if (!commit) {
        window.setTimeout(() => {
          globalHistoryScenePreviewRef.current = false;
        }, 0);
      }
    },
    [api, queueGlobalHistoryCommit],
  );

  const handleSelectionMove = useCallback(
    (
      regionId: string,
      delta: Readonly<{ x: number; y: number }>,
      commit: boolean,
    ) => {
      if (folderNavigationRef.current.layer === "preview") {
        return;
      }
      if (!api || (delta.x === 0 && delta.y === 0)) {
        return;
      }
      const element = api
        .getSceneElements()
        .find(
          (candidate) =>
            candidate.customData?.kind === "region" &&
            candidate.customData.regionId === regionId,
        );
      if (!element) {
        return;
      }
      const imageId =
        typeof element.customData?.imageId === "string"
          ? element.customData.imageId
          : null;
      const image = imageId
        ? api
            .getSceneElements()
            .find(
              (candidate) =>
                candidate.type === "image" &&
                candidate.customData?.imageId === imageId,
            )
        : null;
      if (!image) {
        return;
      }
      const clampedDelta = clampSelectionTranslationToImageBounds(
        element as unknown as SelectionElementLike,
        image as unknown as SelectionElementLike,
        delta,
      );
      const nextElement = newElementWith(element, {
        x: element.x + clampedDelta.x,
        y: element.y + clampedDelta.y,
      });
      globalHistoryScenePreviewRef.current = !commit;
      if (commit) {
        queueGlobalHistoryCommit("host", "region-move");
      }
      api.updateScene({
        elements: api
          .getSceneElementsIncludingDeleted()
          .map((candidate) =>
            candidate.id === element.id ? nextElement : candidate,
          ),
        captureUpdate: commit
          ? CaptureUpdateAction.IMMEDIATELY
          : CaptureUpdateAction.NEVER,
      });
      if (!commit) {
        window.setTimeout(() => {
          globalHistoryScenePreviewRef.current = false;
        }, 0);
      }
    },
    [api, queueGlobalHistoryCommit],
  );

  const handleSelectionEllipseChange = useCallback(
    (
      regionId: string,
      edge: "top" | "right" | "bottom" | "left",
      point: Readonly<{ x: number; y: number }>,
      commit: boolean,
    ) => {
      if (folderNavigationRef.current.layer === "preview") {
        return;
      }
      if (!api) {
        return;
      }
      const element = api
        .getSceneElements()
        .find(
          (candidate) =>
            candidate.customData?.kind === "region" &&
            candidate.customData.regionId === regionId &&
            candidate.customData.selectionKind === "ellipse",
        );
      if (!element) {
        return;
      }
      const frame = ellipseFrameForHandle(
        element as unknown as SelectionElementLike,
        edge,
        point,
      );
      const nextElement = newElementWith(element, frame);
      globalHistoryScenePreviewRef.current = !commit;
      if (commit) {
        queueGlobalHistoryCommit("host", "region-ellipse");
      }
      api.updateScene({
        elements: api
          .getSceneElementsIncludingDeleted()
          .map((candidate) =>
            candidate.id === element.id ? nextElement : candidate,
          ),
        captureUpdate: commit
          ? CaptureUpdateAction.IMMEDIATELY
          : CaptureUpdateAction.NEVER,
      });
      if (!commit) {
        window.setTimeout(() => {
          globalHistoryScenePreviewRef.current = false;
        }, 0);
      }
    },
    [api, queueGlobalHistoryCommit],
  );

  const selectedRegion = selectedRegionId
    ? business.regions[selectedRegionId] ?? null
    : null;
  const boundImageId = selectedImageId ?? selectedRegion?.imageId ?? null;
  const boundImage = boundImageId
    ? business.imageAssets[boundImageId] ?? null
    : null;
  const selectedAnnotation = useMemo(
    () => findActiveAnnotationForRegion(business, selectedRegionId),
    [business, selectedRegionId],
  );
  const activeFolderScopeId = folderScopeId(
    folderNavigation,
    migrateBusinessStateToV2(business),
  );
  const focusedImageIds = useMemo(
    () =>
      normalizeFocusedImageIds(business, focusImageIds, activeFolderScopeId),
    [activeFolderScopeId, business, focusImageIds],
  );
  const selectedCanvasImage = selectedCanvasImageId
    ? business.imageAssets[selectedCanvasImageId] ?? null
    : null;
  const contextInformationData = useMemo(() => {
    const selectionTarget = resolveContextInformationSelection({
      selection: canvasSelection,
      imageIdByPlacementId: Object.fromEntries(
        Object.values(business.imagePlacements).map((placement) => [
          placement.id,
          placement.imageId,
        ]),
      ),
      imageLayerId:
        folderNavigation.layer === "image" ? folderNavigation.imageId : null,
      selectedRegionImageId: selectedRegion?.imageId ?? null,
    });

    // While the description workspace is open, image/region selection is
    // represented by the bottom context prompt. Keep the independent image
    // metadata panel out of the editor's lower-right content area.
    if (isDescriptionWorkspaceOpen && selectionTarget.kind === "image") {
      return null;
    }

    if (selectionTarget.kind === "selection") return selectionTarget;

    const description =
      selectionTarget.kind === "description"
        ? business.descriptions[selectionTarget.descriptionId]
        : null;
    if (description) {
      const linkedRegions = Object.values(business.descriptionScopeLinks).filter(
        (link) => link.descriptionId === description.id,
      );
      return {
        kind: "description" as const,
        description,
        linkedRegionCount: linkedRegions.length,
      };
    }

    const imageId =
      selectionTarget.kind === "image" ? selectionTarget.imageId : null;
    const image = imageId ? business.imageAssets[imageId] : null;
    if (image) {
      const relatedDescriptionIds = new Set(
        Object.values(business.descriptionScopeLinks).flatMap((link) =>
          business.regions[link.regionId]?.imageId === image.id
            ? [link.descriptionId]
            : [],
        ),
      );
      return {
        kind: "image" as const,
        image,
        dataURL: latestFilesRef.current[image.fileId]?.dataURL,
        relatedDescriptionCount: relatedDescriptionIds.size,
      };
    }

    const scopedBusiness = migrateBusinessStateToV2(business);
    const folderId =
      folderNavigation.layer === "overview"
        ? scopedBusiness.rootFolderId
        : folderNavigation.selectedFolderId;
    const folder = scopedBusiness.folders[folderId];
    return folder
      ? { kind: "folder" as const, folder }
      : null;
  }, [business, canvasSelection, folderNavigation, isDescriptionWorkspaceOpen, selectedRegion]);

  useEffect(() => {
    if (
      isDescriptionWorkspaceOpen &&
      (!activeDescriptionId || !business.descriptions[activeDescriptionId])
    ) {
      setIsDescriptionWorkspaceOpen(false);
      setDescriptionEditorFocusId(null);
    }
  }, [activeDescriptionId, business.descriptions, isDescriptionWorkspaceOpen]);

  useEffect(() => {
    setFocusImageIds((current) => {
      const normalized = normalizeFocusedImageIds(
        business,
        current,
        activeFolderScopeId,
      );
      return didFocusedImageIdsChange(current, normalized) ? normalized : current;
    });
  }, [business]);

  const addSelectedImageToFocus = useCallback(() => {
    if (!selectedCanvasImageId || !selectedCanvasImage) {
      setStatus("请直接选中一张图片后，再设为本次重点。");
      return;
    }
    if (focusedImageIds.includes(selectedCanvasImageId)) {
      setStatus(`“${selectedCanvasImage.name}”已是本次重点。`);
      return;
    }
    if (focusedImageIds.length >= focusedPublishLimits.maxImages) {
      setStatus(
        `本次最多可设 ${focusedPublishLimits.maxImages} 张重点图片；请先移除一张后再添加。`,
      );
      return;
    }
    setFocusImageIds((current) =>
      addFocusedImage(current, selectedCanvasImageId),
    );
    setCodexContext(null);
    setStatus(`已将“${selectedCanvasImage.name}”设为本次重点。`);
  }, [focusedImageIds, selectedCanvasImage, selectedCanvasImageId]);

  const removeImageFromFocus = useCallback(
    (imageId: string) => {
      const imageName = business.imageAssets[imageId]?.name ?? imageId;
      setFocusImageIds((current) => removeFocusedImage(current, imageId));
      setCodexContext(null);
      setStatus(`已从本次重点移除“${imageName}”。`);
    },
    [business.imageAssets],
  );

  useEffect(() => {
    setAnnotationText(
      selectedBubbleAnnotation?.text ??
        (selectedSelectionElement
          ? selectedSelectionInstruction ?? ""
          : selectedAnnotation?.text ?? ""),
    );
    setCodexContext(null);
  }, [
    selectedBubbleAnnotation?.bubbleId,
    selectedBubbleAnnotation?.regionId,
    selectedBubbleAnnotation?.text,
    selectedAnnotation?.id,
    selectedAnnotation?.text,
    selectedSelectionElement,
    selectedSelectionInstruction,
    selectedRegionId,
  ]);

  useEffect(() => {
    saveWorkbenchPreferences(workbenchPreferences);
  }, [workbenchPreferences]);

  useEffect(() => {
    if (workbenchPreferences.canvasTheme !== "black") {
      lastLightCanvasThemeRef.current = workbenchPreferences.canvasTheme;
    }
  }, [workbenchPreferences.canvasTheme]);

  const saveSelectionInstruction = useCallback(() => {
    if (!api || !selectedRegionId || !selectedSelectionElement) {
      setStatus("请先选中一个选区。");
      return;
    }
    const text = annotationText.trim();
    const sceneElement = selectedSelectionElement as unknown as ExcalidrawElement;
    const nextElement = newElementWith(sceneElement, {
      customData: {
        ...(selectedSelectionElement.customData ?? {}),
        selectionInstruction: annotationText,
        selectionInstructionStatus: text ? "filled" : "unfilled",
      },
    });
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((element) =>
          element.id === sceneElement.id ? nextElement : element,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setCodexContext(null);
    setStatus(text ? "选区修改指令已保存。" : "选区指令状态已保存为未填写。");
  }, [annotationText, api, selectedRegionId, selectedSelectionElement]);

  const selectAdjacentImageSelection = useCallback(
    (offset: -1 | 1) => {
      if (!selectedRegionId || selectedImageSelections.length < 2) {
        return;
      }
      const currentIndex = selectedImageSelections.findIndex(
        (selection) => selection.regionId === selectedRegionId,
      );
      if (currentIndex < 0) {
        return;
      }
      const nextIndex =
        (currentIndex + offset + selectedImageSelections.length) %
        selectedImageSelections.length;
      handleSelectionRegionSelect(selectedImageSelections[nextIndex].regionId);
    },
    [handleSelectionRegionSelect, selectedImageSelections, selectedRegionId],
  );

  const saveAnnotation = useCallback(() => {
    if (!api || (!selectedRegionId && !selectedBubbleAnnotation)) {
      setStatus("请先选中一个标注选区。");
      return;
    }
    const allElements = api.getSceneElementsIncludingDeleted();
    if (selectedBubbleAnnotation) {
      const bubbleText = allElements.find(
        (element): element is Ordered<ExcalidrawTextElement> =>
          !element.isDeleted &&
          element.type === "text" &&
          element.customData?.kind === BUBBLE_TEXT_KIND &&
          bubbleIdOf(element) === selectedBubbleAnnotation.bubbleId,
      );
      if (!bubbleText) {
        setStatus("选中的批注气泡缺少可编辑文字，无法同步修改指令。");
        return;
      }
      const hasInstruction = Boolean(annotationText.trim());
      const annotationElement = newElementWith(bubbleText, {
        text: hasInstruction ? annotationText : BUBBLE_CARD_PLACEHOLDER,
        customData: {
          ...bubbleText.customData,
          placeholder: hasInstruction ? "false" : "true",
        },
      });
      const bubbleRegionId = selectedBubbleAnnotation.regionId;
      if (bubbleRegionId) {
        const existing = Object.values(businessRef.current.annotations).find(
          (annotation) =>
            annotation.regionId === bubbleRegionId,
        );
        const annotationId = existing?.id ?? stableId("annotation");
        commitBusiness((current) => ({
          ...current,
          document: {
            ...current.document,
            annotationIds: appendUnique(
              current.document.annotationIds,
              annotationId,
            ),
          },
          annotations: {
            ...current.annotations,
            [annotationId]: {
              id: annotationId,
              regionId: bubbleRegionId,
              elementId: annotationElement.id,
              text: annotationText,
              active: true,
            },
          },
        }));
      }
      api.updateScene({
        elements: allElements.map((element) =>
          element.id === bubbleText.id ? annotationElement : element,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setSelectedBubbleAnnotation({
        ...selectedBubbleAnnotation,
        text: annotationText,
      });
      setStatus("修改指令已同步到批注气泡。");
      return;
    }
    if (!selectedRegionId) {
      setStatus("请先选中一个标注选区。");
      return;
    }
    const existing = Object.values(businessRef.current.annotations).find(
      (annotation) => annotation.regionId === selectedRegionId,
    );
    const annotationId = existing?.id ?? stableId("annotation");
    const regionElement = api
      .getSceneElements()
      .find((element) => element.id === businessRef.current.regions[selectedRegionId]?.elementId);
    if (!regionElement) {
      setStatus("选中的标注选区不存在，无法同步修改指令。");
      return;
    }
    const existingCard = allElements.find(
      (element) =>
        !element.isDeleted &&
        element.customData?.kind === "annotation-card" &&
        associatedRegionId(element) === selectedRegionId,
    );
    const existingText = allElements.find(
      (element): element is Ordered<ExcalidrawTextElement> =>
        !element.isDeleted &&
        element.type === "text" &&
        element.customData?.kind === "annotation" &&
        associatedRegionId(element) === selectedRegionId,
    );
    const hasInstruction = Boolean(annotationText.trim());
    const textForCard = hasInstruction
      ? annotationText
      : ANNOTATION_CARD_PLACEHOLDER;
    const replacementCard =
      existingCard && existingText
        ? null
        : createAnnotationCardElements({
            annotationId,
            regionId: selectedRegionId,
            selection: annotationBounds(regionElement),
            text: annotationText,
          });
    const annotationElement =
      existingCard && existingText
        ? newElementWith(existingText, {
            text: textForCard,
            strokeColor: getReadableTextColor(existingCard.backgroundColor),
            customData: {
              ...existingText.customData,
              annotationId,
              regionId: selectedRegionId,
              placeholder: hasInstruction ? "false" : "true",
            },
          })
        : replacementCard!.text;
    const elements = allElements.map((element) => {
      if (existingCard && existingText && element.id === existingText.id) {
        return annotationElement;
      }
      if (
        (!existingCard || !existingText) &&
        isAnnotationCardPart(element, selectedRegionId)
      ) {
        return newElementWith(element, { isDeleted: true });
      }
      return element;
    });

    commitBusiness((current) => ({
      ...current,
      document: {
        ...current.document,
        annotationIds: appendUnique(
          current.document.annotationIds,
          annotationId,
        ),
      },
      annotations: {
        ...current.annotations,
        [annotationId]: {
          id: annotationId,
          regionId: selectedRegionId,
          elementId: annotationElement.id,
          text: annotationText,
          active: true,
        },
      },
    }));
    api.updateScene({
      elements: replacementCard
        ? [
            ...elements,
            replacementCard.leader,
            replacementCard.card,
            replacementCard.text,
          ]
        : elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setStatus("修改指令已同步到画布标注卡。");
  }, [
    annotationText,
    api,
    commitBusiness,
    selectedBubbleAnnotation,
    selectedRegionId,
  ]);

  const saveMockAnswer = useCallback(() => {
    if (!selectedRegionId) {
      setStatus("请先选中一个 ROI。");
      return;
    }
    const exchangeId = stableId("ai");
    commitBusiness((current) => ({
      ...current,
      document: {
        ...current.document,
        aiExchangeIds: appendUnique(
          current.document.aiExchangeIds,
          exchangeId,
        ),
      },
      aiExchanges: {
        ...current.aiExchanges,
        [exchangeId]: {
          id: exchangeId,
          regionId: selectedRegionId,
          question: annotationText,
          answer: mockAnswer,
          provider: "local-mock",
          status: "completed",
          createdAt: new Date().toISOString(),
        },
      },
    }));
    setStatus("本地模拟 AI 回答已保存；未调用任何真实 AI 服务。");
  }, [
    annotationText,
    commitBusiness,
    mockAnswer,
    selectedRegionId,
  ]);

  const deleteRegionSelection = useCallback((regionId: string) => {
    if (!api) {
      return;
    }
    const region = businessRef.current.regions[regionId];
    const regionElement = api
      .getSceneElements()
      .find((element) => element.id === region?.elementId);
    if (!regionElement) {
      setStatus("选中的标注选区不存在，无法删除。");
      return;
    }
    commitBusiness((current) => removeRegionSelection(current, regionId));
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((element) =>
          associatedRegionId(element) === regionId
            ? newElementWith(element, { isDeleted: true })
            : element,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setSelectedRegionId(null);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setAnnotationText("");
    setCodexContext(null);
    setStatus("当前选区已删除；关联说明保留，仅移除此范围关系。");
  }, [api, commitBusiness, updateCanvasSelection]);

  const deleteSelectedRegion = useCallback(() => {
    if (!selectedRegionId) {
      setStatus("请先选中一个标注选区。");
      return;
    }
    deleteRegionSelection(selectedRegionId);
  }, [deleteRegionSelection, selectedRegionId]);

  const enterFolder = useCallback((folderId: string) => {
    const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
    if (!scopedBusiness.folders[folderId] || folderId === scopedBusiness.rootFolderId) {
      setStatus("目标文件夹不存在，未进入。");
      return;
    }
    if (
      folderNavigationRef.current.layer === "overview" ||
      !folderParentViewportRef.current
    ) {
      folderParentViewportRef.current = canvasViewport;
    }
    const next: FolderNavigationState = {
      layer: "folder",
      selectedFolderId: folderId,
    };
    clearFolderPreviewMotion();
    folderNavigationRef.current = next;
    setFolderNavigation(next);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setSelectedImageId(null);
    setSelectedCanvasImageId(null);
    setSelectedRegionId(null);
    setActiveDescriptionId(null);
    setDescriptionEditorFocusId(null);
    setIsDescriptionWorkspaceOpen(false);
    setStatus("已进入文件夹；图片与说明保持同级自由对象。");
    const ids = new Set(folderSceneElementIds(scopedBusiness, folderId));
    const elements = latestElementsRef.current.filter(
      (element) => ids.has(element.id) && !element.isDeleted,
    );
    const savedViewport = folderViewportRef.current[folderId];
    if (savedViewport && api) {
      pendingFolderViewportRestoreRef.current = {
        folderId,
        viewport: savedViewport,
      };
    } else {
      pendingFolderViewportRestoreRef.current = null;
      if (elements.length > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollElementsAtCurrentZoom(elements);
          });
        });
      }
    }
  }, [api, canvasViewport, clearFolderPreviewMotion, scrollElementsAtCurrentZoom, updateCanvasSelection]);

  const returnFromFolderLayer = useCallback(() => {
    const current = folderNavigationRef.current;
    focusedImageFitCancelRef.current?.();
    clearFolderPreviewMotion();
    if (current.layer === "image" || current.layer === "description") {
      const next: FolderNavigationState =
        current.selectedFolderId === ROOT_FOLDER_ID
          ? { layer: "overview", selectedFolderId: null }
          : { layer: "folder", selectedFolderId: current.selectedFolderId };
      folderNavigationRef.current = next;
      setFolderNavigation(next);
      setSelectedImageId(null);
      setSelectedCanvasImageId(null);
      setActiveDescriptionId(null);
      updateCanvasSelection(EMPTY_CANVAS_SELECTION);
      const viewport = folderDetailParentViewportRef.current;
      folderDetailParentViewportRef.current = null;
      if (viewport && api) {
        api.updateScene({
          appState: {
            zoom: { value: viewport.zoom } as AppState["zoom"],
            scrollX: viewport.scrollX,
            scrollY: viewport.scrollY,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      setStatus(
        next.layer === "overview" ? "已返回父级画布。" : "已返回文件夹内部。",
      );
      return;
    }
    const next: FolderNavigationState = {
      layer: "overview",
      selectedFolderId: null,
    };
    if (current.layer === "folder") {
      folderViewportRef.current[current.selectedFolderId] = canvasViewport;
    }
    folderNavigationRef.current = next;
    setFolderNavigation(next);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    const viewport = folderParentViewportRef.current;
    folderParentViewportRef.current = null;
    if (viewport && api) {
      api.updateScene({
        appState: {
          zoom: { value: viewport.zoom } as AppState["zoom"],
          scrollX: viewport.scrollX,
          scrollY: viewport.scrollY,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    setStatus("已返回父级画布并恢复进入前视窗。");
  }, [api, canvasViewport, clearFolderPreviewMotion, updateCanvasSelection]);

  const scheduleFocusedImageViewportFit = useCallback(
    (image: ExcalidrawElement) => {
      if (!api) return;
      focusedImageFitCancelRef.current?.();
      let cancelled = false;
      let frame: number | null = null;
      let attempts = 0;
      const stop = () => {
        cancelled = true;
        if (frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
        if (focusedImageFitCancelRef.current === stop) {
          focusedImageFitCancelRef.current = null;
        }
      };
      const fit = () => {
        if (cancelled) return;
        const panel = canvasPanelRef.current;
        const bounds = panel?.getBoundingClientRect();
        const appState = api.getAppState();
        if (
          (!bounds ||
            bounds.width <= 0 ||
            bounds.height <= 0 ||
            appState.width <= 0 ||
            appState.height <= 0) &&
          attempts < 8
        ) {
          attempts += 1;
          frame = requestAnimationFrame(fit);
          return;
        }
        const measuredViewport = resolveMeasuredViewportSize({
          viewportWidth: bounds?.width,
          viewportHeight: bounds?.height,
          fallbackWidth: window.innerWidth,
          fallbackHeight: window.innerHeight,
        });
        const statusPanelBounds = panel
          ?.querySelector<HTMLElement>(".context-information")
          ?.getBoundingClientRect();
        const viewportPlan = imageDetailViewportPlan({
          viewportWidth: measuredViewport.width,
          viewportHeight: measuredViewport.height,
          statusPanelLeft:
            bounds && statusPanelBounds
              ? statusPanelBounds.left - bounds.left
              : undefined,
          statusPanelGap: 16,
        });
        api.scrollToContent(image, {
          fitToViewport: true,
          viewportZoomFactor: viewportPlan.viewportZoomFactor,
          animate: false,
          canvasOffsets: viewportPlan.canvasOffsets,
        });
        focusedImageFitCancelRef.current = null;
      };
      focusedImageFitCancelRef.current = stop;
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        frame = requestAnimationFrame(fit);
      });
    },
    [api],
  );

  const enterSelectedCanvasObject = useCallback(
    (nativeImageIdOverride: string | null = null) => {
    const scopedBusiness = migrateBusinessStateToV2(businessRef.current);
    const current = folderNavigationRef.current;
    if (current.layer === "preview") {
      enterFolder(current.selectedFolderId);
      return;
    }
    if (current.layer !== "overview" && current.layer !== "folder") return;
    const parentFolderId =
      current.layer === "folder"
        ? current.selectedFolderId
        : scopedBusiness.rootFolderId;
    const selectedPlacementId =
      canvasSelectionRef.current.imagePlacementIds[0] ?? null;
    const selectedPlacementImageId = selectedPlacementId
      ? scopedBusiness.imagePlacements[selectedPlacementId]?.imageId ?? null
      : null;
    const imageEntryId = resolveCanvasImageEntryId({
      selectedCanvasImageId,
      selectedPlacementImageId,
      selectedNativeImageId: nativeImageIdOverride,
    });
    if (
      imageEntryId &&
      scopedBusiness.imageAssets[imageEntryId]?.folderId === parentFolderId
    ) {
      folderDetailParentViewportRef.current = canvasViewport;
      const next: FolderNavigationState = {
        layer: "image",
        selectedFolderId: parentFolderId,
        imageId: imageEntryId,
      };
      folderNavigationRef.current = next;
      setFolderNavigation(next);
      updateCanvasSelection(EMPTY_CANVAS_SELECTION);
      setSelectedImageId(imageEntryId);
      setSelectedCanvasImageId(null);
      setSelectedRegionId(null);
      setActiveDescriptionId(null);
      setDescriptionEditorFocusId(null);
      setIsDescriptionWorkspaceOpen(false);
      setStatus("已进入图片专注态；返回将恢复直接父层。");
      const image = latestElementsRef.current.find(
        (element) =>
          !element.isDeleted &&
          element.type === "image" &&
          element.customData?.imageId === imageEntryId,
      );
      if (image && api) {
        scheduleFocusedImageViewportFit(image);
      }
      return;
    }
  }, [
    api,
    canvasViewport,
    enterFolder,
    scheduleFocusedImageViewportFit,
    selectedCanvasImageId,
    updateCanvasSelection,
  ]);

  const createFolderFromSelection = useCallback(() => {
    if (!api || folderNavigationRef.current.layer !== "overview") return;
    const current = migrateBusinessStateToV2(businessRef.current);
    const selectedImageIds = canvasSelectionRef.current.imagePlacementIds.flatMap(
      (placementId) => {
        const imageId = current.imagePlacements[placementId]?.imageId;
        return imageId ? [imageId] : [];
      },
    );
    const selectedDescriptionIds = canvasSelectionRef.current.descriptionIds;
    const hasNonRootSelection =
      selectedImageIds.some(
        (imageId) => current.imageAssets[imageId]?.folderId !== current.rootFolderId,
      ) ||
      selectedDescriptionIds.some(
        (descriptionId) =>
          current.descriptions[descriptionId]?.folderId !== current.rootFolderId,
      );
    if (hasNonRootSelection) {
      setStatus("只能把父级画布中的直接对象组合为文件夹。");
      return;
    }
    const folderId = stableId("folder");
    const centerX = -canvasViewport.scrollX + 180 / canvasViewport.zoom;
    const centerY = -canvasViewport.scrollY + 150 / canvasViewport.zoom;
    queueGlobalHistoryCommit("host", "folder-create");
    let created = createVisibleFolder({
      business: current,
      elements: latestElementsRef.current,
      folderId,
      name: `文件夹 ${Object.keys(current.folders).length}`,
      x: centerX,
      y: centerY,
    });
    if (selectedImageIds.length > 0 || selectedDescriptionIds.length > 0) {
      const reparented = reparentDirectObjects({
        business: created.business,
        targetFolderId: folderId,
        imageIds: selectedImageIds,
        descriptionIds: selectedDescriptionIds,
      });
      created = synchronizeEmptyFolderCovers({
        business: reparented,
        elements: stampSceneFolderOwnership({
          business: reparented,
          elements: created.elements,
        }),
      });
    }
    latestElementsRef.current = created.elements;
    commitBusiness(created.business, "folder-create", false);
    renderCanonicalScene({
      canonical: created.elements,
      ownerState: created.business,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setStatus(
      selectedImageIds.length + selectedDescriptionIds.length > 0
        ? "已将所选直接对象原子组合为文件夹。"
        : "已建立可移动、可保存的空文件夹。",
    );
  }, [
    api,
    canvasViewport.scrollX,
    canvasViewport.scrollY,
    canvasViewport.zoom,
    commitBusiness,
    queueGlobalHistoryCommit,
    renderCanonicalScene,
    updateCanvasSelection,
  ]);

  const moveFolder = useCallback((folderId: string, dx: number, dy: number) => {
    if (!api || (dx === 0 && dy === 0)) return;
    const current = migrateBusinessStateToV2(businessRef.current);
    queueGlobalHistoryCommit("host", "folder-move");
    const moved = moveFolderContents({
      business: current,
      elements: latestElementsRef.current,
      folderId,
      dx,
      dy,
    });
    latestElementsRef.current = moved.elements;
    commitBusiness(moved.business, "folder-move", false);
    renderCanonicalScene({
      canonical: moved.elements,
      ownerState: moved.business,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setStatus("文件夹已移动；拖动过程中仅使用临时反馈，松手后提交一次完整 scene。 ");
  }, [api, commitBusiness, queueGlobalHistoryCommit, renderCanonicalScene]);

  const resetFolderNavigationAfterRemoval = useCallback(() => {
    const next: FolderNavigationState = {
      layer: "overview",
      selectedFolderId: null,
    };
    folderNavigationRef.current = next;
    setFolderNavigation(next);
    folderParentViewportRef.current = null;
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
  }, [updateCanvasSelection]);

  const deleteFolder = useCallback(async (folderId: string) => {
    if (!api || busy || businessNoticeRef.current) return;
    let current = migrateBusinessStateToV2(businessRef.current);
    let folder = current.folders[folderId];
    if (!folder || folder.kind !== "folder") {
      setStatus("目标文件夹不存在，未执行删除。");
      return;
    }
    let hasContents = folder.imageAssetIds.length + folder.descriptionIds.length > 0;
    if (hasContents && !await showBusinessNotice({ title: "删除文件夹",
      message: `删除“${folder.name}”及其中全部图片与说明？此操作可撤销。`,
      confirmLabel: "删除", cancelLabel: "取消", danger: true })) {
      setStatus("已取消删除非空文件夹。");
      return;
    }
    current = migrateBusinessStateToV2(businessRef.current);
    folder = current.folders[folderId];
    if (!folder || folder.kind !== "folder" || pendingSavedRestoreRef.current || clipboardBusyRef.current) {
      setStatus("目标正在变化，尚未删除文件夹。"); return;
    }
    hasContents = folder.imageAssetIds.length + folder.descriptionIds.length > 0;
    queueGlobalHistoryCommit("host", "folder-delete");
    const removed = hasContents
      ? deleteVisibleFolderWithContents({
          business: current,
          elements: latestElementsRef.current,
          folderId,
        })
      : removeVisibleFolderPreservingContents({
          business: current,
          elements: latestElementsRef.current,
          folderId,
        });
    latestElementsRef.current = removed.elements;
    commitBusiness(removed.business, "folder-delete", false);
    renderCanonicalScene({
      canonical: removed.elements,
      ownerState: removed.business,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    resetFolderNavigationAfterRemoval();
    setStatus(hasContents ? "文件夹及其全部内容已删除；可用撤销恢复。" : "空文件夹已删除。");
  }, [api, busy, showBusinessNotice, commitBusiness, queueGlobalHistoryCommit, renderCanonicalScene, resetFolderNavigationAfterRemoval]);

  const ungroupFolder = useCallback((folderId: string) => {
    if (!api) return;
    const current = migrateBusinessStateToV2(businessRef.current);
    const folder = current.folders[folderId];
    if (!folder || folder.kind !== "folder") return;
    queueGlobalHistoryCommit("host", "folder-ungroup");
    const removed = removeVisibleFolderPreservingContents({
      business: current,
      elements: latestElementsRef.current,
      folderId,
    });
    latestElementsRef.current = removed.elements;
    commitBusiness(removed.business, "folder-ungroup", false);
    renderCanonicalScene({
      canonical: removed.elements,
      ownerState: removed.business,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    resetFolderNavigationAfterRemoval();
    setStatus("文件夹已解组；图片与说明完整保留在父级画布。");
  }, [api, commitBusiness, queueGlobalHistoryCommit, renderCanonicalScene, resetFolderNavigationAfterRemoval]);

  const handleCanvasDoubleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          ".folder-workspace-layer, textarea, input, button, a, [contenteditable='true']",
        )
      ) {
        return;
      }
      const appState = api?.getAppState();
      const hitImageId = appState && api
        ? hitTestCanvasImageEntry(
            { x: event.clientX, y: event.clientY },
            api.getSceneElements().flatMap((element) => {
              if (
                element.type !== "image" ||
                element.isDeleted ||
                folderProjectionRef.current?.hiddenElementIds.has(element.id) ||
                typeof element.customData?.imageId !== "string"
              ) {
                return [];
              }
              const topLeft = sceneCoordsToViewportCoords(
                { sceneX: element.x, sceneY: element.y },
                appState,
              );
              const bottomRight = sceneCoordsToViewportCoords(
                {
                  sceneX: element.x + element.width,
                  sceneY: element.y + element.height,
                },
                appState,
              );
              return [{
                imageId: element.customData.imageId,
                bounds: {
                  left: Math.min(topLeft.x, bottomRight.x),
                  top: Math.min(topLeft.y, bottomRight.y),
                  right: Math.max(topLeft.x, bottomRight.x),
                  bottom: Math.max(topLeft.y, bottomRight.y),
                },
              }];
            }),
          )
        : null;
      if (shouldClaimCanvasImageDoubleClick({
        layer: folderNavigationRef.current.layer,
        selectedCanvasImageId: hitImageId,
      })) {
        event.preventDefault();
        event.stopPropagation();
        enterSelectedCanvasObject(hitImageId);
      }
    },
    [api, enterSelectedCanvasObject],
  );

  const folderWorkspaceItems = useMemo(() => {
    const scopedBusiness = migrateBusinessStateToV2(business);
    return Object.values(scopedBusiness.folders).flatMap((folder) => {
      if (folder.kind === "root") return [];
      const bounds = folderSceneBounds(
        scopedBusiness,
        latestElementsRef.current,
        folder.id,
      );
      const firstImageId = folder.imageAssetIds[0];
      const firstImageFileId = firstImageId
        ? scopedBusiness.imageAssets[firstImageId]?.fileId
        : undefined;
      const previewImageUrl = firstImageFileId
        ? latestFilesRef.current[firstImageFileId]?.dataURL
        : undefined;
      return bounds
        ? [{ folder, bounds: compactFolderSurfaceBounds(bounds), previewImageUrl }]
        : [];
    });
  }, [activeFolderScopeId, business]);

  const folderPreviewStage = useMemo<FolderPreviewStage | null>(() => {
    if (folderNavigation.layer !== "preview") return null;
    const previewPanel = canvasPanelRef.current;
    const previewViewport: FolderPreviewViewport = {
      width: previewPanel?.clientWidth ?? window.innerWidth,
      height: previewPanel?.clientHeight ?? window.innerHeight,
      ...canvasViewport,
    };
    return folderPreviewLayout(
      migrateBusinessStateToV2(business),
      latestElementsRef.current,
      folderNavigation.selectedFolderId,
      previewViewport,
    ).stage;
  }, [business, canvasViewport, folderNavigation]);

  const folderPreviewCoverBounds = useMemo<FolderSceneBounds | null>(() => {
    if (folderNavigation.layer !== "preview") return null;
    const previewPanel = canvasPanelRef.current;
    const previewViewport: FolderPreviewViewport = {
      width: previewPanel?.clientWidth ?? window.innerWidth,
      height: previewPanel?.clientHeight ?? window.innerHeight,
      ...canvasViewport,
    };
    return folderPreviewLayout(
      migrateBusinessStateToV2(business),
      latestElementsRef.current,
      folderNavigation.selectedFolderId,
      previewViewport,
    ).previewCoverBounds ?? null;
  }, [business, canvasViewport, folderNavigation]);

  const folderDescriptionItems = useMemo(
    () => {
      const previewPanel = canvasPanelRef.current;
      const previewViewport: FolderPreviewViewport | undefined =
        folderNavigation.layer === "preview"
          ? {
              width: previewPanel?.clientWidth ?? window.innerWidth,
              height: previewPanel?.clientHeight ?? window.innerHeight,
              ...canvasViewport,
            }
          : undefined;
      const previewLayout =
        folderNavigation.layer === "preview"
          ? folderPreviewLayout(
              migrateBusinessStateToV2(business),
              latestElementsRef.current,
              folderNavigation.selectedFolderId,
              previewViewport,
            )
          : null;
      return activeDescriptionEntries(descriptionPresentationBusiness).map(
        ({ description, reference }, index) => {
          const folderId = description.folderId ?? ROOT_FOLDER_ID;
          const previewed =
            folderNavigation.layer === "preview" &&
            folderId === folderNavigation.selectedFolderId;
          const previewPlacement = previewed
            ? previewLayout?.descriptionPlacements?.[description.id]
            : undefined;
          return {
            id: description.id,
            folderId,
            label: `说明 ${index + 1}`,
            text: description.text,
            anchor: previewed
              ? previewPlacement
                ? { x: previewPlacement.x, y: previewPlacement.y }
                : {
                    x:
                      reference.anchor.x * (previewLayout?.scale ?? 1) +
                      (previewLayout?.offsetX ?? 0),
                    y:
                      reference.anchor.y * (previewLayout?.scale ?? 1) +
                      (previewLayout?.offsetY ?? 0),
                  }
              : reference.anchor,
            previewScale: previewed
              ? previewPlacement?.scale ?? previewLayout?.scale
              : undefined,
            previewWidth: previewed ? previewPlacement?.width : undefined,
            previewHeight: previewed ? previewPlacement?.height : undefined,
            previewAngle: previewed ? previewPlacement?.angle : undefined,
          };
        },
      );
    },
    [business, canvasViewport, descriptionPresentationBusiness, folderNavigation],
  );

  const folderPreviewMotionState = useMemo<FolderPreviewMotionState | null>(() => {
    const motion = folderPreviewMotion;
    if (
      !motion ||
      folderNavigation.layer !== "preview" ||
      folderNavigation.selectedFolderId !== motion.folderId
    ) {
      return null;
    }
    const scopedBusiness = migrateBusinessStateToV2(business);
    const folder = scopedBusiness.folders[motion.folderId];
    const previewPanel = canvasPanelRef.current;
    const previewViewport: FolderPreviewViewport = {
      width: previewPanel?.clientWidth ?? window.innerWidth,
      height: previewPanel?.clientHeight ?? window.innerHeight,
      ...canvasViewport,
    };
    const layout = folder
      ? folderPreviewLayout(
          scopedBusiness,
          latestElementsRef.current,
          motion.folderId,
          previewViewport,
        )
      : null;
    if (!folder || !layout) return null;
    const images = layout.slots?.flatMap((slot) => {
      const element = slot.element;
      const imageId =
        element?.type === "image" && typeof element.customData?.imageId === "string"
          ? element.customData.imageId
          : null;
      const image = imageId ? scopedBusiness.imageAssets[imageId] : undefined;
      const imageUrl = image?.fileId
        ? latestFilesRef.current[image.fileId]?.dataURL
        : undefined;
      if (!element || !imageId || !slot.imageRect || !imageUrl) return [];
      return [{
        id: imageId,
        imageUrl,
        target: slot.imageRect,
      }];
    }) ?? [];
    const descriptions = layout.slots?.flatMap((slot) => {
      if (!slot.descriptionId || !slot.descriptionRect) return [];
      const description = folderDescriptionItems.find(
        (candidate) => candidate.id === slot.descriptionId,
      );
      if (!description) return [];
      return [{
        id: description.id,
        label: description.label,
        text: description.text,
        target: {
          x: slot.descriptionRect.x,
          y: slot.descriptionRect.y,
          width: slot.descriptionRect.width,
          height: slot.descriptionRect.height,
          scale: slot.descriptionRect.scale,
          angle: slot.descriptionRect.angle,
        },
      }];
    }) ?? [];
    if (images.length === 0 && descriptions.length === 0) return null;
    return {
      folderId: motion.folderId,
      images,
      descriptions,
    };
  }, [business, canvasViewport, folderDescriptionItems, folderNavigation, folderPreviewMotion]);

  const previewSelectionMotion = useMemo(() => {
    if (
      folderNavigation.layer !== "preview" ||
      !folderPreviewMotionState ||
      folderPreviewMotionState.images.length === 0
    ) {
      return null;
    }
    const motionFolder = folderWorkspaceItems.find(
      ({ folder }) => folder.id === folderPreviewMotionState.folderId,
    );
    const sourceBounds = folderPreviewCoverBounds ?? motionFolder?.bounds;
    const panel = canvasPanelRef.current;
    if (!sourceBounds || !panel) return null;
    return {
      sourceRect: folderWorkspaceViewportRect(
        sourceBounds,
        canvasViewport,
        panel.getBoundingClientRect(),
      ),
      imageIds: new Set(folderPreviewMotionState.images.map((image) => image.id)),
      targets: new Map(
        folderPreviewMotionState.images.map((image) => [
          image.id,
          folderWorkspaceViewportRect(image.target, canvasViewport, panel.getBoundingClientRect()),
        ]),
      ),
    };
  }, [
    canvasViewport,
    folderNavigation.layer,
    folderPreviewCoverBounds,
    folderPreviewMotionState,
    folderWorkspaceItems,
  ]);

  const selectDescriptionObject = useCallback(
    (descriptionId: string) => {
      if (!businessRef.current.descriptions[descriptionId]) return;
      setActiveDescriptionId(descriptionId);
      setSelectedImageId(null);
      setSelectedCanvasImageId(null);
      setSelectedRegionId(null);
      updateCanvasSelection(createCanvasSelection({ descriptionIds: [descriptionId] }));
      if (folderNavigationRef.current.layer === "preview") {
        setDescriptionEditorFocusId(null);
        setIsDescriptionWorkspaceOpen(false);
        setStatus("Preview 为只读状态；说明内容仅作展示。");
        return;
      }
      setDescriptionEditorFocusId(null);
      setIsDescriptionWorkspaceOpen(true);
      setWorkbenchPreferences((current) => ({
        ...current,
        contextPanelOpen: false,
      }));
      setStatus("说明编辑器已在当前画布层级内展开。");
    },
    [updateCanvasSelection],
  );

  const restoreMixedDescriptionDragPreview = useCallback((): boolean => {
    const gesture = mixedDescriptionDragRef.current;
    if (!gesture || !api) return false;
    mixedDescriptionDragRef.current = null;
    businessRef.current = gesture.snapshot.business;
    setBusiness(gesture.snapshot.business);
    latestElementsRef.current = gesture.snapshot.scene;
    globalHistoryScenePreviewRef.current = true;
    renderCanonicalScene({
      canonical: gesture.snapshot.scene,
      ownerState: gesture.snapshot.business,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    window.setTimeout(() => {
      globalHistoryScenePreviewRef.current = false;
    }, 0);
    return true;
  }, [api, renderCanonicalScene]);

  const moveDescriptionObject = useCallback(
    (
      descriptionId: string,
      dx: number,
      dy: number,
      targetFolderId: string | null,
    ): boolean => {
      if (targetFolderId) {
        const current = migrateBusinessStateToV2(businessRef.current);
        const reference = Object.values(current.descriptionReferences).find(
          (candidate) =>
            candidate.descriptionId === descriptionId && candidate.active,
        );
        if (!reference) {
          setStatus("暂未加入文件夹：说明缺少有效位置引用。");
          return false;
        }
        const moved = migrateBusinessStateToV2(
          moveDescriptionReference(
            current,
            descriptionId,
            { x: reference.anchor.x + dx, y: reference.anchor.y + dy },
            reference.imageBinding,
          ),
        );
        const directSelection = folderDropDirectSelection({
          business: moved,
          selection: canvasSelectionRef.current,
          draggedDescriptionId: descriptionId,
        });
        const dropped = applyExistingFolderDrop({
          business: moved,
          elements: latestElementsRef.current,
          targetFolderId,
          directSelection,
        });
        if (dropped) {
          if (mixedDescriptionDragRef.current) {
            mixedDescriptionDragRef.current = null;
            window.setTimeout(() => {
              globalHistoryScenePreviewRef.current = false;
            }, 0);
          }
          return true;
        }
        restoreMixedDescriptionDragPreview();
        return false;
      }
      commitBusiness((current) => {
        const reference = Object.values(current.descriptionReferences).find(
          (candidate) =>
            candidate.descriptionId === descriptionId && candidate.active,
        );
        if (!reference) return current;
        return moveDescriptionReference(
          current,
          descriptionId,
          { x: reference.anchor.x + dx, y: reference.anchor.y + dy },
          reference.imageBinding,
        );
      }, "description-move");
      setStatus("说明已移动；正文与可选关联保持不变。");
      return true;
    },
    [
      applyExistingFolderDrop,
      commitBusiness,
      restoreMixedDescriptionDragPreview,
    ],
  );

  const moveDescriptionObjects = useCallback(
    (
      descriptionIds: readonly string[],
      dx: number,
      dy: number,
    ): boolean => {
      if (descriptionIds.length === 0) return false;
      commitBusiness((current) => {
        let next = current;
        for (const descriptionId of descriptionIds) {
          const reference = Object.values(next.descriptionReferences).find(
            (candidate) =>
              candidate.descriptionId === descriptionId && candidate.active,
          );
          if (!reference) continue;
          next = moveDescriptionReference(
            next,
            descriptionId,
            { x: reference.anchor.x + dx, y: reference.anchor.y + dy },
            reference.imageBinding,
          );
        }
        return next;
      }, "description-group-move");
      setStatus(`已整体移动 ${descriptionIds.length} 条说明。`);
      return true;
    },
    [commitBusiness],
  );

  const moveCanvasSelectionFromDescription = useCallback(
    (
      descriptionIds: readonly string[],
      dx: number,
      dy: number,
      commit: boolean,
    ): boolean => {
      if (!api || descriptionIds.length === 0) return false;
      const imageIds = [
        ...new Set(
          canvasSelectionRef.current.imagePlacementIds.flatMap(
            (placementId) => {
              const placement = businessRef.current.imagePlacements[placementId];
              return placement?.active ? [placement.imageId] : [];
            },
          ),
        ),
      ];
      if (imageIds.length === 0) return false;

      let gesture = mixedDescriptionDragRef.current;
      if (
        !gesture ||
        JSON.stringify(gesture.descriptionIds) !==
          JSON.stringify(descriptionIds) ||
        JSON.stringify(gesture.imageIds) !== JSON.stringify(imageIds)
      ) {
        historyController.flush();
        historyController.synchronizeTransient();
        gesture = {
          descriptionIds: [...descriptionIds],
          imageIds,
          snapshot: cloneGlobalHistorySnapshot(captureGlobalHistorySnapshot()),
        };
        mixedDescriptionDragRef.current = gesture;
      }

      const baseline = gesture.snapshot;
      const imageIdSet = new Set(gesture.imageIds);
      const movedElements = baseline.scene.map((element) =>
        !element.isDeleted &&
        element.type === "image" &&
        typeof element.customData?.imageId === "string" &&
        imageIdSet.has(element.customData.imageId)
          ? newElementWith(element, {
              x: element.x + dx,
              y: element.y + dy,
            })
          : element,
      );
      const synchronizedElements = synchronizeImageBoundSceneElements(
        movedElements,
        baseline.scene,
      );
      const reconciled = reconcileBusinessState(
        baseline.business,
        asSceneElements(synchronizedElements),
        new Set(Object.keys(latestFilesRef.current)),
      );
      let nextBusiness = migrateBusinessStateToV2(reconciled.state);
      const imageFrames = Object.values(nextBusiness.imagePlacements)
        .filter((placement) => placement.active)
        .map(
          (placement, zIndex) =>
            ({
              imageId: placement.imageId,
              x: placement.x,
              y: placement.y,
              width: placement.width,
              height: placement.height,
              angle: placement.angle,
              scale: placement.scale,
              zIndex,
            }) satisfies DescriptionBindingImageFrame,
        );
      nextBusiness = migrateBusinessStateToV2(
        reconcileDescriptionImageBindings(nextBusiness, imageFrames),
      );
      nextBusiness = migrateBusinessStateToV2(
        translateSelectedDescriptionReferences(
          baseline.business,
          nextBusiness,
          gesture.descriptionIds,
          { x: dx, y: dy },
        ),
      );

      businessRef.current = nextBusiness;
      setBusiness(nextBusiness);
      latestElementsRef.current = synchronizedElements;
      globalHistoryScenePreviewRef.current = true;
      if (commit) {
        queueGlobalHistoryCommit("mixed", "canvas-selection-move");
      }
      renderCanonicalScene({
        canonical: synchronizedElements,
        ownerState: nextBusiness,
        captureUpdate: commit
          ? CaptureUpdateAction.IMMEDIATELY
          : CaptureUpdateAction.NEVER,
      });
      if (commit) {
        historyController.flush();
        mixedDescriptionDragRef.current = null;
        window.setTimeout(() => {
          globalHistoryScenePreviewRef.current = false;
        }, 0);
      }
      return true;
    },
    [
      api,
      captureGlobalHistorySnapshot,
      historyController,
      queueGlobalHistoryCommit,
      renderCanonicalScene,
    ],
  );

  const cancelCanvasSelectionFromDescription = useCallback(
    (_descriptionIds: readonly string[]): boolean => {
      return restoreMixedDescriptionDragPreview();
    },
    [restoreMixedDescriptionDragPreview],
  );

  const visibleOverlayElements = useMemo(() => {
    const previewPanel = canvasPanelRef.current;
    const previewViewport: FolderPreviewViewport | undefined =
      folderNavigation.layer === "preview"
        ? {
            width: previewPanel?.clientWidth ?? window.innerWidth,
            height: previewPanel?.clientHeight ?? window.innerHeight,
            ...canvasViewport,
          }
        : undefined;
    return visibleFolderSceneElements(
      latestElementsRef.current,
      migrateBusinessStateToV2(business),
      folderProjectionMode(
        folderNavigation,
        previewViewport,
        undefined,
        folderPreviewMotionRef.current?.folderId ===
          folderNavigation.selectedFolderId
          ? folderPreviewMotionRef.current.imageIds
          : undefined,
      ),
    );
  }, [business, canvasViewport, folderNavigation]);

  useLayoutEffect(() => {
    const panel = canvasPanelRef.current;
    const controls = canvasViewControlsRef.current;
    if (!api || !panel || !controls) {
      setHasCanvasViewControlsContentUnderlay(false);
      return;
    }

    let frame = 0;
    const measureUnderlay = () => {
      const controlsRect = controls.getBoundingClientRect();
      const appState = api.getAppState();
      const hasSceneUnderlay = visibleOverlayElements.some((element) => {
        if (element.isDeleted || element.opacity === 0) return false;
        const [left, top, right, bottom] = getCommonBounds([element]);
        const topLeft = sceneCoordsToViewportCoords(
          { sceneX: left, sceneY: top },
          appState,
        );
        const bottomRight = sceneCoordsToViewportCoords(
          { sceneX: right, sceneY: bottom },
          appState,
        );
        return viewportRectsOverlap(controlsRect, {
          left: Math.min(topLeft.x, bottomRight.x),
          top: Math.min(topLeft.y, bottomRight.y),
          right: Math.max(topLeft.x, bottomRight.x),
          bottom: Math.max(topLeft.y, bottomRight.y),
        });
      });
      const hasFolderUnderlay = Array.from(
        panel.querySelectorAll<HTMLElement>('[data-canvas-object="folder"]'),
      ).some((element) => {
        const target =
          element
            .querySelector<HTMLElement>(".folder-workspace-hit-target")
            ?.getBoundingClientRect() ?? element.getBoundingClientRect();
        return target.width > 0 && target.height > 0 && viewportRectsOverlap(controlsRect, target);
      });
      setHasCanvasViewControlsContentUnderlay((current) => {
        const next = hasSceneUnderlay || hasFolderUnderlay;
        return current === next ? current : next;
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureUnderlay);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    observer.observe(controls);
    panel.addEventListener("pointermove", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      panel.removeEventListener("pointermove", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [api, visibleOverlayElements]);

  const focusImageBounds = useMemo(() => {
    if (folderNavigation.layer !== "image") return null;
    const image = latestElementsRef.current.find(
      (element) =>
        !element.isDeleted &&
        element.type === "image" &&
        element.customData?.imageId === folderNavigation.imageId,
    );
    if (!image) return null;
    const [left, top, right, bottom] = getCommonBounds([image]);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }, [business, folderNavigation]);

  useLayoutEffect(() => {
    const panel = canvasPanelRef.current;
    const workspace = panel?.querySelector<HTMLElement>(".description-workspace");
    if (!api || !panel || !workspace || !isDescriptionWorkspaceOpen) {
      setHasDescriptionEditorContentUnderlay(false);
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;
    const visibleDescriptionIds = new Set(
      Object.keys(descriptionPresentationBusiness.descriptions),
    );

    const isVisibleCanvasObject = (element: HTMLElement): boolean => {
      if (
        element.closest(".description-workspace") ||
        element.getAttribute("aria-hidden") === "true" ||
        element.getClientRects().length === 0
      ) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0
      );
    };

    const measureUnderlay = (): boolean => {
      const editorRect = workspace.getBoundingClientRect();
      const hasDescriptionUnderlay = Array.from(
        panel.querySelectorAll<HTMLElement>('[data-canvas-object="description"]'),
      ).some((element) => {
        const descriptionId = element.dataset.descriptionId;
        return (
          Boolean(descriptionId && visibleDescriptionIds.has(descriptionId)) &&
          isVisibleCanvasObject(element) &&
          viewportRectsOverlap(editorRect, element.getBoundingClientRect())
        );
      });
      const hasFolderUnderlay = Array.from(
        panel.querySelectorAll<HTMLElement>('[data-canvas-object="folder"]'),
      ).some((element) => {
        if (!isVisibleCanvasObject(element)) return false;
        // Folder dragging applies its transient transform to the hit-target
        // button, while the data-canvas-object wrapper is committed on
        // pointerup. Measure the transformed child so underlay feedback stays
        // live without committing scene coordinates on every pointermove.
        const movingRect =
          element
            .querySelector<HTMLElement>(".folder-workspace-hit-target")
            ?.getBoundingClientRect() ?? element.getBoundingClientRect();
        return viewportRectsOverlap(editorRect, movingRect);
      });
      const appState = api.getAppState();
      const hasImageUnderlay = api.getSceneElements().some((element) => {
        if (
          element.isDeleted ||
          element.type !== "image" ||
          element.opacity === 0
        ) {
          return false;
        }
        const [left, top, right, bottom] = getCommonBounds([element]);
        const topLeft = sceneCoordsToViewportCoords(
          { sceneX: left, sceneY: top },
          appState,
        );
        const bottomRight = sceneCoordsToViewportCoords(
          { sceneX: right, sceneY: bottom },
          appState,
        );
        return viewportRectsOverlap(editorRect, {
          left: Math.min(topLeft.x, bottomRight.x),
          top: Math.min(topLeft.y, bottomRight.y),
          right: Math.max(topLeft.x, bottomRight.x),
          bottom: Math.max(topLeft.y, bottomRight.y),
        });
      });
      return hasDescriptionUnderlay || hasFolderUnderlay || hasImageUnderlay;
    };

    const updateUnderlay = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        const firstMeasurement = measureUnderlay();
        secondFrame = requestAnimationFrame(() => {
          const confirmedMeasurement = measureUnderlay();
          if (confirmedMeasurement !== firstMeasurement) {
            updateUnderlay();
            return;
          }
          setHasDescriptionEditorContentUnderlay((current) =>
            current === confirmedMeasurement ? current : confirmedMeasurement,
          );
        });
      });
    };

    updateUnderlay();
    const observer = new ResizeObserver(updateUnderlay);
    observer.observe(panel);
    observer.observe(workspace);
    const mutationObserver = new MutationObserver(updateUnderlay);
    mutationObserver.observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden"],
    });
    panel.addEventListener("pointermove", updateUnderlay, { passive: true });
    window.addEventListener("resize", updateUnderlay);
    window.addEventListener("scroll", updateUnderlay, true);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      observer.disconnect();
      mutationObserver.disconnect();
      panel.removeEventListener("pointermove", updateUnderlay);
      window.removeEventListener("resize", updateUnderlay);
      window.removeEventListener("scroll", updateUnderlay, true);
    };
  }, [
    api,
    business,
    canvasViewport,
    descriptionPresentationBusiness,
    folderNavigation,
    isDescriptionWorkspaceOpen,
  ]);

  useLayoutEffect(() => {
    const panel = canvasPanelRef.current;
    const host = panel?.closest<HTMLElement>(".workspace") ?? panel;
    const menu = host?.querySelector<HTMLElement>(
      ".selection-tool-picker__menu",
    );
    if (!api || !host || !menu || !isSelectionToolMenuOpen) {
      setHasSelectionToolContentUnderlay(false);
      return;
    }

    const updateUnderlay = () => {
      const menuRect = menu.getBoundingClientRect();
      const hasDescriptionUnderlay = Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-canvas-object="description"]',
        ),
      ).some((element) =>
        viewportRectsOverlap(menuRect, element.getBoundingClientRect()),
      );
      const appState = api.getAppState();
      const hasImageUnderlay = api.getSceneElements().some((element) => {
        if (element.isDeleted || element.type !== "image") return false;
        const [left, top, right, bottom] = getCommonBounds([element]);
        const topLeft = sceneCoordsToViewportCoords(
          { sceneX: left, sceneY: top },
          appState,
        );
        const bottomRight = sceneCoordsToViewportCoords(
          { sceneX: right, sceneY: bottom },
          appState,
        );
        return viewportRectsOverlap(menuRect, {
          left: Math.min(topLeft.x, bottomRight.x),
          top: Math.min(topLeft.y, bottomRight.y),
          right: Math.max(topLeft.x, bottomRight.x),
          bottom: Math.max(topLeft.y, bottomRight.y),
        });
      });
      const next = hasDescriptionUnderlay || hasImageUnderlay;
      setHasSelectionToolContentUnderlay((current) =>
        current === next ? current : next,
      );
    };

    updateUnderlay();
    const observer = new ResizeObserver(updateUnderlay);
    observer.observe(host);
    observer.observe(menu);
    window.addEventListener("resize", updateUnderlay);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateUnderlay);
    };
  }, [api, business, canvasViewport, folderNavigation, isSelectionToolMenuOpen]);

  useLayoutEffect(() => {
    const panel = canvasPanelRef.current;
    const host = panel?.closest<HTMLElement>(".app-shell") ?? panel;
    const menus = host
      ? Array.from(host.querySelectorAll<HTMLElement>(".canvas-workspace-menu__panel"))
      : [];
    if (!api || !host || !isCanvasMenuOpen || menus.length === 0) {
      setHasCanvasMenuContentUnderlay((current) => (current ? false : current));
      return;
    }

    const updateUnderlay = () => {
      const hasDescriptionUnderlay = menus.some((menu) =>
        Array.from(host.querySelectorAll<HTMLElement>(
          '[data-canvas-object="description"]',
        )).some((element) =>
          viewportRectsOverlap(menu.getBoundingClientRect(), element.getBoundingClientRect()),
        ),
      );
      const appState = api.getAppState();
      const hasImageUnderlay = menus.some((menu) =>
        api.getSceneElements().some((element) => {
          if (
            element.isDeleted ||
            element.type !== "image" ||
            folderProjectionRef.current?.hiddenElementIds.has(element.id)
          ) {
            return false;
          }
          const [left, top, right, bottom] = getCommonBounds([element]);
          const topLeft = sceneCoordsToViewportCoords(
            { sceneX: left, sceneY: top },
            appState,
          );
          const bottomRight = sceneCoordsToViewportCoords(
            { sceneX: right, sceneY: bottom },
            appState,
          );
          return viewportRectsOverlap(menu.getBoundingClientRect(), {
            left: Math.min(topLeft.x, bottomRight.x),
            top: Math.min(topLeft.y, bottomRight.y),
            right: Math.max(topLeft.x, bottomRight.x),
            bottom: Math.max(topLeft.y, bottomRight.y),
          });
        }),
      );
      const next = hasDescriptionUnderlay || hasImageUnderlay;
      setHasCanvasMenuContentUnderlay((current) =>
        current === next ? current : next,
      );
    };

    updateUnderlay();
    const observer = new ResizeObserver(updateUnderlay);
    observer.observe(host);
    menus.forEach((menu) => observer.observe(menu));
    window.addEventListener("resize", updateUnderlay);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateUnderlay);
    };
  }, [api, business, canvasViewport, folderNavigation, isCanvasMenuOpen]);

  useLayoutEffect(() => {
    const panel = canvasPanelRef.current;
    const host = panel?.closest<HTMLElement>(".app-shell") ?? panel;
    const targets = host
      ? Array.from(
          host.querySelectorAll<HTMLElement>(
            ".app-settings-trigger, .app-help-trigger, .canvas-status-region, .left-tool-rail .tool-button",
          ),
        )
      : [];
    if (!api || !host || targets.length === 0) return;

    const updateUnderlay = () => {
      const descriptionRects = Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-canvas-object="description"]',
        ),
      ).map((element) => element.getBoundingClientRect());
      const appState = api.getAppState();
      const imageRects = api.getSceneElements().flatMap((element) => {
        if (
          element.isDeleted ||
          element.type !== "image" ||
          folderProjectionRef.current?.hiddenElementIds.has(element.id)
        ) {
          return [];
        }
        const [left, top, right, bottom] = getCommonBounds([element]);
        const topLeft = sceneCoordsToViewportCoords(
          { sceneX: left, sceneY: top },
          appState,
        );
        const bottomRight = sceneCoordsToViewportCoords(
          { sceneX: right, sceneY: bottom },
          appState,
        );
        return [
          {
            left: Math.min(topLeft.x, bottomRight.x),
            top: Math.min(topLeft.y, bottomRight.y),
            right: Math.max(topLeft.x, bottomRight.x),
            bottom: Math.max(topLeft.y, bottomRight.y),
          },
        ];
      });

      targets.forEach((target) => {
        const targetRect = target.getBoundingClientRect();
        const hasUnderlay =
          descriptionRects.some((rect) =>
            viewportRectsOverlap(targetRect, {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }),
          ) ||
          imageRects.some((rect) => viewportRectsOverlap(targetRect, rect));
        target.classList.toggle("has-content-underlay", hasUnderlay);
      });
    };

    updateUnderlay();
    const observer = new ResizeObserver(updateUnderlay);
    observer.observe(host);
    targets.forEach((target) => observer.observe(target));
    panel?.addEventListener("pointermove", updateUnderlay, { passive: true });
    window.addEventListener("resize", updateUnderlay);
    window.addEventListener("scroll", updateUnderlay, true);
    return () => {
      observer.disconnect();
      panel?.removeEventListener("pointermove", updateUnderlay);
      window.removeEventListener("resize", updateUnderlay);
      window.removeEventListener("scroll", updateUnderlay, true);
      targets.forEach((target) =>
        target.classList.remove("has-content-underlay"),
      );
    };
  }, [api, business, canvasViewport, folderNavigation, isCanvasHelpOpen, isCanvasMenuOpen, status, busy, isDescriptionWorkspaceOpen]);

  const canvasSelectionController = useMemo(
    () => createCanvasSelectionController({
      selection: () => canvasSelectionRef.current,
      synchronizeTransient: () => historyController.synchronizeTransient(),
      deleteBusiness: (selection) => commitBusiness((current) => {
        const currentV2 = migrateBusinessStateToV2(current);
        const imageIds = selection.imagePlacementIds.flatMap((placementId) => {
          const imageId = currentV2.imagePlacements[placementId]?.imageId;
          return imageId ? [imageId] : [];
        });
        let next = deleteFolderDirectObjects({
          business: currentV2,
          imageIds,
          descriptionIds: selection.descriptionIds,
        });
        selection.regionIds.forEach((regionId) => {
          next = migrateBusinessStateToV2(removeRegionSelection(next, regionId));
        });
        return next;
      }),
      deleteScene: (selection) => {
        if (!api) return;
        const selectedPlacementIds = new Set(selection.imagePlacementIds);
        const imageIds = new Set(
          latestElementsRef.current.flatMap((element) =>
            typeof element.customData?.placementId === "string" &&
            selectedPlacementIds.has(element.customData.placementId) &&
            typeof element.customData?.imageId === "string"
              ? [element.customData.imageId]
              : [],
          ),
        );
        const regionIds = new Set([
          ...selection.regionIds,
          ...latestElementsRef.current.flatMap((element) =>
            typeof element.customData?.imageId === "string" &&
            imageIds.has(element.customData.imageId) &&
            typeof element.customData?.regionId === "string"
              ? [element.customData.regionId]
              : [],
          ),
        ]);
        const deletedCanonical = latestElementsRef.current.map((element) =>
            regionIds.has(associatedRegionId(element) ?? "") ||
            (typeof element.customData?.imageId === "string" &&
              imageIds.has(element.customData.imageId))
              ? newElementWith(element, { isDeleted: true })
              : element,
        );
        const synchronized = synchronizeEmptyFolderCovers({
          business: migrateBusinessStateToV2(businessRef.current),
          elements: deletedCanonical,
        });
        latestElementsRef.current = synchronized.elements;
        commitBusiness(synchronized.business, "folder-delete", false);
        renderCanonicalScene({
          canonical: synchronized.elements,
          ownerState: synchronized.business,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      },
      afterDelete: (selection) => {
        if (activeDescriptionId && selection.descriptionIds.includes(activeDescriptionId)) {
          setActiveDescriptionId(null);
          setDescriptionEditorFocusId(null);
        }
        setSelectedRegionId(null);
        setSelectedImageId(null);
        setSelectedCanvasImageId(null);
        setAnnotationText("");
        setCodexContext(null);
        setStatus(
          `已删除框选的 ${selection.imagePlacementIds.length} 张图片、${selection.regionIds.length} 个选区和 ${selection.descriptionIds.length} 条说明；未框选对象保持不变。`,
        );
      },
      clearSelection: () => updateCanvasSelection(EMPTY_CANVAS_SELECTION),
    }),
    [
      activeDescriptionId,
      api,
      commitBusiness,
      historyController,
      renderCanonicalScene,
      updateCanvasSelection,
    ],
  );

  const deleteSelectedCanvasObjects = useCallback(
    () => canvasSelectionController.deleteSelection(),
    [canvasSelectionController],
  );

  const selectAllCanvasContent = useCallback(() => {
    if (!api || busy || businessNoticeRef.current || canvasPointerSessionRef.current.kind !== "idle") return;
    const navigation = folderNavigationRef.current;
    if (navigation.layer !== "overview" && navigation.layer !== "folder") return;
    activateCanvasTool("selection", "选择工具");
    const current = migrateBusinessStateToV2(businessRef.current);
    const scope = folderScopeId(navigation, current);
    updateCanvasSelection(createCanvasSelection({
      imagePlacementIds: Object.values(current.imagePlacements).filter(row => row.active && row.folderId === scope).map(row => row.id),
      descriptionIds: Object.values(current.descriptions).filter(row => row.active && row.folderId === scope).map(row => row.id),
      regionIds: Object.values(current.regions).filter(row => row.active && row.folderId === scope).map(row => row.id),
    }));
    setSelectedImageId(null); setSelectedCanvasImageId(null); setSelectedRegionId(null); setSelectedQuickAnnotationId(null);
    setStatus("已全选当前画布的图片、说明和选区；文件夹保持独立操作。");
  }, [api, busy, activateCanvasTool, updateCanvasSelection]);

  const handleCanvasContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || isTextEntryKeyboardTarget(element)) return;
    event.preventDefault(); event.stopPropagation();
    if (element.closest("[data-canvas-context-menu]")) return;
    closeCanvasContext();
    if (!api || busy || businessNoticeRef.current || element.closest(".canvas-dialog-backdrop") ||
        canvasPointerSessionRef.current.kind !== "idle" || nativeHistoryGestureBarrierRef.current.active) return;
    const navigation = folderNavigationRef.current;
    const current = migrateBusinessStateToV2(businessRef.current);
    const scope = folderScopeId(navigation, current);
    const point = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState());
    const object = element.closest<HTMLElement>("[data-canvas-object]");
    let target: CanvasContextTarget | null = null;
    if (object?.dataset.canvasObject === "folder" && object.dataset.folderId) {
      const id = object.dataset.folderId;
      if (current.folders[id]?.kind === "folder" && (navigation.layer === "overview" ||
          navigation.layer === "preview" && navigation.selectedFolderId === id)) target = { kind: "folder", id };
    } else if (navigation.layer === "overview" || navigation.layer === "folder" || navigation.layer === "image" || navigation.layer === "description") {
      if (object?.dataset.canvasObject === "description" && object.dataset.descriptionId) {
        const id = object.dataset.descriptionId;
        if (current.descriptions[id]?.active && current.descriptions[id].folderId === scope &&
            (navigation.layer === "overview" || navigation.layer === "folder" || navigation.layer === "description" && navigation.descriptionId === id)) target = { kind: "description", id };
      } else if (!object && !element.closest(".quick-annotation-overlay") && element.closest("canvas")) {
        const hit = [...api.getSceneElements()].reverse().find(item => !folderProjectionRef.current?.hiddenElementIds.has(item.id) &&
          isViewportVisibleElement(item, [point.x - .1, point.y - .1, point.x + .1, point.y + .1]));
        if (!hit && (navigation.layer === "overview" || navigation.layer === "folder")) target = { kind: "canvas" };
        else if (hit && (hit.customData?.kind === "image" || hit.customData?.kind === "image-shadow") && typeof hit.customData.placementId === "string") {
          const id = hit.customData.placementId;
          if (current.imagePlacements[id]?.active && current.imagePlacements[id].folderId === scope &&
              (navigation.layer === "overview" || navigation.layer === "folder" || navigation.layer === "image" && navigation.imageId === current.imagePlacements[id].imageId)) target = { kind: "image", id };
        }
      }
    }
    if (!target) return;
    setIsCanvasMenuOpen(false);
    setCanvasContext({ target, clientPoint: { x: event.clientX, y: event.clientY }, scenePoint: point, folderId: scope });
  }, [api, busy, closeCanvasContext]);

  const closeDescriptionEditorOnEscape = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.key !== "Escape" || !isDescriptionWorkspaceOpen) return false;
      setIsDescriptionWorkspaceOpen(false);
      setDescriptionEditorFocusId(null);
      setStatus("说明编辑器已收起；仍停留在当前画布层级。");
      return true;
    },
    [isDescriptionWorkspaceOpen],
  );

  const registerPathDraftUndo = useCallback(
    (undo: (() => number | null) | null) => {
      pathDraftUndoRef.current = undo;
    },
    [],
  );

  const handleShortcutOverlayKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (
        event.key === "Delete" &&
        selectedQuickAnnotationId &&
        !isEditableKeyboardTarget(event.target)
      ) {
        return deleteSelectedQuickAnnotation();
      }
      if (
        event.key === "Backspace" &&
        activeSelectionTool === "path" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableKeyboardTarget(event.target)
      ) {
        if (event.repeat) {
          return true;
        }
        const remaining = pathDraftUndoRef.current?.() ?? null;
        if (remaining !== null) {
          setStatus(
            remaining === 0
              ? "已撤回最后一个路径锚点；可重新开始落点。"
              : `已撤回最后一个路径锚点；剩余 ${remaining} 个。`,
          );
          return true;
        }
      }
      if (isShortcutManagerOpen) {
        if (event.key === "Escape") {
          if (shortcutCaptureId) {
            setShortcutCaptureId(null);
            setShortcutFeedback("已取消本次录入，原快捷键保持不变。");
          } else {
            setIsShortcutManagerOpen(false);
            setShortcutFeedback(null);
          }
          return true;
        }
        if (!shortcutCaptureId || event.isComposing) return true;
        const shortcut = shortcutFromKeyboardEvent(event);
        if (!shortcut) {
          setShortcutFeedback("只可录入字母或主键盘数字，最多搭配一个 Ctrl、Alt 或 Shift。");
          return true;
        }
        const assignment = assignCanvasShortcut(
          workbenchPreferences.shortcuts,
          shortcutCaptureId,
          shortcut,
        );
        if (!assignment.ok) {
          setShortcutFeedback(
            assignment.reason === "conflict"
              ? `已被${CANVAS_SHORTCUT_LABELS[assignment.conflictId ?? "selection"]}占用，原快捷键保持不变。`
              : assignment.reason === "reserved"
                ? "这是固定保留键，不能分配。"
                : "该键位不在第一版允许范围内。",
          );
          return true;
        }
        setWorkbenchPreferences((current) => ({
          ...current,
          shortcuts: assignment.preferences,
        }));
        setShortcutFeedback(
          `已更新${CANVAS_SHORTCUT_LABELS[shortcutCaptureId]}：${shortcut.replace("+", " + ")}。`,
        );
        setShortcutCaptureId(null);
        return true;
      }
      if (isCanvasHelpOpen) {
        if (event.key === "Escape") {
          setIsCanvasHelpOpen(false);
        }
        return true;
      }
      if (pendingProjectOpen) return true;
      return closeDescriptionEditorOnEscape(event);
    },
    [
      activeSelectionTool,
      deleteSelectedQuickAnnotation,
      isCanvasHelpOpen,
      isShortcutManagerOpen,
      pendingProjectOpen,
      shortcutCaptureId,
      workbenchPreferences.shortcuts,
      closeDescriptionEditorOnEscape,
    ],
  );

  const openShortcutManager = useCallback(() => {
    setIsCanvasMenuOpen(() => false);
    setShortcutCaptureId(null);
    setShortcutFeedback(null);
    setIsShortcutManagerOpen(true);
  }, [setIsCanvasMenuOpen]);

  const keyboardController = useMemo(
    () =>
      createCanvasKeyboardController({
        selection: () => canvasSelectionRef.current,
        menuOpen: () => isCanvasMenuOpen || isSelectionToolMenuOpen,
        pointerSession: () => canvasPointerSessionRef.current.kind as CanvasPointerSessionKind,
      pendingTool: () =>
          Boolean(pendingRegionRef.current) ||
          Boolean(pendingManualAnnotationRef.current) ||
          Boolean(pendingOrdinaryTextBoxRef.current) ||
          Boolean(pendingBubbleRef.current) ||
          isDescriptionToolActive ||
          isQuickAnnotationToolActive,
        pendingSelectionTool: () => Boolean(pendingRegionRef.current),
        shortcutPreferences: () => workbenchPreferences.shortcuts,
        editableTarget: isEditableKeyboardTarget,
        textEntryTarget: isTextEntryKeyboardTarget,
        copyContent: ()=>{void copyCanvasContent();},
        selectAllContent: selectAllCanvasContent,
        clipboardTarget,
        clipboardBlocked: reason=>{
          if(reason==="busy")setStatus("请先完成当前操作，再复制画布内容。");
          else void showBusinessNotice({title:"请使用复制",message:"当前画布内容支持复制和粘贴，暂不执行剪切，以保留原内容。"});
        },
        blockedShortcut: isBlockedNativeToolShortcut,
        allowDeleteFromEditableTarget: isSelectedDescriptionKeyboardTarget,
        hasEnterTarget: () => {
          const current = folderNavigationRef.current;
          return (
            current.layer === "preview" ||
            ((current.layer === "overview" || current.layer === "folder") &&
              Boolean(selectedCanvasImageId))
          );
        },
        hasFolderDeleteTarget: () =>
          folderNavigationRef.current.layer === "preview",
        hasTemporaryLayer: () =>
          folderNavigationRef.current.layer === "image" ||
          folderNavigationRef.current.layer === "description",
        undo: () => replayGlobalHistory("undo"),
        redo: () => replayGlobalHistory("redo"),
        removeSelection: deleteSelectedCanvasObjects,
        removeFolder: () => {
          const current = folderNavigationRef.current;
          if (current.layer === "preview") {
            deleteFolder(current.selectedFolderId);
          }
        },
        enterSelection: enterSelectedCanvasObject,
        closeMenu: () => {
          setIsSelectionToolMenuOpen(false);
          applyCanvasMenuAction("escape");
        },
        cancelPointer: clearCanvasPointerSession,
        cancelTool: cancelPendingAnnotationSelection,
        exitTemporaryLayer: returnFromFolderLayer,
        activateNativeTool: (tool: CanvasNativeToolShortcut) => {
          const labels: Record<CanvasNativeToolShortcut, string> = {
            selection: "选择工具",
            hand: "平移工具",
            laser: "激光笔",
          };
          activateCanvasTool(tool, labels[tool]);
        },
        runCanvasShortcut: (shortcut) => canvasShortcutActionRef.current(shortcut),
        blockNativeTool: () => {
          const activeType = api?.getAppState().activeTool.type;
          if (activeType && !isAllowedNativeCanvasTool(activeType, {
            manualAnnotationStage: pendingManualAnnotationRef.current?.stage ?? null,
            ordinaryTextPending: pendingOrdinaryTextBoxRef.current !== null,
          })) {
            api?.setActiveTool({ type: "selection" });
          }
        },
        handleOverlayKeyDown: handleShortcutOverlayKeyDown,
      }),
    [
      api,
      applyCanvasMenuAction,
      cancelPendingAnnotationSelection,
      clearCanvasPointerSession,
      deleteSelectedCanvasObjects,
      deleteFolder,
      enterSelectedCanvasObject,
      activateCanvasTool,
      isCanvasMenuOpen,
      isSelectionToolMenuOpen,
      isDescriptionToolActive,
      isQuickAnnotationToolActive,
      handleShortcutOverlayKeyDown,
      copyCanvasContent,
      selectAllCanvasContent,
      clipboardTarget,
      showBusinessNotice,
      selectedCanvasImageId,
      replayGlobalHistory,
      returnFromFolderLayer,
      workbenchPreferences.shortcuts,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if(businessNoticeRef.current)return;
      if (event.target instanceof Element && event.target.closest("[data-canvas-context-menu]")) return;
      // Let native buttons and the preview menu receive their own key events.
      // The controller's handled-overlay branch deliberately stops propagation.
      if (event.target instanceof Element && event.target.closest("[data-folder-preview-actions]") &&
          !((event.ctrlKey||event.metaKey) && !event.altKey && ["KeyC","KeyX"].includes(event.code))) return;
      keyboardController.onKeyDown(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keyboardController]);

  const createBundle = useCallback((): P0Bundle => {
    if (!api) {
      throw new Error("Excalidraw 尚未加载");
    }
    return {
      format: "ai-canvas-excalidraw-p0",
      version: 3,
      savedAt: new Date().toISOString(),
      scene: {
        elements: latestElementsRef.current,
        appState: sanitizeAppState(api.getAppState()),
        files: documentFiles(latestElementsRef.current,businessRef.current,api.getFiles()),
      },
      business: businessRef.current,
    };
  }, [api]);

  const documentFingerprint = useCallback((bundle: P0Bundle) => documentFingerprintRef.current({
    ...bundle,scene:{...bundle.scene,files:documentFiles(bundle.scene.elements,bundle.business,bundle.scene.files)},
  }), []);

  nativeCloseStateRef.current = () => {
    if (!api || !documentBaselineReadyRef.current || pendingSavedRestoreRef.current || clipboardBusyRef.current) return undefined;
    const state = documentSaveRef.current;
    state.observe(documentFingerprint(createBundle()));
    sendNativeDocumentState(state.revision, state.dirty);
    return { revision: state.revision, dirty: state.dirty };
  };

  finishSavedRestoreRef.current = (bundle: P0Bundle) => {
    const pending = pendingSavedRestoreRef.current;
    if (!pending || !restoredDocumentReady(bundle.scene, pending.expected)) return false;
    pendingSavedRestoreRef.current = null;
    const fingerprint = documentFingerprint(bundle);
    if (pending.userEpoch === documentUserEpochRef.current) documentSaveRef.current.loaded(fingerprint);
    else documentSaveRef.current.observe(fingerprint);
    documentBaselineReadyRef.current = true;
    sendNativeDocumentState(documentSaveRef.current.revision, documentSaveRef.current.dirty);
    setHostDocumentResult({ requestId: pending.requestId, ok: true });
    return true;
  };

  useEffect(() => {
    if (!api || !nativeDocumentIdentity()) return;
    const bundle = createBundle();
    const fingerprint = documentFingerprint(bundle);
    const pending = pendingSavedRestoreRef.current;
    if (pending) {
      // The SDK onChange path finishes reconciliation before establishing the
      // loaded baseline; a React effect must not sample its pre-normalized scene.
      return;
    }
    if (!documentBaselineReadyRef.current) {
      documentSaveRef.current.loaded(fingerprint);
      documentBaselineReadyRef.current = true;
      sendNativeDocumentState(documentSaveRef.current.revision, false);
    } else if (documentSaveRef.current.observe(fingerprint)) {
      sendNativeDocumentState(documentSaveRef.current.revision, documentSaveRef.current.dirty);
    }
  });

  const restoreProjectBundle = useCallback((
    bundle: P0Bundle,
    focusImageIds: readonly string[],
    focusFolderId: string,
    statusMessage: string,
    savedFileBaseline = false,
  ) => {
    if (!api) {
      return;
    }
    const restoredCanvasTheme = readApplicationTheme()?.theme ?? workbenchPreferences.canvasTheme;
    api.resetScene();
    const restoredBusiness = migrateBusinessStateToV2(bundle.business);
    const nativeIdentity = nativeDocumentIdentity();
    if (nativeIdentity) restoredBusiness.document = { ...restoredBusiness.document, id: nativeIdentity.documentId };
    commitBusiness(restoredBusiness, "project-restore", false);
    latestElementsRef.current = bundle.scene.elements;
    latestFilesRef.current = bundle.scene.files;
    api.addFiles(Object.values(bundle.scene.files));
    setFolderNavigation(
      focusFolderId === restoredBusiness.rootFolderId
        ? { layer: "overview", selectedFolderId: null }
        : { layer: "folder", selectedFolderId: focusFolderId },
    );
    folderNavigationRef.current =
      focusFolderId === restoredBusiness.rootFolderId
        ? { layer: "overview", selectedFolderId: null }
        : { layer: "folder", selectedFolderId: focusFolderId };
    renderCanonicalScene({
      canonical: bundle.scene.elements,
      ownerState: restoredBusiness,
      appState: {
        ...bundle.scene.appState,
        ...canvasThemeAppState(restoredCanvasTheme),
      },
    });
    clearCanvasPointerSession();
    pendingRegionRef.current = null;
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    setSelectedImageId(null);
    setSelectedCanvasImageId(null);
    setFocusImageIds(
      normalizeFocusedImageIds(restoredBusiness, focusImageIds, focusFolderId),
    );
    setSelectedRegionId(null);
    setActiveDescriptionId(null);
    setDescriptionEditorFocusId(null);
    setIsDescriptionWorkspaceOpen(false);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setSelectedBubbleAnnotation(null);
    setSelectedOrdinaryRectangle(false);
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    setIsDescriptionToolActive(false);
    setIsBubbleToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    setAnnotationText("");
    setCodexContext(null);
    setIssues([]);
    setWorkbenchPreferences((current) => ({
      ...current,
      gridVisible: bundle.scene.appState.gridModeEnabled,
      canvasTheme: restoredCanvasTheme,
    }));
    api.history.clear();
    setStatus(statusMessage);
    if (!savedFileBaseline) {
      documentSaveRef.current.observe(documentFingerprint(createBundle()));
      sendNativeDocumentState(documentSaveRef.current.revision, documentSaveRef.current.dirty);
    }
  }, [
    api,
    clearCanvasPointerSession,
    commitBusiness,
    renderCanonicalScene,
    updateCanvasSelection,
    workbenchPreferences.canvasTheme,
  ]);

  const saveBrowserCurrent = useCallback(async () => {
    setBusy(true);
    try {
      await saveP0Bundle(createBundle());
      setStatus("已更新浏览器恢复点。");
    } catch (error) {
      setStatus(
        `保存失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, [createBundle]);

  const loadBrowserCurrent = useCallback(async (legacy = false) => {
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const bundle = await loadP0Bundle({ legacy });
      if (!bundle) {
        setStatus("没有找到已保存的 P0 数据。");
        return;
      }
      restoreProjectBundle(
        bundle,
        [],
        migrateBusinessStateToV2(bundle.business).rootFolderId,
        `已恢复 ${bundle.savedAt} 的浏览器恢复点。`,
      );
    } catch (error) {
      setStatus(
        `恢复失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, [api, restoreProjectBundle]);

  const saveProjectFile = useCallback(async (saveAs = false) => {
    const state = documentSaveRef.current;
    if (!api || busy || clipboardBusyRef.current || pendingSavedRestoreRef.current) {
      const message = "画布正在处理操作，尚未保存。";
      setStatus(message);
      return { documentId: state.documentId, requestId: "", revision: state.revision, status: "failed" as const, message };
    }
    setBusy(true);
    const requestId = crypto.randomUUID();
    let request: { documentId: string; requestId: string; revision: number } = { documentId: state.documentId, requestId, revision: state.revision };
    try {
      const bundle = createBundle();
      state.observe(documentFingerprint(bundle));
      request = state.begin(requestId);
      sendNativeDocumentState(state.revision, state.dirty);
      const fileName = aiCanvasProjectFilename(new Date(bundle.savedAt));
      const blob = new Blob(
        [
          serializeAiCanvasProjectFile(
            bundle,
            focusedImageIds,
            folderScopeId(
              folderNavigationRef.current,
              migrateBusinessStateToV2(businessRef.current),
            ),
          ),
        ],
        { type: "application/json" },
      );
      if (nativeDocumentIdentity()) {
        const result = await requestNativeDocumentSave(await blob.text(), fileName, { ...request, saveAs });
        state.acknowledge(result);
        sendNativeDocumentState(state.revision, state.dirty);
        setStatus(result.status === "saved" ? `完整项目已保存为 ${result.fileName ?? fileName}。` :
          result.status === "cancelled" ? "已取消保存项目。" : `保存项目失败：${result.message ?? "写入未确认"}`);
        if (result.status === "saved") void saveP0Bundle(bundle).catch(() => undefined);
        return result;
      }
      const savePicker = (window as typeof window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: readonly {
            description: string;
            accept: Readonly<Record<string, readonly string[]>>;
          }[];
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }).showSaveFilePicker;
      if (savePicker) {
        const handle = await savePicker.call(window, {
          suggestedName: fileName,
          types: [{
            description: "AI Canvas 可编辑项目",
            accept: { "application/json": [".excalidraw"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(`完整项目已保存为 ${fileName}；可重新打开继续编辑。`);
        const result: DocumentSaveResult = { ...request, status: "saved", fileName };
        state.acknowledge(result);
        void saveP0Bundle(bundle).catch(() => undefined);
        return result;
      } else {
        downloadBlob(blob, fileName);
        setStatus(`浏览器已下载完整项目 ${fileName}；可重新打开继续编辑。`);
        const result: DocumentSaveResult = { ...request, status: "unconfirmed", fileName };
        state.acknowledge(result);
        void saveP0Bundle(bundle).catch(() => undefined);
        return result;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("已取消保存项目。");
        const result: DocumentSaveResult = { ...request, status: "cancelled" };
        state.acknowledge(result);
        return result;
      }
      setStatus(
        `保存项目失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
      const result: DocumentSaveResult = { ...request, status: "failed", message: error instanceof Error ? error.message : "未知错误" };
      state.acknowledge(result);
      return result;
    } finally {
      setBusy(false);
    }
  }, [api, busy, createBundle, documentFingerprint, focusedImageIds]);
  nativeSaveActionRef.current = saveProjectFile;
  useEffect(() => {
    const identity = nativeDocumentIdentity();
    if (!identity) return;
    return installNativeDocumentRenameListener(identity.documentId, fileName => {
      setStatus(`已重命名为 ${fileName}；当前未保存的内容保持不变。`);
      if (api) void saveP0Bundle(createBundle()).catch(() => undefined);
    });
  }, [api, createBundle]);

  const prepareProjectOpen = useCallback(async (file: File) => {
    try {
      const project = parseAiCanvasProjectFile(await file.text());
      setPendingProjectOpen({ fileName: file.name, project });
      applyCanvasMenuAction("project-read-pending");
      setStatus(`已读取 ${file.name}；请确认是否覆盖当前画布。`);
    } catch (error) {
      setPendingProjectOpen(null);
      setStatus(
        `打开项目失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }, [applyCanvasMenuAction]);

  const handleCanvasFileDragOverCapture = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const hasSupportedImage = Array.from(event.dataTransfer.items).some(
        (item) =>
          item.kind === "file" && isBridgePublishableImageMimeType(item.type),
      );
      const hasProjectFile = Array.from(event.dataTransfer.items).some(
        (item) => item.kind === "file" && item.type === "application/json",
      );
      if (!hasSupportedImage && !hasProjectFile) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleCanvasFileDropCapture = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const files = Array.from(event.dataTransfer.files);
      const projectFile = files.find((file) =>
        file.name.toLowerCase().endsWith(".excalidraw") ||
        file.type === "application/json",
      );
      if (projectFile) {
        event.preventDefault();
        event.stopPropagation();
        void prepareProjectOpen(projectFile);
        return;
      }
      const file = files.find((candidate) =>
        isBridgePublishableImageMimeType(candidate.type),
      );
      if (!file || !api) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const scenePoint = viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        api.getAppState(),
      );
      void handleImportImage(file, scenePoint);
    },
    [api, handleImportImage, prepareProjectOpen],
  );

  const confirmProjectOpen = useCallback(() => {
    if (!pendingProjectOpen) {
      return;
    }
    restoreProjectBundle(
      pendingProjectOpen.project.bundle,
      pendingProjectOpen.project.focusImageIds,
      pendingProjectOpen.project.focusFolderId,
      `已打开 ${pendingProjectOpen.fileName}；当前画布已由该项目替换。`,
    );
    setPendingProjectOpen(null);
  }, [pendingProjectOpen, restoreProjectBundle]);

  const exportCanvasImage = useCallback(async () => {
    if (!api || api.getSceneElements().length === 0) {
      setStatus("当前画布没有可导出的内容。");
      return;
    }
    setBusy(true);
    try {
      const blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        exportPadding: 32,
      });
      downloadBlob(blob, `AI-Canvas-${Date.now()}.png`);
      setStatus("画布图片已导出为 PNG。");
    } catch (error) {
      setStatus(
        `导出图片失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setBusy(false);
    }
  }, [api]);

  const showCanvasOverview = useCallback(() => {
    const panel = canvasPanelRef.current;
    if (!api || !panel) {
      return;
    }
    const elements = api.getSceneElements();
    const anchors = activeDescriptionEntries(businessRef.current).map(
      ({ reference }) => reference.anchor,
    );
    if (elements.length === 0 && anchors.length === 0) {
      setStatus("当前画布为空，无需全览。");
      return;
    }
    const [elementLeft, elementTop, elementRight, elementBottom] =
      elements.length > 0
        ? getCommonBounds(elements)
        : [Infinity, Infinity, -Infinity, -Infinity];
    const left = Math.min(elementLeft, ...anchors.map((anchor) => anchor.x));
    const top = Math.min(elementTop, ...anchors.map((anchor) => anchor.y));
    const right = Math.max(elementRight, ...anchors.map((anchor) => anchor.x));
    const bottom = Math.max(elementBottom, ...anchors.map((anchor) => anchor.y));
    const zoomValue = api.getAppState().zoom.value;
    api.updateScene({
      appState: {
        zoom: { value: zoomValue } as AppState["zoom"],
        scrollX: panel.clientWidth / (2 * zoomValue) - (left + right) / 2,
        scrollY: panel.clientHeight / (2 * zoomValue) - (top + bottom) / 2,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setStatus("已在保持当前画布比例的前提下，将图片、选区与说明居中。");
  }, [api]);

  const getCanvasContextItems = useCallback((context: NonNullable<typeof canvasContext>): readonly CanvasContextItem[] => {
    const current = migrateBusinessStateToV2(businessRef.current);
    const navigation = folderNavigationRef.current;
    const editable = navigation.layer === "overview" || navigation.layer === "folder";
    const target = context.target;
    const placement = target.kind === "image" ? current.imagePlacements[target.id] : undefined;
    const linkedRegions = target.kind === "description" ? current.document.descriptionScopeLinkIds.flatMap(id => {
      const link = current.descriptionScopeLinks[id];
      const region = link && link.descriptionId === target.id ? current.regions[link.regionId] : undefined;
      return region?.active && region.status === "valid" && region.folderId === context.folderId ? [region] : [];
    }) : [];
    const related = [
      ...Array.from(new Set(linkedRegions.map(region => region.imageId))).map(id => ({ id: `image:${id}`, label: `图片：${current.imageAssets[id]?.name ?? "关联图片"}` })),
      ...linkedRegions.map((region, index) => ({ id: `region:${region.id}`, label: contextRegionLabel(selectionNumberByRegion.get(region.id), index, current.imageAssets[region.imageId]?.name ?? "关联图片") })),
    ];
    return canvasContextItems(target.kind, {
      canUndo: globalHistoryRef.current.cursor > 0,
      canRedo: globalHistoryRef.current.cursor < globalHistoryRef.current.entries.length,
      canCreateFolder: navigation.layer === "overview", canEditScope: editable,
      canFocusImage: editable, canAnnotate: editable || navigation.layer === "image",
      hasDescriptionText: target.kind === "description" && !!current.descriptions[target.id]?.text,
      related,
      folders: placement?.active && placement.folderId === current.rootFolderId && navigation.layer === "overview"
        ? Object.values(current.folders).filter(folder => folder.kind === "folder").map(folder => ({ id: folder.id, label: folder.name })) : [],
    });
  }, [selectionNumberByRegion]);

  const runCanvasContextCommand = useCallback(async (command: CanvasContextCommand, argument?: string) => {
    const context = canvasContext;
    if (!context || !api || busy || businessNoticeRef.current || canvasPointerSessionRef.current.kind !== "idle") return;
    const offered = getCanvasContextItems(context).flatMap(item => item.children?.length && !item.disabled ? [item, ...item.children] : [item]);
    if (!offered.some(item => item.id === command && item.argument === argument && !item.disabled)) return;
    const target = context.target;
    const current = migrateBusinessStateToV2(businessRef.current);
    if (folderScopeId(folderNavigationRef.current, current) !== context.folderId) return;
    try {
      if (command === "undo" || command === "redo") { replayGlobalHistory(command); return; }
      if (command === "import-image") { inputRef.current?.click(); return; }
      if (command === "new-description") { beginDescription(); return; }
      if (command === "new-folder") { createFolderFromSelection(); return; }
      if (command === "overview") { showCanvasOverview(); return; }
      if (command === "select-all") { selectAllCanvasContent(); return; }
      if (command === "paste") {
        if (clipboardBusyRef.current) return;
        let text = ""; const images: File[] = [];
        clipboardBusyRef.current = true; setBusy(true);
        try {
          for (const item of await readNativeMenuClipboard(() => navigator.clipboard.read())) {
            if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
            const mime = item.types.find(isBridgePublishableImageMimeType);
            if (mime) images.push(new File([await item.getType(mime)], `剪贴板图片-${images.length + 1}.${mime.split("/")[1]}`, { type: mime }));
          }
        } finally { clipboardBusyRef.current = false; setBusy(false); }
        await pasteCanvasContent(text, images, { point: context.scenePoint, folderId: context.folderId }); return;
      }
      if (target.kind === "canvas") return;
      const selected = contextClipboardSelection(target, clipboardSelection());
      if (command === "copy") { await copyCanvasContent(undefined, selected); return; }
      if (target.kind === "image") {
        const placement = current.imagePlacements[target.id];
        if (!placement?.active || placement.folderId !== context.folderId) return;
        if (command === "focus-image") { enterSelectedCanvasObject(placement.imageId); return; }
        if (command === "quick-annotation") { setSelectedImageId(placement.imageId); beginQuickAnnotation(); return; }
        if (command === "create-region" && (argument === "rectangle" || argument === "ellipse" || argument === "path")) {
          setSelectedImageId(placement.imageId); setLastSelectionTool(argument); beginAnnotationSelection(argument, placement.imageId); return;
        }
        if (command === "move-to-folder" && argument) {
          if (current.folders[argument]?.kind !== "folder" || folderNavigationRef.current.layer !== "overview") return;
          const directSelection = {
            imageIds: [...new Set((selected.imagePlacementIds ?? []).flatMap(id => current.imagePlacements[id]?.active ? [current.imagePlacements[id].imageId] : []))],
            descriptionIds: [...(selected.descriptionIds ?? [])],
          };
          const required = requiredDirectObjectsForReparent({ business: current, ...directSelection });
          if (required.imageIds.length || required.descriptionIds.length) {
            await showBusinessNotice({ title: "请补选关联内容", message: `还需同时选择 ${required.imageIds.length} 张关联图片和 ${required.descriptionIds.length} 条关联说明，再收进 Folder。` }); return;
          }
          if (!applyExistingFolderDrop({ business: current, elements: latestElementsRef.current, targetFolderId: argument, directSelection }))
            await showBusinessNotice({ title: "尚未收进 Folder", message: "目标或内容关系未能通过检查，原内容保持不变。" });
          return;
        }
      }
      if (target.kind === "folder") {
        if (current.folders[target.id]?.kind !== "folder") return;
        if (command === "preview-folder") selectFolder(target.id);
        else if (command === "open-folder") enterFolder(target.id);
        else if (command === "ungroup-folder") ungroupFolder(target.id);
        else if (command === "rename-folder") {
          const name = await showBusinessNamePrompt("重命名 Folder", "文件夹名称", current.folders[target.id].name);
          if (name !== null) {
            const latest = migrateBusinessStateToV2(businessRef.current);
            const renamed = renameCanvasFolder(latest, target.id, name);
            if (renamed !== latest) { commitBusiness(renamed, "folder-rename"); setStatus(`已重命名文件夹：${name}。`); }
          }
        } else if (command === "delete") await deleteFolder(target.id);
      } else if (target.kind === "description" && command === "copy-description-text") {
        const description = current.descriptions[target.id];
        if (description?.active) { await navigator.clipboard.writeText(description.text); setStatus("已复制说明正文。"); }
      } else if (target.kind === "description" && command === "locate-related" && argument) {
        const id = argument.slice(argument.indexOf(":") + 1);
        const regionIds = current.document.descriptionScopeLinkIds.flatMap(linkId => {
          const link = current.descriptionScopeLinks[linkId]; return link?.descriptionId === target.id ? [link.regionId] : [];
        });
        const region = argument.startsWith("region:") ? current.regions[id] : undefined;
        const imageId = argument.startsWith("image:") ? id : region?.imageId;
        if (!regionIds.some(regionId => current.regions[regionId]?.active && (region ? regionId === id : current.regions[regionId].imageId === imageId))) return;
        const elementId = region?.elementId ?? Object.values(current.imagePlacements).find(row => row.active && row.imageId === imageId)?.elementId;
        const element = latestElementsRef.current.find(row => row.id === elementId && !row.isDeleted);
        if (element) {
          if (folderNavigationRef.current.layer === "description") returnFromFolderLayer();
          requestAnimationFrame(() => scrollElementsAtCurrentZoom([element]));
          setStatus("已定位关联内容，画布比例保持不变。");
        }
      } else if (command === "edit-description" && target.kind === "description") {
        if (folderNavigationRef.current.layer === "description") returnFromFolderLayer();
        selectDescriptionObject(target.id); setDescriptionEditorFocusId(target.id);
      } else if (command === "delete") {
        if (folderNavigationRef.current.layer === "image" || folderNavigationRef.current.layer === "description") returnFromFolderLayer();
        updateCanvasSelection(createCanvasSelection(selected)); deleteSelectedCanvasObjects();
      }
    } catch (error) {
      void showBusinessNotice({ title: "操作未完成", message: command === "paste"
        ? "无法从剪贴板读取内容。请在画布中按 Ctrl+V 重试。"
        : error instanceof Error ? error.message : "目标内容未能完整核对，请重试。" });
    }
  }, [canvasContext, api, busy, getCanvasContextItems, replayGlobalHistory, beginDescription, createFolderFromSelection, showCanvasOverview,
    selectAllCanvasContent, pasteCanvasContent, clipboardSelection, copyCanvasContent, enterSelectedCanvasObject, beginQuickAnnotation,
    beginAnnotationSelection, applyExistingFolderDrop, showBusinessNotice, showBusinessNamePrompt, commitBusiness, selectFolder,
    enterFolder, ungroupFolder, deleteFolder, selectDescriptionObject, returnFromFolderLayer, updateCanvasSelection, deleteSelectedCanvasObjects, scrollElementsAtCurrentZoom]);


  const arrangeCurrentCanvas = useCallback(() => {
    const navigation = folderNavigationRef.current;
    const panel = canvasPanelRef.current;
    if (
      !api ||
      !panel ||
      (navigation.layer !== "overview" && navigation.layer !== "folder")
    ) {
      setStatus("请先回到 Root 或当前 Folder，再整理画布。");
      return;
    }

    const currentBusiness = migrateBusinessStateToV2(businessRef.current);
    const scopeFolderId =
      navigation.layer === "overview"
        ? currentBusiness.rootFolderId
        : navigation.selectedFolderId;
    const scopeFolder = currentBusiness.folders[scopeFolderId];
    if (!scopeFolder) {
      setStatus("当前画布层级不存在，未执行整理。");
      return;
    }

    const currentElements = latestElementsRef.current;
    const descriptionReferences = new Map(
      Object.values(currentBusiness.descriptionReferences)
        .filter((reference) => reference.active)
        .map((reference) => [reference.descriptionId, reference] as const),
    );
    const scopeImageIds = new Set(scopeFolder.imageAssetIds);
    const linkedRegionImageIdsByDescription = new Map<string, string[]>();
    currentBusiness.document.descriptionScopeLinkIds.forEach((linkId) => {
      const link = currentBusiness.descriptionScopeLinks[linkId];
      const region = link ? currentBusiness.regions[link.regionId] : undefined;
      if (!link || !region?.active || !scopeImageIds.has(region.imageId)) return;
      const imageIds = linkedRegionImageIdsByDescription.get(link.descriptionId) ?? [];
      imageIds.push(region.imageId);
      linkedRegionImageIdsByDescription.set(link.descriptionId, imageIds);
    });
    const arrangeImageIdByDescription = new Map<string, string>();
    scopeFolder.descriptionIds.forEach((descriptionId) => {
      const reference = descriptionReferences.get(descriptionId);
      if (!reference) return;
      const imageId = resolveCanvasArrangeDescriptionImageId({
        imageBindingImageId: reference.imageBinding?.imageId,
        linkedRegionImageIds:
          linkedRegionImageIdsByDescription.get(descriptionId) ?? [],
        scopeImageIds,
      });
      if (imageId) arrangeImageIdByDescription.set(descriptionId, imageId);
    });
    const imageObjects = scopeFolder.imageAssetIds.flatMap((imageId) => {
      const placement = Object.values(currentBusiness.imagePlacements).find(
        (candidate) => candidate.active && candidate.imageId === imageId,
      );
      const imageElement = placement
        ? currentElements.find(
            (element): element is ExcalidrawImageElement =>
              !element.isDeleted &&
              element.id === placement.elementId &&
              element.type === "image" &&
              element.customData?.kind === "image",
          )
        : undefined;
      if (!imageElement) return [];

      const sceneMembers = currentElements.filter(
        (element) =>
          !element.isDeleted && element.customData?.imageId === imageId,
      );
      const [sceneLeft, sceneTop, sceneRight, sceneBottom] = getCommonBounds(
        sceneMembers.length > 0 ? sceneMembers : [imageElement],
      );
      const boundReferences = scopeFolder.descriptionIds.flatMap((descriptionId) => {
        const reference = descriptionReferences.get(descriptionId);
        if (!reference || arrangeImageIdByDescription.get(descriptionId) !== imageId) {
          return [];
        }
        return [reference];
      });
      const left = Math.min(
        sceneLeft,
        ...boundReferences.map(({ anchor }) => anchor.x),
      );
      const top = Math.min(
        sceneTop,
        ...boundReferences.map(({ anchor }) => anchor.y),
      );
      const right = Math.max(
        sceneRight,
        ...boundReferences.map(({ anchor }) => anchor.x + 216),
      );
      const bottom = Math.max(
        sceneBottom,
        ...boundReferences.map(({ anchor }) => anchor.y + 144),
      );
      return [{
        id: `image:${imageId}`,
        kind: "image" as const,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }];
    });

    const descriptionObjects = scopeFolder.descriptionIds.flatMap((descriptionId) => {
      if (arrangeImageIdByDescription.has(descriptionId)) return [];
      const reference = descriptionReferences.get(descriptionId);
      if (!reference) return [];
      return [{
        id: `description:${descriptionId}`,
        kind: "description" as const,
        x: reference.anchor.x,
        y: reference.anchor.y,
        width: 216,
        height: 144,
      }];
    });

    const folderObjects =
      scopeFolderId === currentBusiness.rootFolderId
        ? Object.values(currentBusiness.folders).flatMap((folder) => {
            if (folder.kind === "root") return [];
            const bounds = folderSceneBounds(currentBusiness, currentElements, folder.id);
            if (!bounds) return [];
            const surface = compactFolderSurfaceBounds(bounds);
            return [{
              id: `folder:${folder.id}`,
              kind: "folder" as const,
              ...surface,
            }];
          })
        : [];
    const objects = [...imageObjects, ...descriptionObjects, ...folderObjects];
    if (objects.length < 2) {
      setStatus(objects.length === 0 ? "当前层级没有可整理对象。" : "当前层级只有一个对象，无需整理。");
      return;
    }

    const zoom = Math.max(0.1, api.getAppState().zoom.value);
    const planned = arrangeCanvasObjects(objects, {
      maxRowWidth: Math.max(560 / zoom, (panel.clientWidth - 220) / zoom),
      horizontalGap: 28 / zoom,
      verticalGap: 32 / zoom,
      readingRowTolerance: 90 / zoom,
    });
    const originalById = new Map(objects.map((object) => [object.id, object] as const));
    const deltas = new Map(
      planned.map((placement) => {
        const original = originalById.get(placement.id)!;
        return [
          placement.id,
          { dx: placement.x - original.x, dy: placement.y - original.y },
        ] as const;
      }),
    );
    const movedCount = [...deltas.values()].filter(
      ({ dx, dy }) => Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01,
    ).length;
    if (movedCount === 0) {
      setStatus("当前层级已经是整理后的排列。");
      return;
    }

    queueGlobalHistoryCommit("host", "canvas-arrange");
    let nextElements = currentElements.map((element) => {
      if (
        element.isDeleted ||
        element.type !== "image" ||
        element.customData?.kind !== "image" ||
        typeof element.customData.imageId !== "string"
      ) return element;
      const delta = deltas.get(`image:${element.customData.imageId}`);
      return delta
        ? newElementWith(element, {
            x: element.x + delta.dx,
            y: element.y + delta.dy,
          })
        : element;
    });
    nextElements = [...synchronizeImageBoundSceneElements(nextElements, currentElements)];

    let nextBusiness: BusinessStateV2 = currentBusiness;
    descriptionObjects.forEach((object) => {
      const descriptionId = object.id.slice("description:".length);
      const reference = descriptionReferences.get(descriptionId);
      const delta = deltas.get(object.id);
      if (!reference || !delta) return;
      nextBusiness = migrateBusinessStateToV2(
        moveDescriptionReference(
          nextBusiness,
          descriptionId,
          { x: reference.anchor.x + delta.dx, y: reference.anchor.y + delta.dy },
          reference.imageBinding,
        ),
      );
    });
    arrangeImageIdByDescription.forEach((imageId, descriptionId) => {
      const reference = descriptionReferences.get(descriptionId);
      const delta = deltas.get(`image:${imageId}`);
      if (!reference || !delta) return;
      nextBusiness = migrateBusinessStateToV2(
        moveDescriptionReference(
          nextBusiness,
          descriptionId,
          { x: reference.anchor.x + delta.dx, y: reference.anchor.y + delta.dy },
          reference.imageBinding ?? null,
        ),
      );
    });
    folderObjects.forEach((object) => {
      const delta = deltas.get(object.id);
      if (!delta) return;
      const moved = moveFolderContents({
        business: nextBusiness,
        elements: nextElements,
        folderId: object.id.slice("folder:".length),
        dx: delta.dx,
        dy: delta.dy,
      });
      nextBusiness = moved.business;
      nextElements = [...moved.elements];
    });

    const reconciled = reconcileBusinessState(
      nextBusiness,
      asSceneElements(nextElements),
      new Set(Object.keys(latestFilesRef.current)),
    );
    nextBusiness = migrateBusinessStateToV2(
      reconcileDescriptionImageBindings(
        reconciled.state,
        Object.values(reconciled.state.imagePlacements)
          .filter((placement) => placement.active)
          .map((placement, zIndex) => ({
            imageId: placement.imageId,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            angle: placement.angle,
            scale: placement.scale,
            zIndex,
          })),
      ),
    );
    latestElementsRef.current = nextElements;
    commitBusiness(nextBusiness, "canvas-arrange", false);
    setIssues(reconciled.issues);
    renderCanonicalScene({
      canonical: nextElements,
      ownerState: nextBusiness,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    historyController.flush();
    setStatus(`已整理当前层级的 ${objects.length} 组对象；可一步撤销。`);
  }, [
    api,
    commitBusiness,
    historyController,
    queueGlobalHistoryCommit,
    renderCanonicalScene,
  ]);

  canvasShortcutActionRef.current = (shortcut) => {
    if (!api || busy) return;
    switch (shortcut) {
      case "selection":
        activateCanvasTool("selection", "选择工具");
        return;
      case "hand":
        activateCanvasTool("hand", "平移工具");
        return;
      case "laser":
        activateCanvasTool("laser", "激光笔");
        return;
      case "selection-tool":
        if (!selectedImageId) {
          setStatus("请先选择图片，再使用统一选区工具。");
          return;
        }
        chooseAnnotationSelection(lastSelectionTool);
        return;
      case "create-description":
        beginDescription();
        return;
      case "quick-annotation":
        beginQuickAnnotation();
        return;
      case "create-folder":
        if (folderNavigationRef.current.layer !== "overview") {
          setStatus("请先回到 Root 层，再新建 Folder。");
          return;
        }
        createFolderFromSelection();
        return;
      case "import-image":
        inputRef.current?.click();
        return;
      case "overview":
        showCanvasOverview();
        return;
      case "arrange":
        arrangeCurrentCanvas();
        return;
    }
  };

  const handleCanvasClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest(".scroll-back-to-content")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showCanvasOverview();
    },
    [showCanvasOverview],
  );

  const resetCanvasSession = useCallback(() => {
    if (!api) {
      return;
    }
    const reset = createCanvasSessionResetState();
    commitBusiness(reset.business);
    clearCanvasPointerSession();
    pendingRegionRef.current = null;
    pendingManualAnnotationRef.current = null;
    pendingOrdinaryTextBoxRef.current = null;
    pendingBubbleRef.current = false;
    latestElementsRef.current = [];
    latestFilesRef.current = {};
    folderProjectionRef.current = null;
    folderParentViewportRef.current = null;
    folderViewportRef.current = {};
    pendingFolderViewportRestoreRef.current = null;
    setFolderNavigation({ layer: "overview", selectedFolderId: null });
    folderNavigationRef.current = {
      layer: "overview",
      selectedFolderId: null,
    };
    const gridVisible = api.getAppState().gridModeEnabled;
    initialCanvasDataRef.current = {
      appState: {
        gridModeEnabled: gridVisible,
        ...canvasThemeAppState(workbenchPreferences.canvasTheme),
      },
    };
    api.resetScene();
    setWorkbenchPreferences((current) => ({
      ...current,
      gridVisible,
    }));
    setCanvasSessionKey((current) => current + 1);
    setIsCanvasHelpOpen(false);
    setPendingProjectOpen(null);
    setSelectedImageId(reset.selectedImageId);
    setSelectedCanvasImageId(reset.selectedCanvasImageId);
    setFocusImageIds(reset.focusImageIds);
    setSelectedRegionId(reset.selectedRegionId);
    setActiveDescriptionId(reset.activeDescriptionId);
    setDescriptionEditorFocusId(null);
    setIsDescriptionWorkspaceOpen(false);
    updateCanvasSelection(EMPTY_CANVAS_SELECTION);
    setSelectedBubbleAnnotation(null);
    setSelectedOrdinaryRectangle(false);
    setActiveSelectionTool(null);
    setActiveSelectionImageId(null);
    setIsDescriptionToolActive(false);
    setIsBubbleToolActive(false);
    setIsQuickAnnotationToolActive(false);
    setSelectedQuickAnnotationId(null);
    setManualAnnotationStage("idle");
    setAnnotationText("");
    setCodexContext(reset.codexContext);
    setIssues([]);
    setBenchmark(null);
    benchmarkRef.current = null;
    setAssetValidation(null);
    setStatus(
      "画布已重置，内容与选择状态均已清空。",
    );
  }, [api, clearCanvasPointerSession, commitBusiness, updateCanvasSelection, workbenchPreferences.canvasTheme]);

  const selectedImageElement = useCallback((): ExcalidrawImageElement | null => {
    if (!api || !boundImageId) {
      return null;
    }
    return (
      (api
        .getSceneElements()
        .find(
          (element) =>
            element.type === "image" &&
            element.customData?.imageId === boundImageId,
        ) as ExcalidrawImageElement | undefined) ?? null
    );
  }, [api, boundImageId]);

  const applyCenterCrop = useCallback(() => {
    if (!api || !boundImage || !boundImageId) {
      setStatus("请先选中一张图片或其 ROI。");
      return;
    }
    const imageElement = selectedImageElement();
    if (!imageElement) {
      setStatus("找不到所选图片元素。");
      return;
    }
    const cropped = newElementWith(imageElement, {
      crop: {
        x: boundImage.naturalWidth * 0.1,
        y: boundImage.naturalHeight * 0.1,
        width: boundImage.naturalWidth * 0.8,
        height: boundImage.naturalHeight * 0.8,
        naturalWidth: boundImage.naturalWidth,
        naturalHeight: boundImage.naturalHeight,
      },
    });
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((element) =>
          element.id === imageElement.id ? cropped : element,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setStatus("已通过公开 Scene API 应用中心 80% 裁剪。");
  }, [
    api,
    boundImage,
    boundImageId,
    selectedImageElement,
  ]);

  const clearCrop = useCallback(() => {
    if (!api) {
      return;
    }
    const imageElement = selectedImageElement();
    if (!imageElement) {
      setStatus("请先选中一张图片。");
      return;
    }
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((element) =>
          element.id === imageElement.id
            ? newElementWith(imageElement, { crop: null })
            : element,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setStatus("已移除图片裁剪。");
  }, [api, selectedImageElement]);

  const exportRegion = useCallback(
    async (kind: "crop" | "mask-original" | "mask-selection") => {
      if (!api || !selectedRegion?.geometry) {
        setStatus("请先选中一个坐标有效的 ROI。");
        return;
      }
      const imageAsset = businessRef.current.imageAssets[selectedRegion.imageId];
      if (!imageAsset) {
        setStatus("ROI 引用的 ImageAsset 缺失。");
        return;
      }
      const file = api.getFiles()[imageAsset.fileId];
      if (!file) {
        setStatus("图片像素数据缺失，无法导出。");
        return;
      }
      setBusy(true);
      try {
        if (kind === "crop") {
          const result = await createRegionPng(
            file.dataURL,
            selectedRegion.geometry.originalPixelBounds,
          );
          downloadBlob(result.blob, `${selectedRegion.id}-crop.png`);
          setStatus(
            `局部 PNG 已生成：${result.clippedBounds.width} × ${result.clippedBounds.height}。`,
          );
        } else {
          const mode =
            kind === "mask-original" ? "original-size" : "selection-size";
          const result = await createRegionMask(
            imageAsset.naturalWidth,
            imageAsset.naturalHeight,
            selectedRegion.geometry.originalPixelBounds,
            mode,
          );
          downloadBlob(
            result.blob,
            `${selectedRegion.id}-${mode}-mask.png`,
          );
          setStatus(`矩形蒙版已生成（${mode}）。`);
        }
      } catch (error) {
        const prefix =
          error instanceof PixelAccessError ? `${error.code}：` : "";
        setStatus(
          `导出失败：${prefix}${
            error instanceof Error ? error.message : "未知错误"
          }`,
        );
      } finally {
        setBusy(false);
      }
    },
    [api, selectedRegion],
  );

  const validateRegionAssets = useCallback(async () => {
    if (!api || !selectedRegion?.geometry) {
      setStatus("请先选中一个坐标有效的 ROI。");
      return;
    }
    const imageAsset = businessRef.current.imageAssets[selectedRegion.imageId];
    const file = imageAsset ? api.getFiles()[imageAsset.fileId] : null;
    if (!imageAsset || !file) {
      setStatus("ROI 引用的图片或像素数据缺失，无法验证。");
      return;
    }
    setBusy(true);
    try {
      const crop = await createRegionPng(
        file.dataURL,
        selectedRegion.geometry.originalPixelBounds,
      );
      const selectionMask = await createRegionMask(
        imageAsset.naturalWidth,
        imageAsset.naturalHeight,
        selectedRegion.geometry.originalPixelBounds,
        "selection-size",
      );
      const originalMask = await createRegionMask(
        imageAsset.naturalWidth,
        imageAsset.naturalHeight,
        selectedRegion.geometry.originalPixelBounds,
        "original-size",
      );
      const outOfBoundsCrop = await createRegionPng(file.dataURL, {
        x: -25,
        y: -18,
        width: imageAsset.naturalWidth * 0.1,
        height: imageAsset.naturalHeight * 0.1,
      });
      const result: AssetValidationResult = {
        regionId: selectedRegion.id,
        clippedBounds: crop.clippedBounds,
        cropBytes: crop.blob.size,
        selectionMaskBytes: selectionMask.blob.size,
        originalMaskBytes: originalMask.blob.size,
        outOfBoundsClipped: outOfBoundsCrop.clippedBounds,
        outOfBoundsCropBytes: outOfBoundsCrop.blob.size,
      };
      setAssetValidation(result);
      setStatus(
        `局部 PNG 与两种蒙版已在内存中生成：${crop.clippedBounds.width} × ${crop.clippedBounds.height}。`,
      );
    } catch (error) {
      const prefix =
        error instanceof PixelAccessError ? `${error.code}：` : "";
      setStatus(
        `资源验证失败：${prefix}${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }, [api, selectedRegion]);

  const prepareFocusedCodexContext = useCallback(async () => {
    if (!api) {
      setStatus("Excalidraw 尚未加载，无法准备上下文。");
      return;
    }
    const currentFocusImageIds = normalizeFocusedImageIds(
      businessRef.current,
      focusedImageIds,
      folderScopeId(
        folderNavigationRef.current,
        migrateBusinessStateToV2(businessRef.current),
      ),
    );
    if (currentFocusImageIds.length === 0) {
      setCodexContext(null);
      setStatus("请先将一张或多张图片设为本次重点，再准备给 Codex。");
      return;
    }

    const files = api.getFiles();
    const focusedImagePublications: {
      imageId: string;
      name: string;
      originalImageDataUrl: string;
    }[] = [];
    for (const imageId of currentFocusImageIds) {
      const image = businessRef.current.imageAssets[imageId];
      const file = image ? files[image.fileId] : null;
      if (!image || !file) {
        setCodexContext(null);
        setStatus("重点图片或像素数据缺失，无法准备 Codex 上下文。");
        return;
      }
      if (!isFocusedPublishableImageMimeType(image.mimeType)) {
        setCodexContext(null);
        setStatus(
          `重点图片仅支持 ${focusedPublishableImageFormatsLabel} 发布。`,
        );
        return;
      }
      focusedImagePublications.push({
        imageId,
        name: image.name,
        originalImageDataUrl: file.dataURL,
      });
    }

    const preflightError = getFocusedPublishPreflightError(
      focusedImagePublications.map((image) => ({
        name: image.name,
        dataUrl: image.originalImageDataUrl,
      })),
    );
    if (preflightError) {
      setCodexContext(null);
      setStatus(preflightError);
      return;
    }

    const appState = api.getAppState();
    const visibleSceneBounds = getVisibleSceneBounds(appState);
    const visibleElements = api
      .getSceneElements()
      .filter((element) =>
        isViewportVisibleElement(element, visibleSceneBounds),
      );
    const visibleRegionIds = visibleElements.flatMap((element) =>
      element.customData?.kind === "region"
        ? [associatedRegionId(element)].filter(
            (regionId): regionId is string => regionId !== null,
          )
        : [],
    );
    const hasDescriptionMode =
      activeDescriptionEntries(businessRef.current).length > 0;
    const visibleSelectionInstructions = hasDescriptionMode
      ? []
      : visibleElements.flatMap((element) => {
      const regionId = associatedRegionId(element);
      const instruction =
        element.customData?.kind === "region" &&
        typeof element.customData.selectionInstruction === "string"
          ? element.customData.selectionInstruction.trim()
          : "";
      return regionId && instruction
        ? [
            {
              id: `selection-instruction:${regionId}`,
              regionId,
              elementId: element.id,
              text: instruction,
              active: true,
            },
          ]
        : [];
        });
    const visibleAnnotationRegionIds = [
      ...visibleElements.flatMap((element) =>
        isFocusedAnnotationSemanticElementKind(element.customData?.kind)
          ? [associatedRegionId(element)].filter(
              (regionId): regionId is string => regionId !== null,
            )
          : [],
      ),
      ...visibleSelectionInstructions.map((instruction) => instruction.regionId),
    ];
    const focusedPublishBusiness: BusinessState = hasDescriptionMode
      ? businessRef.current
      : {
          ...businessRef.current,
          annotations: {
            ...businessRef.current.annotations,
            ...Object.fromEntries(
              visibleSelectionInstructions.map((instruction) => [
                instruction.id,
                instruction,
              ]),
            ),
          },
        };

    setBusy(true);
    try {
      const overviewSnapshot = await createCanvasSnapshot({
        elements: api.getSceneElements(),
        appState,
        files,
        viewportBounds: {
          x: visibleSceneBounds[0],
          y: visibleSceneBounds[1],
          width: visibleSceneBounds[2] - visibleSceneBounds[0],
          height: visibleSceneBounds[3] - visibleSceneBounds[1],
        },
      });
      const context = buildFocusedCanvasContext({
        business: focusedPublishBusiness,
        focusFolderId: folderScopeId(
          folderNavigationRef.current,
          migrateBusinessStateToV2(focusedPublishBusiness),
        ),
        focusImageIds: currentFocusImageIds,
        visibleRegionIds,
        visibleAnnotationRegionIds,
        overviewSnapshot: {
          filename: `${businessRef.current.document.id}-viewport.png`,
          mimeType: overviewSnapshot.mimeType,
          width: overviewSnapshot.width,
          height: overviewSnapshot.height,
          bytes: overviewSnapshot.bytes,
        },
      });
      const receipt = await publishFocusedCanvasContext({
        context,
        overviewSnapshotDataUrl: overviewSnapshot.dataUrl,
        focusedImages: focusedImagePublications,
      });
      setCodexContext(context);
      const visibleAnnotationCount = context.focusImages.reduce(
        (count, image) => count + image.visibleAnnotations.length,
        0,
      );
      setStatus(
        context.descriptions
          ? `已准备，等待 Codex 读取。已交接 ${context.descriptions.length} 条全局说明、${context.descriptionScopeLinks?.length ?? 0} 个平级范围关系、当前视窗概览和 ${context.focusImages.length} 张重点原图；版本 ${receipt.revision}。`
          : `已准备，等待 Codex 读取。已交接当前视窗概览、${context.focusImages.length} 张重点原图和 ${visibleAnnotationCount} 项当前可见标注语义；版本 ${receipt.revision}。`,
      );
    } catch (error) {
      const prefix =
        error instanceof CanvasContextBridgeError ||
        error instanceof CanvasSnapshotError
          ? `${error.code}：`
          : "";
      setCodexContext(null);
      setStatus(
        `准备或发布重点 Codex 上下文失败：${prefix}${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }, [api, focusedImageIds]);

  const prepareCodexContext = useCallback(async () => {
    if (!api) {
      setStatus("Excalidraw 尚未加载，无法准备上下文。");
      return;
    }
    if (selectedOrdinaryRectangle) {
      setCodexContext(null);
      setStatus(
        "当前选中的是普通矩形，仅用于画布图形，不能作为 Codex 选区。请使用“矩形选区”或“手绘选区”。",
      );
      return;
    }
    const activeRegion = selectedRegion?.geometry ? selectedRegion : null;
    if (selectedImageId && !activeRegion) {
      setCodexContext(null);
      setStatus(
        "当前选中的是原始图片，不是 Codex 选区。请先创建或点击一个标注选区。",
      );
      return;
    }
    if (!activeRegion) {
      setBusy(true);
      try {
        const receipt = await publishNoActiveRegion({
          documentId: businessRef.current.document.id,
        });
        setCodexContext(null);
        setStatus(
          `已向本机只读桥接发布无选区状态：${receipt.revision}。`,
        );
      } catch (error) {
        const prefix =
          error instanceof CanvasContextBridgeError ? `${error.code}：` : "";
        setStatus(
          `发布无选区状态失败：${prefix}${
            error instanceof Error ? error.message : "未知错误"
          }`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const imageId =
      activeRegion?.imageId ??
      selectedImageId ??
      (businessRef.current.document.imageAssetIds.length === 1
        ? businessRef.current.document.imageAssetIds[0]
        : null);
    if (!imageId) {
      setCodexContext(null);
      setStatus("当前画布没有可交接的选区。请先选择一张图片并创建选区。");
      return;
    }
    const imageAsset = businessRef.current.imageAssets[imageId];
    const file = imageAsset ? api.getFiles()[imageAsset.fileId] : null;
    if (!imageAsset || !file) {
      setStatus("原始图片或像素数据缺失，无法准备 Codex 上下文。");
      return;
    }
    if (!isBridgePublishableImageMimeType(imageAsset.mimeType)) {
      setCodexContext(null);
      setStatus(
        `桥接不支持当前原图格式；仅支持 ${bridgePublishableImageFormatsLabel}。未生成或发布 Codex 上下文。`,
      );
      return;
    }
    const activeRegionGeometry = activeRegion?.geometry;
    setBusy(true);
    try {
      const snapshot = await createCanvasSnapshot({
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      });
      const crop = activeRegionGeometry
        ? await createRegionPng(
            file.dataURL,
            activeRegionGeometry.originalPixelBounds,
          )
        : null;
      const context = buildCodexVisualContext({
        business: businessRef.current,
        imageId,
        regionId: activeRegion?.id ?? null,
        question: activeRegion
          ? annotationText.trim() || "未填写（未提供修改指令）"
          : undefined,
        crop: crop
          ? {
              clippedBounds: crop.clippedBounds,
              bytes: crop.blob.size,
            }
          : undefined,
        canvasSnapshot: {
          filename: `${imageAsset.id}-canvas.png`,
          mimeType: snapshot.mimeType,
          width: snapshot.width,
          height: snapshot.height,
          bytes: snapshot.bytes,
        },
      });
      setCodexContext(context);
      if (activeRegion && activeRegionGeometry && crop) {
        const receipt = await publishReadyCanvasContext({
          context,
          originalImageDataUrl: file.dataURL,
          canvasSnapshotDataUrl: snapshot.dataUrl,
        });
        setStatus(
          `Codex 视觉上下文已原子发布：原图、带自由画笔和标注卡的画布快照、标注选区、修改指令和 ${crop.clippedBounds.width} × ${crop.clippedBounds.height} 局部图均可确认；版本 ${receipt.revision}。`,
        );
      } else {
        const receipt = await publishNoActiveRegion({
          documentId: businessRef.current.document.id,
          context,
          originalImageDataUrl: file.dataURL,
          canvasSnapshotDataUrl: snapshot.dataUrl,
        });
        setStatus(
          `已向本机只读桥接发布无活动标注选区的带笔迹画布快照；原图和快照均可读取；版本 ${receipt.revision}。`,
        );
      }
    } catch (error) {
      const prefix =
        error instanceof PixelAccessError ||
        error instanceof CanvasContextBridgeError ||
        error instanceof CanvasSnapshotError
          ? `${error.code}：`
          : "";
      setStatus(
        `准备或发布 Codex 上下文失败：${prefix}${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }, [
    annotationText,
    api,
    selectedImageId,
    selectedOrdinaryRectangle,
    selectedRegion,
  ]);

  const downloadCodexContext = useCallback(() => {
    if (!codexContext) {
      setStatus("请先准备 Codex 视觉上下文。");
      return;
    }
    downloadBlob(
      new Blob([JSON.stringify(codexContext, null, 2)], {
        type: "application/json",
      }),
      isFocusedCanvasContext(codexContext)
        ? `${codexContext.document.id}-focused-context.json`
        : `${codexContext.selection?.regionId ?? codexContext.originalImage.imageId}-codex-context.json`,
    );
    setStatus("Codex 视觉上下文 JSON 已下载。");
  }, [codexContext]);

  const testCors = useCallback(async () => {
    setBusy(true);
    try {
      await probeRemotePixelRead(corsUrl);
      setStatus("远程图片允许跨域像素读取。");
    } catch (error) {
      const code = error instanceof PixelAccessError ? error.code : "ERROR";
      setStatus(
        `${code}：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setBusy(false);
    }
  }, [corsUrl]);

  const runBenchmark = useCallback(async () => {
    if (!api) {
      throw new Error("Excalidraw 尚未加载");
    }
    setBusy(true);
    setStatus("正在生成 3 张 4K 图片和 100 个 ROI 并运行浏览器基准……");
    try {
      const seeded = await seedBenchmarkScene(api);
      commitBusiness(seeded.business);
      const result = await runPerformanceBenchmark(
        api,
        seeded.business,
        seeded.seedSceneMs,
      );
      benchmarkRef.current = result;
      setBenchmark(result);
      setStatus("4K / 100 ROI 浏览器基准已完成。");
      return result;
    } catch (error) {
      setStatus(
        `性能基准失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, [api, commitBusiness]);

  useEffect(() => {
    if (!api) {
      return;
    }
    window.__AI_CANVAS_P0__ = {
      runPerformanceBenchmark: runBenchmark,
      save: saveBrowserCurrent,
      load: loadBrowserCurrent,
      getSummary: () => ({
        elements: api.getSceneElements().length,
        files: Object.keys(api.getFiles()).length,
        images: Object.keys(businessRef.current.imageAssets).length,
        regions: Object.keys(businessRef.current.regions).length,
        annotations: Object.keys(businessRef.current.annotations).length,
        aiExchanges: Object.keys(businessRef.current.aiExchanges).length,
        activeRegions: Object.values(businessRef.current.regions).filter(
          (region) => region.active,
        ).length,
        activeAnnotations: Object.values(
          businessRef.current.annotations,
        ).filter((annotation) => annotation.active).length,
      }),
      getBenchmark: () => benchmarkRef.current,
    };
    return () => {
      delete window.__AI_CANVAS_P0__;
    };
  }, [api, loadBrowserCurrent, runBenchmark, saveBrowserCurrent]);

  const selectedRegionExchanges = useMemo(
    () =>
      Object.values(business.aiExchanges).filter(
        (exchange) => exchange.regionId === selectedRegionId,
      ),
    [business.aiExchanges, selectedRegionId],
  );
  const canvasTheme = workbenchPreferences.canvasTheme;
  const hostDocumentGateRef = useRef(createHostDocumentOpenGate());
  const hostDocumentReceiverRef = useRef<(data: unknown) => void>(() => {});
  const pendingHostDocumentMessageRef = useRef<unknown>(null);
  const [hostDocumentResult, setHostDocumentResult] = useState<{ requestId: string; ok: boolean } | null>(null);
  hostDocumentReceiverRef.current = (data: unknown) => {
    if (!api) {
      pendingHostDocumentMessageRef.current = data;
      return;
    }
    const host = (window as Window & { chrome?: { webview?: { postMessage(message: unknown): void } } }).chrome?.webview;
    if (!host) return;
    const gate = hostDocumentGateRef.current;
    const offer = gate.acceptOffer(data);
    if (offer) {
      host.postMessage({ type: "canvas-document-open-ready", requestId: offer.requestId });
      return;
    }
    const document = gate.acceptDocument(data);
    if (!document) return;
    try {
      const project = parseAiCanvasProjectFile(document.content);
      const theme = canvasThemeAppState(readApplicationTheme()?.theme ?? workbenchPreferences.canvasTheme);
      pendingSavedRestoreRef.current = { requestId: document.requestId, userEpoch: documentUserEpochRef.current,
        expected: { elementIds: project.bundle.scene.elements.filter((element) => !element.isDeleted).map((element) => element.id),
          files: project.bundle.scene.files, theme: theme.theme, viewBackgroundColor: theme.viewBackgroundColor } };
      restoreProjectBundle(project.bundle, project.focusImageIds, project.focusFolderId, `已打开 ${document.name}。`, true);
    } catch (error) {
      setStatus(`打开项目失败：${error instanceof Error ? error.message : "未知错误"}`);
      setHostDocumentResult({ requestId: document.requestId, ok: false });
    }
  };
  useEffect(() => {
    const hostWebView = (
      window as Window & {
        chrome?: {
          webview?: {
            postMessage: (message: unknown) => void;
            addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
            removeEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
          };
        };
      }
    ).chrome?.webview;
    if (!hostWebView) return;
    const identity = nativeDocumentIdentity();
    const removeCloseResponder = identity ? installNativeDocumentCloseStateResponder(
      identity.documentId, () => nativeCloseStateRef.current(), hostWebView,
    ) : () => undefined;
    const onMessage = (event: { data: unknown }) => {
      const presentation = readHostDocumentPresentation(event.data, nativeDocumentIdentity()?.documentId ?? "");
      if (presentation) { setHostPresentation(current => current === presentation ? current : presentation); return; }
      const data = event.data as Record<string, unknown> | null;
      if (data?.type === "canvas-document-command" && (data.action === "save" || data.action === "save-as") &&
          data.documentId === nativeDocumentIdentity()?.documentId && typeof data.requestId === "string") {
        void nativeSaveActionRef.current(data.action === "save-as").then((result) => {
          sendNativeDocumentState(documentSaveRef.current.revision, documentSaveRef.current.dirty);
          hostWebView.postMessage({ type: "canvas-document-command-result", documentId: result.documentId,
            requestId: data.requestId, status: result.status, savedRevision: result.revision,
            revision: documentSaveRef.current.revision, dirty: documentSaveRef.current.dirty });
        });
        return;
      }
      hostDocumentReceiverRef.current(event.data);
    };
    const cancelLateOpen = (event: Event) => {
      if (event.isTrusted) { documentUserEpochRef.current++; hostDocumentGateRef.current.cancel(); }
    };
    hostWebView.addEventListener("message", onMessage);
    window.addEventListener("pointerdown", cancelLateOpen, true);
    window.addEventListener("keydown", cancelLateOpen, true);
    return () => {
      removeCloseResponder();
      hostWebView.removeEventListener("message", onMessage);
      window.removeEventListener("pointerdown", cancelLateOpen, true);
      window.removeEventListener("keydown", cancelLateOpen, true);
    };
  }, []);
  useEffect(() => {
    if (!api || pendingHostDocumentMessageRef.current === null) return;
    const pending = pendingHostDocumentMessageRef.current;
    pendingHostDocumentMessageRef.current = null;
    hostDocumentReceiverRef.current(pending);
  }, [api]);
  useEffect(() => {
    if (!hostDocumentResult) return;
    const host = (window as Window & { chrome?: { webview?: { postMessage(message: unknown): void } } }).chrome?.webview;
    host?.postMessage({ type: "canvas-document-open-result", ...hostDocumentResult });
  }, [hostDocumentResult]);
  useEffect(() => {
    if (!api) return;
    const host = (window as Window & { chrome?: { webview?: { postMessage(message: unknown): void } } }).chrome?.webview;
    return scheduleCanvasHostReady(host);
  }, [api]);
  useEffect(() => {
    const hostWebView = (
      window as Window & {
        chrome?: { webview?: { postMessage: (message: unknown) => void } };
      }
    ).chrome?.webview;
    if (!hostWebView) {
      return;
    }

    hostWebView.postMessage({
      type: "canvas-theme",
      header: CANVAS_THEMES[canvasTheme].header,
      documentId: nativeDocumentIdentity()?.documentId,
      palette: { header: CANVAS_THEMES[canvasTheme].header, canvas: CANVAS_THEMES[canvasTheme].canvas,
        text: CANVAS_THEMES[canvasTheme].text, mutedText: CANVAS_THEMES[canvasTheme].mutedText,
        icon: CANVAS_THEMES[canvasTheme].icon, accentSurface: CANVAS_THEMES[canvasTheme].accentSurface,
        accentText: CANVAS_THEMES[canvasTheme].accentText, surface: CANVAS_THEMES[canvasTheme].surface,
        raised: CANVAS_THEMES[canvasTheme].raised, border: CANVAS_THEMES[canvasTheme].border,
        accent: CANVAS_THEMES[canvasTheme].accent, danger: CANVAS_THEMES[canvasTheme].danger },
    });
  }, [canvasTheme]);
  const canvasShortcutRows = createCanvasShortcutRows(
    workbenchPreferences.shortcuts,
  );
  const canvasStatus = createCanvasStatusPresentation(status, busy, {
    selection: canvasSelection,
    imageLayer: folderNavigation.layer === "image",
    quickAnnotation: isQuickAnnotationToolActive,
    descriptionTool: isDescriptionToolActive,
    activeDescription: Boolean(activeDescriptionId),
    descriptionScopeCount: activeDescriptionRegionIds.size,
    selectedRegion: Boolean(selectedRegionId),
    selectedRectangle: Boolean(selectedOrdinaryRectangle),
    selectedImage: canvasSelection.imagePlacementIds.length === 1 &&
      canvasSelection.regionIds.length === 0 && canvasSelection.descriptionIds.length === 0,
  });
  const selectionToolLabel =
    lastSelectionTool === "rectangle"
      ? "矩形"
      : lastSelectionTool === "path"
        ? "路径"
        : "椭圆";
  const selectionToolIcon =
    lastSelectionTool === "rectangle"
      ? "rectangle"
      : lastSelectionTool === "path"
        ? "closed-selection"
        : "ellipse";
  const selectionToolPicker = (
    <div
      className={`selection-tool-picker ${isSelectionToolMenuOpen ? "is-open" : ""}`}
      onPointerEnter={() => {
        if (selectedImageId && !busy) setIsSelectionToolMenuOpen(true);
      }}
      onPointerLeave={() => setIsSelectionToolMenuOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsSelectionToolMenuOpen(false);
        }
      }}
      onKeyDown={(event) => {
        const options = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ),
        );
        const action = resolveSelectionToolMenuKey({
          key: event.key,
          currentIndex: options.indexOf(event.target as HTMLButtonElement),
          optionCount: options.length,
        });
        if (!action) return;
        event.preventDefault();
        if (action.type === "close") {
          setIsSelectionToolMenuOpen(false);
          event.currentTarget.querySelector<HTMLButtonElement>(
            ':scope > button[aria-haspopup="menu"]',
          )?.focus();
          return;
        }
        setIsSelectionToolMenuOpen(true);
        options[action.focusIndex]?.focus();
      }}
    >
      <button
        type="button"
        className={`tool-button tool-button--roi ${activeSelectionTool ? "is-active" : ""}`}
        aria-label={`选区工具，最近使用${selectionToolLabel}选区`}
        aria-haspopup="menu"
        aria-expanded={isSelectionToolMenuOpen}
        title={`选区（最近使用：${selectionToolLabel}）`}
        disabled={!selectedImageId || busy}
        onClick={() => setIsSelectionToolMenuOpen(true)}
      >
        <CanvasToolIcon name={selectionToolIcon} />
        <span>选区</span>
      </button>
      <div
        className={`selection-tool-picker__menu${
          hasSelectionToolContentUnderlay ? " has-content-underlay" : ""
        }`}
        role="menu"
        aria-label="选择选区类型"
      >
          {(
            [
              ["rectangle", "rectangle", "矩形选区"],
              ["path", "closed-selection", "路径选区"],
              ["ellipse", "ellipse", "椭圆选区"],
            ] as const
          ).map(([kind, icon, label]) => (
            <button
              key={kind}
              type="button"
              role="menuitemradio"
              aria-label={label}
              aria-checked={lastSelectionTool === kind}
              title={label}
              className={lastSelectionTool === kind ? "is-active" : ""}
              onClick={(event) => {
                chooseAnnotationSelection(kind);
                event.currentTarget
                  .closest<HTMLElement>(".selection-tool-picker")
                  ?.querySelector<HTMLButtonElement>(
                    ':scope > button[aria-haspopup="menu"]',
                  )
                  ?.focus();
              }}
            >
              <CanvasToolIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
      </div>
    </div>
  );
  const excalidrawWorkspaceUi = useMemo(
    () => (
      <>
        <MainMenu />
        <DefaultSidebar />
      </>
    ),
    [],
  );
  return (
    <main
      className={`app-shell app-shell--overview-reference is-theme-${canvasTheme} is-layer-${folderNavigation.layer} ${
        isDescriptionWorkspaceOpen ? "has-description-editor" : ""
      }`}
      data-canvas-theme={canvasTheme}
      data-host-presentation={hostPresentation}
      style={canvasThemeCssVariables(canvasTheme) as CSSProperties}
      onPointerDownCapture={handleAppPointerDownCapture}
      onContextMenuCapture={handleCanvasContextMenu}
    >
      <header className="app-header">
        <div className="app-brand-cluster">
          <div className="app-brand-badge" aria-label="AI Canvas">
            <strong>AI Canvas</strong>
          </div>
          <div className="canvas-workspace-menu canvas-workspace-menu--header">
            <button
              type="button"
              className="canvas-workspace-menu__trigger app-settings-trigger"
              aria-label="画布设置"
              aria-expanded={isCanvasMenuOpen}
              aria-controls="canvas-workspace-menu-panel-header"
              title="画布设置"
              disabled={!api || busy}
              onClick={() => setIsCanvasMenuOpen((open) => !open)}
            >
              <span className="app-settings-glyph" aria-hidden="true">⚙</span>
            </button>
            {isCanvasMenuOpen ? (
              <div
                id="canvas-workspace-menu-panel-header"
                className={`canvas-workspace-menu__panel${
                  hasCanvasMenuContentUnderlay ? " has-content-underlay" : ""
                }`}
                role="menu"
                aria-label="AI Canvas 画布设置"
              >
                <section className="canvas-settings-group" aria-label="项目">
                  <strong>项目</strong>
                  <button type="button" role="menuitem" onClick={() => {
                    const identity = nativeDocumentIdentity();
                    if (identity) nativeDocumentPort()?.postMessage({ type: "canvas-document-open-picker", documentId: identity.documentId });
                    else projectInputRef.current?.click();
                  }}>
                    <span>打开可编辑项目</span>
                    <CanvasToolIcon name="open" />
                  </button>
                  <button type="button" role="menuitem" onClick={() => {
                    applyCanvasMenuAction("save-project");
                    void saveProjectFile();
                  }}>
                    <span>保存／另存项目</span>
                    <CanvasToolIcon name="save" />
                  </button>
                  <button type="button" role="menuitem" onClick={() => {
                    applyCanvasMenuAction("export-image");
                    void exportCanvasImage();
                  }}>
                    <span>导出图片</span>
                    <CanvasToolIcon name="export" />
                  </button>
                </section>
                <section className="canvas-settings-group" aria-label="画布">
                  <strong>画布</strong>
                  <button type="button" role="menuitem" onClick={() => {
                    applyCanvasMenuAction("overview");
                    showCanvasOverview();
                  }}>
                    <span>全览画布</span>
                    <CanvasToolIcon name="overview" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={
                      folderNavigation.layer !== "overview" &&
                      folderNavigation.layer !== "folder"
                    }
                    onClick={arrangeCurrentCanvas}
                  >
                    <span>整理画布</span>
                    <CanvasToolIcon name="arrange" />
                  </button>
                  <button type="button" role="menuitem" onClick={openShortcutManager}>
                    <span>快捷键管理</span>
                    <CanvasToolIcon name="help" />
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={workbenchPreferences.gridVisible} onClick={toggleGrid}>
                    <span>网格</span>
                    <span>{workbenchPreferences.gridVisible ? "开" : "关"}</span>
                  </button>
                  <div className="canvas-workspace-menu__themes">
                    <span>主题</span>
                    <div>
                      {CANVAS_THEME_IDS.filter((themeId) => themeId !== "black").map((themeId) => {
                        const theme = CANVAS_THEMES[themeId];
                        return <button key={theme.id} type="button" className={canvasTheme === themeId ? "is-active" : ""} aria-label={`主题：${theme.label}`} aria-pressed={canvasTheme === themeId} title={`${theme.label}色主题`} style={{ "--theme-swatch": theme.canvas } as CSSProperties} onClick={() => setCanvasTheme(themeId)} />;
                      })}
                    </div>
                  </div>
                </section>
                <section className="canvas-settings-group canvas-settings-group--danger" aria-label="危险操作">
                  <strong>危险操作</strong>
                  <button type="button" role="menuitem" className="is-danger" onClick={() => {
                    applyCanvasMenuAction("reset");
                    resetCanvasSession();
                  }}>完整重置画布</button>
                </section>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="app-help-trigger"
            aria-label="帮助与快捷键"
            title="帮助与快捷键"
            disabled={!api || busy}
            onClick={() => {
              applyCanvasMenuAction("help");
              setIsCanvasHelpOpen(true);
            }}
          >
            <CanvasToolIcon name="help" />
          </button>
        </div>
        <output
          className="visually-hidden"
          data-testid="p0-summary"
          data-summary={JSON.stringify({
            elements: latestElementsRef.current.filter(
              (element) => !element.isDeleted,
            ).length,
            files: Object.keys(latestFilesRef.current).length,
            images: Object.keys(business.imageAssets).length,
            regions: Object.keys(business.regions).length,
            annotations: Object.keys(business.annotations).length,
            descriptions: Object.keys(business.descriptions).length,
            descriptionScopeLinks: Object.keys(
              business.descriptionScopeLinks,
            ).length,
            focusImages: focusImageIds.length,
            aiExchanges: Object.keys(business.aiExchanges).length,
            activeRegions: Object.values(business.regions).filter(
              (region) => region.active,
            ).length,
            activeAnnotations: Object.values(business.annotations).filter(
              (annotation) => annotation.active,
            ).length,
            issues: issues.length,
          })}
        >
          P0 state summary
        </output>
        <output
          className="visually-hidden"
          data-testid="benchmark-json"
          data-benchmark={benchmark ? JSON.stringify(benchmark) : ""}
        >
          P0 benchmark result
        </output>
        <output
          className="visually-hidden"
          data-testid="asset-validation"
          data-validation={
            assetValidation ? JSON.stringify(assetValidation) : ""
          }
        >
          P0 asset validation result
        </output>
        <output
          className="visually-hidden"
          data-testid="codex-context"
          data-context={codexContext ? JSON.stringify(codexContext) : ""}
        >
          Codex visual context
        </output>
      </header>

      <section
        className={`workspace workspace--context-bottom ${
          workbenchPreferences.contextPanelOpen ? "is-context-expanded" : ""
        }`}
      >
        {workbenchPreferences.contextPanelOpen ? (
          <div className="context-panel-backdrop" aria-hidden="true" />
        ) : null}
        <aside
          id="canvas-tool-rail"
          className="left-tool-rail"
          aria-label="画布工具"
        >
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImportImage(file);
              }
              event.target.value = "";
            }}
          />
          <input
            ref={projectInputRef}
            className="visually-hidden"
            type="file"
            accept=".excalidraw,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void prepareProjectOpen(file);
              }
              event.target.value = "";
            }}
          />
          {folderNavigation.layer === "folder" ? (
            <div className="tool-rail-group tool-rail-group--contextual">
              <button
                type="button"
                className="tool-button"
                aria-label="返回父级画布"
                title="返回父级画布"
                onClick={returnFromFolderLayer}
              >
                <CanvasToolIcon name="arrow" />
                <span>返回</span>
              </button>
            </div>
          ) : null}
          {folderNavigation.layer === "image" || folderNavigation.layer === "description" ? (
            <div className="tool-rail-group tool-rail-group--contextual">
              <button
                type="button"
                className="tool-button"
                aria-label="返回文件夹"
                title="返回文件夹"
                onClick={returnFromFolderLayer}
              >
                <CanvasToolIcon name="arrow" />
                <span>返回</span>
              </button>
              {folderNavigation.layer === "description" ? (
                <>
                  <button
                    type="button"
                    className={`tool-button ${
                      !isDescriptionToolActive && !isQuickAnnotationToolActive && activeCanvasToolType === "selection"
                        ? "is-active"
                        : ""
                    }`}
                    onClick={() => activateCanvasTool("selection", "选择工具")}
                  >
                    <CanvasToolIcon name="selection" />
                    <span>选择</span>
                  </button>
                  <button
                    type="button"
                    className={`tool-button ${activeCanvasToolType === "hand" ? "is-active" : ""}`}
                    onClick={() => activateCanvasTool("hand", "平移工具")}
                  >
                    <CanvasToolIcon name="hand" />
                    <span>平移</span>
                  </button>
                  {selectionToolPicker}
                  <button
                    type="button"
                    className="tool-button"
                    disabled={!api || busy}
                    onClick={showCanvasOverview}
                  >
                    <CanvasToolIcon name="overview" />
                    <span>全览</span>
                  </button>
                </>
              ) : (
                <>
                  {selectionToolPicker}
                  <button
                    type="button"
                    className={`tool-button ${isQuickAnnotationToolActive ? "is-active" : ""}`}
                    aria-label="快速标注"
                    aria-pressed={isQuickAnnotationToolActive}
                    title="快速标注：单击添加点标注，拖动添加矩形标注"
                    disabled={!api || busy || !hasCanvasImages}
                    onClick={beginQuickAnnotation}
                  >
                    <CanvasToolIcon name="bubble" />
                    <span>快速标注</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className="tool-rail-group" data-tool-scope="full">
            <button
              type="button"
              className={`tool-button ${
                !isDescriptionToolActive && !isQuickAnnotationToolActive && activeCanvasToolType === "selection"
                  ? "is-active"
                  : ""
              }`}
              aria-label="选择画布对象和选区"
              aria-pressed={!isDescriptionToolActive && !isQuickAnnotationToolActive && activeCanvasToolType === "selection"}
              title="选择画布对象和选区"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("selection", "选择工具")}
            >
              <CanvasToolIcon name="selection" />
              <span>选择</span>
            </button>
            <button
              type="button"
              className={`tool-button ${isDescriptionToolActive ? "is-active" : ""}`}
              aria-label="新建说明"
              aria-pressed={isDescriptionToolActive}
              title="新建说明"
              disabled={!api || busy}
              onClick={beginDescription}
            >
              <CanvasToolIcon name="description" />
              <span>说明</span>
            </button>
            <button
              type="button"
              className={`tool-button ${isQuickAnnotationToolActive ? "is-active" : ""}`}
              aria-label="快速标注"
              aria-pressed={isQuickAnnotationToolActive}
              title="快速标注：单击添加点标注，拖动添加矩形标注"
              disabled={!api || busy || !hasCanvasImages}
              onClick={beginQuickAnnotation}
            >
              <CanvasToolIcon name="bubble" />
              <span>快速标注</span>
            </button>
            <button
              type="button"
              className={`tool-button ${activeCanvasToolType === "hand" ? "is-active" : ""}`}
              aria-label="平移画布"
              aria-pressed={activeCanvasToolType === "hand"}
              title="平移画布"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("hand", "平移工具")}
            >
              <CanvasToolIcon name="hand" />
              <span>平移</span>
            </button>
            <button
              className="tool-button"
              aria-label="导入本地图片"
              title="导入本地图片"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <CanvasToolIcon name="image" />
              <span>导入</span>
            </button>
            {folderNavigation.layer === "overview" ? (
              <button
                type="button"
                className="tool-button"
                aria-label="建立文件夹"
                title="建立文件夹"
                disabled={!api || busy}
                onClick={createFolderFromSelection}
              >
                <CanvasToolIcon name="folder" />
                <span>建立文件夹</span>
              </button>
            ) : null}
            {selectionToolPicker}
          </div>
          <div
            className="tool-rail-group tool-rail-group--utility"
            data-tool-scope="full"
          >
            <button
              type="button"
              className={`tool-button ${activeCanvasToolType === "laser" ? "is-active" : ""}`}
              aria-label="激光笔"
              aria-pressed={activeCanvasToolType === "laser"}
              title="激光笔：仅作临时指示"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("laser", "激光笔")}
            >
              <CanvasToolIcon name="arrow" />
              <span>激光笔</span>
            </button>
            <button
              type="button"
              className="tool-button"
              aria-label="全览画布"
              title="全览画布"
              disabled={!api || busy}
              onClick={showCanvasOverview}
            >
              <CanvasToolIcon name="overview" />
              <span>全览</span>
            </button>
            <button
              type="button"
              className={`tool-button${workbenchPreferences.gridVisible ? " is-active" : ""}`}
              aria-label="网格"
              aria-pressed={workbenchPreferences.gridVisible}
              title={workbenchPreferences.gridVisible ? "关闭网格" : "打开网格"}
              disabled={!api || busy}
              onClick={toggleGrid}
            >
              <CanvasToolIcon name="grid" />
              <span>网格</span>
            </button>
          </div>

        </aside>

        <section
          ref={canvasPanelRef}
          className={`canvas-panel ${
            selectedCanvasImageId ? "is-imported-image-selected" : ""
          }`}
          onPointerDownCapture={handleCanvasPointerDownCapture}
          onPointerMoveCapture={handleCanvasPointerMoveCapture}
          onPointerUpCapture={handleCanvasPointerUpCapture}
          onPointerCancelCapture={handleCanvasPointerCancelCapture}
          onClickCapture={handleCanvasClickCapture}
          onDoubleClickCapture={handleCanvasDoubleClickCapture}
          onDragOverCapture={handleCanvasFileDragOverCapture}
          onDropCapture={handleCanvasFileDropCapture}
          aria-label="设计标注画布"
        >
          <div className="canvas-status-region" role="status" aria-live="polite" aria-atomic="true">
            <div className="header-status">
              <span className={busy ? "status-dot busy" : "status-dot"} aria-hidden="true" />
              <span>{canvasStatus.main}</span>
            </div>
            {canvasStatus.detail ? (
              <div className="canvas-selection-chip">{canvasStatus.detail}</div>
            ) : null}
          </div>
          <nav className="canvas-primary-toolbar" aria-label="Canvas 主工具带">
            <div className="canvas-workspace-menu">
              <button
                type="button"
                className="canvas-workspace-menu__trigger"
                aria-label="画布设置"
                aria-expanded={isCanvasMenuOpen}
                aria-controls="canvas-workspace-menu-panel"
                title="画布设置"
                disabled={!api || busy}
                onClick={() => setIsCanvasMenuOpen((open) => !open)}
              >
                <CanvasToolIcon name="menu" />
              </button>
              {isCanvasMenuOpen ? (
                <div
                  id="canvas-workspace-menu-panel"
                  className={`canvas-workspace-menu__panel${
                    hasCanvasMenuContentUnderlay ? " has-content-underlay" : ""
                  }`}
                  role="menu"
                  aria-label="AI Canvas 画布设置"
                >
                  <strong>画布</strong>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const identity = nativeDocumentIdentity();
                      if (identity) nativeDocumentPort()?.postMessage({ type: "canvas-document-open-picker", documentId: identity.documentId });
                      else projectInputRef.current?.click();
                    }}
                  >
                    <span>打开可编辑项目</span>
                    <CanvasToolIcon name="open" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      applyCanvasMenuAction("save-project");
                      void saveProjectFile();
                    }}
                  >
                    <span>保存／另存项目</span>
                    <CanvasToolIcon name="save" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      applyCanvasMenuAction("export-image");
                      void exportCanvasImage();
                    }}
                  >
                    <span>导出图片</span>
                    <CanvasToolIcon name="export" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      applyCanvasMenuAction("overview");
                      showCanvasOverview();
                    }}
                  >
                    <span>全览画布</span>
                    <CanvasToolIcon name="overview" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={
                      folderNavigation.layer !== "overview" &&
                      folderNavigation.layer !== "folder"
                    }
                    onClick={arrangeCurrentCanvas}
                  >
                    <span>整理画布</span>
                    <CanvasToolIcon name="arrange" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openShortcutManager}
                  >
                    <span>快捷键管理</span>
                    <CanvasToolIcon name="help" />
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={workbenchPreferences.gridVisible}
                    onClick={toggleGrid}
                  >
                    <span>网格</span>
                    <span>{workbenchPreferences.gridVisible ? "开" : "关"}</span>
                  </button>
                  <div className="canvas-workspace-menu__themes">
                    <span>主题</span>
                    <div>
                      {CANVAS_THEME_IDS.filter((themeId) => themeId !== "black").map((themeId) => {
                        const theme = CANVAS_THEMES[themeId];
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            className={canvasTheme === themeId ? "is-active" : ""}
                            aria-label={`主题：${theme.label}`}
                            aria-pressed={canvasTheme === themeId}
                            title={`${theme.label}色主题`}
                            style={{ "--theme-swatch": theme.canvas } as CSSProperties}
                            onClick={() => setCanvasTheme(themeId)}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      applyCanvasMenuAction("help");
                      setIsCanvasHelpOpen(true);
                    }}
                  >
                    <span>帮助与快捷键</span>
                    <CanvasToolIcon name="help" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      applyCanvasMenuAction("reset");
                      resetCanvasSession();
                    }}
                  >
                    完整重置画布
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={
                !isDescriptionToolActive && !isQuickAnnotationToolActive && activeCanvasToolType === "selection"
                  ? "is-active"
                  : ""
              }
              aria-label="选择画布对象和选区"
              aria-pressed={
                !isDescriptionToolActive && !isQuickAnnotationToolActive && activeCanvasToolType === "selection"
              }
              title="选择画布对象和选区"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("selection", "选择工具")}
            >
              <CanvasToolIcon name="selection" />
              <span>选择</span>
            </button>
            <button
              type="button"
              className={isDescriptionToolActive ? "is-active" : ""}
              aria-label="新建说明"
              aria-pressed={isDescriptionToolActive}
              title="新建说明：关联一个现有选区，或在右侧工作区新建零范围说明"
              disabled={!api || busy}
              onClick={beginDescription}
            >
              <CanvasToolIcon name="description" />
              <span>说明</span>
            </button>
            <button
              type="button"
              className={activeCanvasToolType === "hand" ? "is-active" : ""}
              aria-label="平移画布"
              aria-pressed={activeCanvasToolType === "hand"}
              title="平移画布"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("hand", "平移工具")}
            >
              <CanvasToolIcon name="hand" />
              <span>平移</span>
            </button>
            <button
              type="button"
              aria-label="全览画布"
              title="将图片、选区与说明缩放并居中到视窗"
              disabled={!api || busy}
              onClick={showCanvasOverview}
            >
              <CanvasToolIcon name="overview" />
              <span>全览</span>
            </button>
            <button
              type="button"
              className={activeCanvasToolType === "laser" ? "is-active" : ""}
              aria-label="激光笔"
              aria-pressed={activeCanvasToolType === "laser"}
              title="激光笔：仅作临时指示，不生成画布对象"
              disabled={!api || busy}
              onClick={() => activateCanvasTool("laser", "激光笔")}
            >
              <CanvasToolIcon name="arrow" />
              <span>激光笔</span>
            </button>
            <span className="canvas-primary-toolbar__separator" aria-hidden="true" />
          </nav>
          <Excalidraw
            key={canvasSessionKey}
            initialData={initialCanvasDataRef.current}
            excalidrawAPI={setApi}
            onChange={handleSceneChange}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerUpdate={handleClipboardPointerUpdate}
            onPaste={handleNativeClipboardPaste}
            langCode="zh-CN"
            name="AI Canvas"
            autoFocus
            handleKeyboardGlobally
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
              },
            }}
          >
            {excalidrawWorkspaceUi}
          </Excalidraw>
          {contextInformationData ? (
            <aside className="context-information" aria-label="当前上下文信息"
              data-idle-root={contextInformationData.kind === "folder" && contextInformationData.folder.kind === "root" &&
                !isDescriptionWorkspaceOpen && !selectedOrdinaryRectangle && !selectedQuickAnnotationId && !selectedBubbleAnnotation &&
                !Object.values(api?.getAppState().selectedElementIds ?? {}).some(Boolean) ? "true" : "false"}>
              {contextInformationData.kind === "selection" ? (
                <>
                  <span>已选对象</span>
                  <dl>
                    <div><dt>图片</dt><dd>{contextInformationData.imageCount} 张</dd></div>
                    <div><dt>选区</dt><dd>{contextInformationData.regionCount} 个</dd></div>
                    <div><dt>说明</dt><dd>{contextInformationData.descriptionCount} 条</dd></div>
                  </dl>
                </>
              ) : contextInformationData.kind === "image" ? (
                <>
                  <span>图片信息</span>
                  <dl>
                    <div>
                      <dt>名称</dt>
                      <dd
                        className="context-information__primary-value"
                        title={contextInformationData.image.name}
                      >
                        {contextInformationData.image.name}
                      </dd>
                    </div>
                    <div><dt>尺寸</dt><dd>{contextInformationData.image.naturalWidth} × {contextInformationData.image.naturalHeight}</dd></div>
                    <div><dt>格式</dt><dd>{contextInformationData.image.mimeType}</dd></div>
                    <div><dt>来源</dt><dd>{contextInformationData.image.source === "local" ? "本地导入" : "性能样本"}</dd></div>
                    <div><dt>说明</dt><dd>{contextInformationData.relatedDescriptionCount} 条关联</dd></div>
                  </dl>
                  {contextInformationData.dataURL ? <img src={contextInformationData.dataURL} alt="当前图片缩略图" /> : null}
                </>
              ) : contextInformationData.kind === "description" ? (
                <>
                  <span>说明信息</span>
                  <strong>{contextInformationData.description.text.trim() || "空白说明"}</strong>
                  <dl>
                    <div><dt>链接</dt><dd>{contextInformationData.description.referenceUrl || "未添加"}</dd></div>
                    <div><dt>选区</dt><dd>{contextInformationData.linkedRegionCount} 条关联</dd></div>
                  </dl>
                </>
              ) : (
                <>
                  <span>{contextInformationData.folder.kind === "root" ? "当前画布" : "当前文件夹"}</span>
                  <strong>{contextInformationData.folder.name}</strong>
                  <dl>
                    <div><dt>图片</dt><dd>{contextInformationData.folder.imageAssetIds.length} 张</dd></div>
                    <div><dt>说明</dt><dd>{contextInformationData.folder.descriptionIds.length} 条</dd></div>
                  </dl>
                </>
              )}
            </aside>
          ) : null}
            <FolderWorkspace
            navigation={folderNavigation}
            items={folderWorkspaceItems}
            descriptions={folderDescriptionItems}
            focusImageBounds={focusImageBounds}
              previewStage={folderPreviewStage}
            previewCoverBounds={folderPreviewCoverBounds}
              previewMotion={folderPreviewMotionState}
            previewClosing={folderPreviewClosing}
            onPreviewClosed={finishFolderPreviewClose}
            onPreviewReopen={reopenFolderPreview}
            selectedDescriptionIds={canvasSelection.descriptionIds}
            imageDropPreviews={folderDropImagePreviews}
            folderDropTargetId={folderDropTargetId}
            folderDropSuccessId={folderDropSuccessId}
            viewport={canvasViewport}
            disabled={!api || busy}
            hasImageSelection={canvasSelection.imagePlacementIds.length > 0}
            onSelectFolder={selectFolder}
            onEnterFolder={enterFolder}
            onMoveFolder={moveFolder}
            onBeginCanvasPan={() => {
              if (!api || busy || folderNavigationRef.current.layer !== "overview") return null;
              const { scrollX, scrollY, zoom } = api.getAppState();
              const startZoom = zoom.value;
              return (dx, dy) => {
                if (folderNavigationRef.current.layer !== "overview") return;
                api.updateScene({
                  appState: { scrollX: scrollX + dx / startZoom, scrollY: scrollY + dy / startZoom },
                  captureUpdate: CaptureUpdateAction.NEVER,
                });
              };
            }}
            onDeleteFolder={deleteFolder}
            onUngroupFolder={ungroupFolder}
            onSelectDescription={selectDescriptionObject}
            onMoveDescription={moveDescriptionObject}
            onMoveDescriptions={moveDescriptionObjects}
            onMoveCanvasSelection={moveCanvasSelectionFromDescription}
            onCancelCanvasSelectionMove={cancelCanvasSelectionFromDescription}
            onFolderDropTargetChange={handleFolderDropTargetChange}
          />
          <BubbleCanvasOverlay
            elements={visibleOverlayElements}
            selectedElementIds={nativeSelectionMirror}
            viewport={canvasViewport}
            onAnchorChange={handleBubbleAnchorChange}
          />
          <SelectionCanvasOverlay
            elements={visibleOverlayElements}
            selectedRegionIds={new Set(canvasSelection.regionIds)}
            highlightedRegionIds={boundRegionIds}
            regionBindings={descriptionRegionBindings}
            regionNumbers={selectionNumberByRegion}
            activeDescriptionId={activeDescriptionId}
            creationTool={
              folderNavigation.layer === "preview" ? null : activeSelectionTool
            }
            creationImageId={
              folderNavigation.layer === "preview" ? null : activeSelectionImageId
            }
            viewport={canvasViewport}
            previewMotion={previewSelectionMotion}
            maxHandleDiameterPx={
              folderNavigation.layer === "image" ? 12 : undefined
            }
            onCreateSelection={handleSelectionCreate}
            onCreationRejected={handleSelectionCreationRejected}
            onRegisterPathDraftUndo={registerPathDraftUndo}
            onSelectRegion={handleSelectionRegionSelect}
            onSelectRegionFromBadge={handleSelectionRegionBadgeSelect}
            onMoveRegion={handleSelectionMove}
            onVertexChange={handleSelectionVertexChange}
            onEllipseChange={handleSelectionEllipseChange}
            onActivateDescription={handleDescriptionSwitch}
          />
          <QuickAnnotationOverlay
            elements={visibleOverlayElements}
            readOnly={folderNavigation.layer === "preview"}
            previewMotion={previewSelectionMotion}
            annotations={Object.values(
              migrateBusinessStateToV2(business).quickAnnotations,
            )}
            nextOrdinal={
              migrateBusinessStateToV2(business).document
                .nextQuickAnnotationOrdinal
            }
            active={
              isQuickAnnotationToolActive &&
              folderNavigation.layer !== "preview"
            }
            disabled={!api || busy}
            selectedId={selectedQuickAnnotationId}
            viewport={canvasViewport}
            onCreate={handleQuickAnnotationCreate}
            onSelect={(annotationId) => {
              setSelectedQuickAnnotationId(annotationId);
              if (annotationId) {
                updateCanvasSelection(EMPTY_CANVAS_SELECTION);
                setSelectedRegionId(null);
                setActiveDescriptionId(null);
                setDescriptionEditorFocusId(null);
              }
            }}
            onSetCollapsed={handleQuickAnnotationCollapsed}
            onSetText={handleQuickAnnotationText}
            onMove={handleQuickAnnotationMove}
            onMoveLabel={handleQuickAnnotationLabelMove}
            onResize={handleQuickAnnotationResize}
          />
          {isDescriptionWorkspaceOpen &&
          activeDescriptionId &&
          folderNavigation.layer !== "preview" &&
          folderNavigation.layer !== "image" ? (
            <DescriptionWorkspace
              items={descriptionItems}
              scopeGroups={descriptionScopeGroups}
              activeDescriptionId={activeDescriptionId}
              editorFocusDescriptionId={descriptionEditorFocusId}
              open
              hasContentUnderlay={hasDescriptionEditorContentUnderlay}
              onOpenChange={handleDescriptionWorkspaceOpenChange}
              onCreate={() => createWorkspaceDescription(undefined, true)}
              onActivate={handleDescriptionActivate}
              onTextChange={handleDescriptionTextChange}
              onReferenceUrlChange={handleDescriptionReferenceUrlChange}
              onEditorFocus={handleDescriptionEditorFocus}
              onToggleScope={handleDescriptionScopeToggle}
              onFocusImage={focusDescriptionImage}
              onFocusScope={focusDescriptionScope}
            />
          ) : null}
          {canvasMarqueeRect && (
            <div
              className={`canvas-object-marquee is-${canvasMarqueeRect.mode}`}
              aria-hidden="true"
              style={{
                left: canvasMarqueeRect.left,
                top: canvasMarqueeRect.top,
                width: canvasMarqueeRect.width,
                height: canvasMarqueeRect.height,
              }}
            />
          )}
          <div
            ref={canvasViewControlsRef}
            className={`canvas-view-controls${
              hasCanvasViewControlsContentUnderlay ? " has-content-underlay" : ""
            }`}
            aria-label="画布视图控制"
          >
            <button
              type="button"
              className="canvas-view-controls__theme"
              aria-label={canvasTheme === "black" ? "切换浅色主题" : "切换黑色主题"}
              title={canvasTheme === "black" ? "切换浅色主题" : "切换黑色主题"}
              disabled={!api || busy}
              onClick={() =>
                setCanvasTheme(
                  resolveCanvasThemeToggle(
                    canvasTheme,
                    lastLightCanvasThemeRef.current,
                  ),
                )
              }
            >
              <CanvasToolIcon name={canvasTheme === "black" ? "sun" : "moon"} />
            </button>
            <button
              type="button"
              aria-label="缩小画布 10%"
              title="缩小画布 10%"
              disabled={!api || busy}
              onClick={() => adjustCanvasZoom(-1)}
            >
              −
            </button>
            <button
              type="button"
              className="canvas-view-controls__readout"
              aria-label="当前画布比例，点击回到 100%"
              title="点击回到 100%"
              disabled={!api || busy}
              onClick={() => setCanvasZoom(1)}
            >
              {Math.round(canvasViewport.zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="放大画布 10%"
              title="放大画布 10%"
              disabled={!api || busy}
              onClick={() => adjustCanvasZoom(1)}
            >
              ＋
            </button>
            {api && (folderNavigation.layer === "overview" || folderNavigation.layer === "folder") && (
              <ImageRotationFeedback key={canvasSessionKey} api={api}
                panelRef={canvasPanelRef} />
            )}
          </div>
        </section>

        <aside
          className={`context-panel context-panel--bottom ${
            workbenchPreferences.contextPanelOpen ? "is-expanded" : "is-collapsed"
          }`}
          aria-label="Codex 上下文面板"
        >
          <div className="context-panel-header">
            <div className="context-panel-summary-line">
              <CanvasToolIcon name="description" />
              <div>
                <strong>画布说明与交接</strong>
                <small>整理说明后，再交给 Codex</small>
              </div>
            </div>
            <div className="context-panel-header-actions">
              <button
                className="primary-button context-panel-publish"
                disabled={!api || busy || filledDescriptionCount === 0}
                onClick={() => void prepareFocusedCodexContext()}
              >
                Codex Read
              </button>
              <button
                className="context-panel-details-toggle"
                aria-expanded={workbenchPreferences.contextPanelOpen}
                aria-label={
                  workbenchPreferences.contextPanelOpen
                    ? "收起交接详情"
                    : "展开交接详情"
                }
                onClick={toggleContextPanel}
              >
                <CanvasToolIcon name="arrow" />
                <span className="visually-hidden">
                  {workbenchPreferences.contextPanelOpen ? "收起" : "展开"}
                </span>
              </button>
            </div>
          </div>

            <div className="context-panel-content">
              <CanvasBridgeConnection />
              <section className="context-preview" aria-label="当前视图预览">
                <p className="context-section-label">当前视图预览</p>
                {selectedRegionId ? (
                  <p className="selection-label">
                    已选选区：选区{selectedSelectionOrdinal?.index ?? "?"}
                    {boundImage ? ` · ${boundImage.name}` : ""}
                  </p>
                ) : activeDescriptionId ? (
                  <p className="selection-label">
                    已聚焦说明：
                    {activeDescriptionRegionIds.size === 0
                      ? "作用于整图／整张画布"
                      : `同步高亮 ${activeDescriptionRegionIds.size} 个平级范围`}
                  </p>
                ) : selectedOrdinaryRectangle ? (
                  <p className="selection-label selection-label--warning">
                    已选普通矩形：它仅用于画布图形，不能作为 Codex 选区。请使用左侧标注选区工具。
                  </p>
                ) : selectedImageId ? (
                  <p className="selection-label">
                    已选原始图片：使用左侧标注选区工具在图片上框选或圈选。
                  </p>
                ) : (
                  <>
                    <p className="selection-label">当前未选择对象，显示视窗概览。</p>
                    <dl className="viewport-metrics">
                      <div>
                        <dt>图片</dt>
                        <dd>{Object.keys(business.imageAssets).length}</dd>
                      </div>
                      <div>
                        <dt>选区</dt>
                        <dd>
                          {
                            Object.values(business.regions).filter(
                              (region) => region.active,
                            ).length
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>缩放</dt>
                        <dd>{Math.round(canvasViewport.zoom * 100)}%</dd>
                      </div>
                    </dl>
                  </>
                )}
                <p className="selection-total">
                  全项目选区：{selectionElements.length}
                </p>
              </section>

              <section className="context-focus" aria-label="本次重点图片">
                <p className="context-section-label">本次重点</p>
                {focusedImageIds.length > 0 ? (
                  <ul className="focus-image-list">
                    {focusedImageIds.map((imageId, index) => {
                      const image = business.imageAssets[imageId];
                        return (
                          <li key={imageId} className="focus-image-tag">
                            <span title={image?.name ?? imageId}>
                              重点 {index + 1} · {image?.name ?? imageId}
                            </span>
                          <button
                            disabled={busy}
                            onClick={() => removeImageFromFocus(imageId)}
                            aria-label={`移除重点 ${index + 1}`}
                          >
                            移除
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="selection-label selection-label--warning">
                    尚未设定重点图片。准备给 Codex 前必须至少设置一张重点。
                  </p>
                )}
                <button
                  disabled={
                    !selectedCanvasImage ||
                    busy ||
                    focusedImageIds.includes(selectedCanvasImage.id)
                  }
                  onClick={addSelectedImageToFocus}
                >
                  设为本次重点
                </button>
                <p className="focus-image-hint">
                  {selectedCanvasImage
                    ? `已直接选中“${selectedCanvasImage.name}”；画布选择本身不会自动成为重点。`
                    : "请直接点击一张图片后，再设为本次重点。点击选区或标注卡不会替代这一步。"}
                </p>
              </section>

              <div className="context-handoff">
              <section className="context-descriptions" aria-label="说明与交接">
                <p className="context-section-label">说明与交接</p>
                <dl className="description-overview-metrics">
                  <div>
                    <dt>有效说明</dt>
                    <dd>{filledDescriptionCount}</dd>
                  </div>
                  <div>
                    <dt>画布级</dt>
                    <dd>{canvasLevelDescriptionCount}</dd>
                  </div>
                  <div>
                    <dt>范围关系</dt>
                    <dd>{descriptionScopeLinkCount}</dd>
                  </div>
                </dl>
                {descriptionItems.length > 0 ? (
                  <ul className="description-overview-list">
                    {descriptionItems.map((description, index) => (
                      <li key={description.id}>
                        <button
                          type="button"
                          className={
                            activeDescriptionId === description.id
                              ? "is-active"
                              : ""
                          }
                          onClick={() => handleDescriptionActivate(description.id)}
                        >
                          <span>说明 {index + 1}</span>
                          <strong>
                            {description.text.trim() || "尚未填写正文"}
                          </strong>
                          <small>
                            {description.regionIds.length === 0
                              ? "整图／整张画布"
                              : `${description.regionIds.length} 个平级范围`}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="selection-label">
                    尚无说明。请使用上方“说明”关联现有选区，或从右侧工作区新建。
                  </p>
                )}
                <p className="description-overview-hint">
                  这里只负责总览与聚焦；说明正文在右侧说明工作区编辑。
                </p>
              </section>

              {codexContext ? (
                <section
                  className="codex-context-card"
                  aria-label="已准备的 Codex 视觉上下文"
                >
                  <h3>已准备上下文预览</h3>
                  {isFocusedCanvasContext(codexContext) ? (
                    <>
                      <dl>
                        <div>
                          <dt>当前视窗概览</dt>
                          <dd>
                            {codexContext.overviewSnapshot.width} ×{" "}
                            {codexContext.overviewSnapshot.height} · 仅含发布时视窗
                          </dd>
                        </div>
                        <div>
                          <dt>本次重点图片</dt>
                          <dd>{codexContext.focusImages.length} 张完整原图</dd>
                        </div>
                      </dl>
                      <ul className="focused-context-summary">
                        {codexContext.focusImages.map((image, index) => (
                          <li key={image.imageId}>
                            重点 {index + 1} · {image.name} · 当前视窗内 {image.visibleAnnotations.length} 项标注语义
                          </li>
                        ))}
                      </ul>
                      {codexContext.descriptions ? (
                        <>
                          <dl>
                            <div>
                              <dt>全局说明</dt>
                              <dd>{codexContext.descriptions.length} 条唯一正文</dd>
                            </div>
                            <div>
                              <dt>平级范围关系</dt>
                              <dd>
                                {codexContext.descriptionScopeLinks?.length ?? 0} 条
                              </dd>
                            </div>
                          </dl>
                          <p className="success">
                            全部说明与范围关系已交接；零范围明确表示整图／整张画布，旧标注卡未重复正文。
                          </p>
                        </>
                      ) : (
                        <p className="success">
                          当前为旧式兼容上下文；重点原图、概览与既有读取通道仍可用。
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <dl>
                        <div>
                          <dt>原始设计图片</dt>
                          <dd>
                            {codexContext.originalImage.name}
                            <br />
                            {codexContext.originalImage.naturalWidth} ×{" "}
                            {codexContext.originalImage.naturalHeight}
                          </dd>
                        </div>
                        <div>
                          <dt>带标注画布快照</dt>
                          <dd>
                            {codexContext.canvasSnapshot.width} ×{" "}
                            {codexContext.canvasSnapshot.height} · 含当前画笔标注
                          </dd>
                        </div>
                        <div>
                          <dt>当前标注选区</dt>
                          <dd>
                            {codexContext.selection
                              ? `${codexContext.selection.regionId} · 局部图 ${codexContext.selection.crop.width} × ${codexContext.selection.crop.height}`
                              : "当前无活动标注选区；未伪造选区语义。"}
                          </dd>
                        </div>
                        {codexContext.prompt && (
                          <div>
                            <dt>当前问题或备注</dt>
                            <dd>{codexContext.prompt.text}</dd>
                          </div>
                        )}
                      </dl>
                      {codexContext.prompt && (
                        <p
                          className={
                            codexContext.prompt.saved ? "success" : "warning"
                          }
                        >
                          {codexContext.prompt.saved
                            ? "修改指令已保存并与当前标注选区关联。"
                            : "上下文使用当前输入内容；该备注尚未保存。"}
                        </p>
                      )}
                    </>
                  )}
                </section>
              ) : (
                <p className="empty-state">
                  完成至少一条画布说明并设定重点后，可在这里核对全局说明、平级范围关系、当前视窗概览与重点原图。
                </p>
              )}
              </div>
            </div>
        </aside>

        <aside className="legacy-panel" hidden aria-hidden="true">
          <section className="panel-section">
            <h2>裁剪验证</h2>
            <button disabled={!boundImageId || busy} onClick={applyCenterCrop}>
              应用中心 80% 裁剪
            </button>
            <button disabled={!boundImageId || busy} onClick={clearCrop}>
              移除裁剪
            </button>
          </section>
          <section className="panel-section">
            <h2>CORS 像素读取</h2>
            <input
              value={corsUrl}
              onChange={(event) => setCorsUrl(event.target.value)}
              placeholder="https://example.com/image.jpg"
              aria-label="远程图片地址"
            />
            <button disabled={busy || !corsUrl} onClick={() => void testCors()}>
              测试远程像素读取
            </button>
          </section>
          <section className="panel-section benchmark-section">
            <h2>性能基准</h2>
            <button
              className="benchmark-button"
              disabled={!api || busy}
              onClick={() => void runBenchmark()}
            >
              运行 3×4K / 100 ROI
            </button>
            <p className="warning">此操作会用基准场景替换当前画布；请先保存。</p>
          </section>
          <label hidden>
              本地模拟回答
              <textarea
                value={mockAnswer}
                onChange={(event) => setMockAnswer(event.target.value)}
                rows={5}
              />
            </label>
            <button
              className="primary-button"
              disabled={!selectedRegionId || busy}
              onClick={saveMockAnswer}
              hidden
            >
              保存模拟 AI 回答
            </button>
            <button
              disabled={!selectedRegionId || busy}
              onClick={deleteSelectedRegion}
              hidden
            >
              删除选中 ROI（可撤销）
            </button>
            <button onClick={downloadCodexContext} hidden>
              下载上下文 JSON
            </button>

          <section className="panel-section" hidden>
            <h2>原图坐标</h2>
            {selectedRegion?.geometry ? (
              <>
                <dl className="coordinate-grid">
                  <div>
                    <dt>原图包围盒</dt>
                    <dd>
                      {formatNumber(
                        selectedRegion.geometry.originalPixelBounds.x,
                        1,
                      )}
                      ,{" "}
                      {formatNumber(
                        selectedRegion.geometry.originalPixelBounds.y,
                        1,
                      )}
                      <br />
                      {formatNumber(
                        selectedRegion.geometry.originalPixelBounds.width,
                        1,
                      )}{" "}
                      ×{" "}
                      {formatNumber(
                        selectedRegion.geometry.originalPixelBounds.height,
                        1,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>往返误差</dt>
                    <dd>
                      {formatNumber(
                        selectedRegion.geometry.roundTripMaxErrorPx,
                        6,
                      )}{" "}
                      px
                    </dd>
                  </div>
                  <div>
                    <dt>越界裁切</dt>
                    <dd>
                      {selectedRegion.geometry.isClipped ? "是" : "否"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>查看四角归一化坐标</summary>
                  <pre>
                    {JSON.stringify(
                      selectedRegion.geometry.normalizedCorners,
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div className="button-stack">
                  <button
                    disabled={busy}
                    onClick={() => void validateRegionAssets()}
                  >
                    验证局部图与蒙版（不下载）
                  </button>
                  <button disabled={busy} onClick={() => void exportRegion("crop")}>
                    下载局部 PNG
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void exportRegion("mask-selection")}
                  >
                    下载选区尺寸蒙版
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void exportRegion("mask-original")}
                  >
                    下载原图尺寸蒙版
                  </button>
                </div>
              </>
            ) : (
              <p className="empty-state">选择有效 ROI 后显示坐标。</p>
            )}
          </section>

          <section className="panel-section" hidden>
            <h2>关系完整性</h2>
            {issues.length === 0 ? (
              <p className="success">当前未发现悬空业务关系。</p>
            ) : (
              <ul className="issue-list">
                {issues.map((issue) => (
                  <li key={`${issue.code}-${issue.elementId}-${issue.businessId}`}>
                    <strong>{issue.code}</strong>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedRegionExchanges.map((exchange) => (
              <article className="answer-card" key={exchange.id}>
                <span>{exchange.provider}</span>
                <p>{exchange.answer}</p>
              </article>
            ))}
          </section>

          {benchmark && (
            <section className="panel-section benchmark-results" hidden>
              <h2>最近基准</h2>
              <dl className="metrics vertical">
                <div>
                  <dt>生成场景</dt>
                  <dd>{formatNumber(benchmark.seedSceneMs)} ms</dd>
                </div>
                <div>
                  <dt>保存 / 读取</dt>
                  <dd>
                    {formatNumber(benchmark.saveMs)} /{" "}
                    {formatNumber(benchmark.loadFromStorageMs)} ms
                  </dd>
                </div>
                <div>
                  <dt>平移缩放 P95</dt>
                  <dd>{formatNumber(benchmark.panZoom.p95FrameMs)} ms</dd>
                </div>
                <div>
                  <dt>ROI 编辑 P95</dt>
                  <dd>{formatNumber(benchmark.roiEdit.p95FrameMs)} ms</dd>
                </div>
                <div>
                  <dt>JS Heap</dt>
                  <dd>
                    {benchmark.heapAfterMb === null
                      ? "浏览器未提供"
                      : `${formatNumber(benchmark.heapAfterMb)} MB`}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </aside>
      </section>
      {pendingProjectOpen ? (
        <div className="canvas-dialog-backdrop" role="presentation">
          <section
            className="canvas-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-project-title"
          >
            <span className="canvas-dialog__eyebrow">打开可编辑项目</span>
            <h2 id="open-project-title">覆盖当前画布？</h2>
            <p>
              打开 <strong>{pendingProjectOpen.fileName}</strong> 会替换当前画布的图片、选区、说明、范围关系与项目状态。尚未保存的内容不会保留。
            </p>
            <div className="canvas-dialog__actions">
              <button type="button" onClick={() => setPendingProjectOpen(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={confirmProjectOpen}
              >
                覆盖并打开
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isShortcutManagerOpen ? (
        <div
          className="canvas-dialog-backdrop canvas-dialog-backdrop--shortcuts"
          role="presentation"
        >
          <section
            className="canvas-dialog canvas-dialog--shortcuts"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-shortcuts-title"
          >
            <div className="canvas-dialog__header">
              <div>
                <h2 id="canvas-shortcuts-title">快捷键管理</h2>
                <span className="canvas-dialog__eyebrow">仅保存在当前设备</span>
              </div>
              <button
                type="button"
                className="canvas-dialog__close"
                aria-label="关闭快捷键管理"
                onClick={() => {
                  setIsShortcutManagerOpen(false);
                  setShortcutCaptureId(null);
                  setShortcutFeedback(null);
                }}
              >
                <CanvasToolIcon name="arrow" />
              </button>
            </div>
            <p className="shortcut-manager__hint">
              点击键位开始录入。只接受字母或主键盘数字，最多搭配一个 Ctrl、Alt 或 Shift。
            </p>
            {shortcutFeedback ? (
              <p className="shortcut-manager__feedback" role="status">
                {shortcutFeedback}
              </p>
            ) : null}
            <ul className="shortcut-manager__list" aria-label="可配置快捷键">
              {canvasShortcutRows.map((row) => {
                const capturing = shortcutCaptureId === row.id;
                return (
                  <li key={row.id} className={capturing ? "is-capturing" : ""}>
                    <strong>{row.label}</strong>
                    <button
                      type="button"
                      className="shortcut-manager__binding"
                      aria-pressed={capturing}
                      onClick={() => {
                        setShortcutCaptureId(row.id);
                        setShortcutFeedback("正在录入：按 Escape 可取消。");
                      }}
                    >
                      {capturing ? "请按新的快捷键…" : row.display}
                    </button>
                    <button
                      type="button"
                      className="shortcut-manager__restore"
                      onClick={() => {
                        const restored = restoreCanvasShortcutDefault(
                          workbenchPreferences.shortcuts,
                          row.id,
                        );
                        setShortcutCaptureId(null);
                        if (!restored.ok) {
                          setShortcutFeedback(
                            `无法恢复${row.label}：默认键位已被${CANVAS_SHORTCUT_LABELS[restored.conflictId]}占用，当前配置保持不变。`,
                          );
                          return;
                        }
                        setWorkbenchPreferences((current) => ({
                          ...current,
                          shortcuts: restored.preferences,
                        }));
                        setShortcutFeedback(`已恢复${row.label}的默认键位。`);
                      }}
                    >
                      恢复默认
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="canvas-dialog__actions shortcut-manager__actions">
              <button
                type="button"
                onClick={() => {
                  setWorkbenchPreferences((current) => ({
                    ...current,
                    shortcuts: restoreAllCanvasShortcutDefaults(),
                  }));
                  setShortcutCaptureId(null);
                  setShortcutFeedback("已恢复全部九项默认键位。");
                }}
              >
                全部恢复默认
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => setIsShortcutManagerOpen(false)}
              >
                完成
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isCanvasHelpOpen ? (
        <div
          className="canvas-dialog-backdrop canvas-dialog-backdrop--help"
          role="presentation"
        >
          <section
            className="canvas-dialog canvas-dialog--help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-help-title"
          >
            <div className="canvas-dialog__header">
              <div>
                <h2 id="canvas-help-title">常用操作与快捷键</h2>
                <span className="canvas-dialog__eyebrow">画布帮助</span>
              </div>
              <button
                type="button"
                className="canvas-dialog__close"
                aria-label="收起画布帮助"
                onClick={() => setIsCanvasHelpOpen(false)}
              >
                <CanvasToolIcon name="arrow" />
              </button>
            </div>
            <dl>
              {canvasShortcutRows.map((row) => (
                <div key={row.id}><dt>{row.label}</dt><dd>{row.display}</dd></div>
              ))}
              <div><dt>临时平移</dt><dd>按住 Space（固定手势）</dd></div>
              <div><dt>删除选中对象</dt><dd>Delete</dd></div>
              <div><dt>撤销／重做</dt><dd>Ctrl + Z／Ctrl + Y</dd></div>
              <div><dt>说明</dt><dd>使用上方“说明”关联选区，或从右侧工作区新建</dd></div>
            </dl>
            <div className="canvas-dialog__developer">
              <strong>{CANVAS_HELP_DEVELOPER.label}</strong>
              <span>{CANVAS_HELP_DEVELOPER.email}</span>
            </div>
          </section>
        </div>
      ) : null}
      {canvasContext ? <CanvasContextMenu point={canvasContext.clientPoint} items={getCanvasContextItems(canvasContext)}
        onClose={closeCanvasContext} onCommand={(command, argument) => { void runCanvasContextCommand(command, argument); }}/> : null}
      {businessNotice ? <CanvasBusinessNotice notice={businessNotice} onDecision={closeBusinessNotice}/> : null}
    </main>
  );
};

export default App;
