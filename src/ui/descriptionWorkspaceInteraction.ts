export const DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX = 20;
export const DESCRIPTION_WORKSPACE_DRAG_THRESHOLD_PX = 4;

export interface DescriptionWorkspaceDragInput {
  startOpen: boolean;
  startX: number;
  currentX: number;
  travel: number;
}

export interface DescriptionWorkspaceDragResult {
  moved: boolean;
  progress: number;
  open: boolean;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Drawer progress is view-only: 0 is fully open and 1 is fully collapsed.
 * It deliberately carries no description or canvas business state.
 */
export const descriptionWorkspaceDragResult = ({
  startOpen,
  startX,
  currentX,
  travel,
}: DescriptionWorkspaceDragInput): DescriptionWorkspaceDragResult => {
  const deltaX = currentX - startX;
  const moved = Math.abs(deltaX) >= DESCRIPTION_WORKSPACE_DRAG_THRESHOLD_PX;
  const safeTravel = Math.max(1, travel);
  const startProgress = startOpen ? 0 : 1;
  const progress = clamp(startProgress + deltaX / safeTravel, 0, 1);

  return {
    moved,
    progress,
    open: moved ? progress < 0.5 : startOpen,
  };
};

export const descriptionWorkspaceToggle = (open: boolean) => !open;
