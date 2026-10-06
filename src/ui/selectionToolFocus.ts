type FocusableToolbarElement = {
  closest(selector: string): unknown;
  blur(): void;
};

export const releaseSelectionToolFocus = (
  activeElement: FocusableToolbarElement,
): boolean => {
  if (!activeElement.closest(".selection-tool-picker")) {
    return false;
  }
  activeElement.blur();
  return true;
};
