export type CanvasMenuAction =
  | "save-project"
  | "export-image"
  | "overview"
  | "help"
  | "reset"
  | "project-read-pending"
  | "tool-switch"
  | "outside-pointerdown"
  | "marquee-start"
  | "move-start"
  | "escape";

export type CanvasMenuStateSetter = (
  updater: (current: boolean) => boolean,
) => void;

export const transitionCanvasMenuOpen = (
  menuOpen: boolean,
  action: CanvasMenuAction,
): boolean => {
  switch (action) {
    case "tool-switch":
    case "outside-pointerdown":
    case "marquee-start":
    case "move-start":
    case "escape":
      return false;
    default:
      return menuOpen;
  }
};

export const createCanvasMenuActionHandler = (
  setMenuOpen: CanvasMenuStateSetter,
) => (action: CanvasMenuAction): void => {
  setMenuOpen((current) => transitionCanvasMenuOpen(current, action));
};
