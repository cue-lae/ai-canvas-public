export type CanvasToolIconName =
  | "arrange"
  | "arrow"
  | "bubble"
  | "closed-selection"
  | "description"
  | "ellipse"
  | "freedraw"
  | "grid"
  | "hand"
  | "image"
  | "line"
  | "library"
  | "menu"
  | "moon"
  | "more"
  | "open"
  | "overview"
  | "export"
  | "folder"
  | "help"
  | "rectangle"
  | "reload"
  | "save"
  | "selection"
  | "sun";

/**
 * Keeps the product rail in the same 24px, rounded-line visual language as
 * the pinned Excalidraw 0.18.1 toolbar. Matching tools reuse that toolbar's
 * geometry; the product-only bubble follows the same stroke grammar.
 */
export const CanvasToolIcon = ({ name }: Readonly<{ name: CanvasToolIconName }>) => {
  const props = {
    "aria-hidden": true,
    className: "canvas-tool-icon",
    "data-tool-icon": name,
    fill: "none",
    focusable: false,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "arrange":
      return (
        <svg {...props} strokeWidth="1.35">
          <rect x="4" y="5" width="6" height="5" rx="1" />
          <rect x="13" y="5" width="7" height="5" rx="1" />
          <rect x="4" y="14" width="9" height="5" rx="1" />
          <rect x="16" y="14" width="4" height="5" rx="1" />
        </svg>
      );
    case "menu":
      return (
        <svg {...props} strokeWidth="1.5">
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      );
    case "moon":
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M19.2 14.6A7.8 7.8 0 0 1 9.4 4.8a7.8 7.8 0 1 0 9.8 9.8Z" />
        </svg>
      );
    case "sun":
      return (
        <svg {...props} strokeWidth="1.4">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
          <path d="M12 1.75v3M20.7 7l-3.07 1.77M20.7 17l-3.07-1.77M12 19.25v3M3.3 17l3.07-1.77M3.3 7l3.07 1.77" />
        </svg>
      );
    case "overview":
      return (
        <svg {...props} strokeWidth="1.35">
          <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          <rect x="8" y="8" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "library":
      return (
        <svg {...props} strokeWidth="1.35">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
        </svg>
      );
    case "open":
      return (
        <svg {...props} strokeWidth="1.35">
          <path d="M3.5 7.5h6l2-2h9v13h-17z" />
          <path d="m7.5 12 4-4 4 4M11.5 8v7" />
        </svg>
      );
    case "export":
      return (
        <svg {...props} strokeWidth="1.35">
          <path d="M5 10v10h14V10" />
          <path d="m8 7 4-4 4 4M12 3v11" />
        </svg>
      );
    case "help":
      return (
        <svg {...props} strokeWidth="1.35">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.9.5-1.3 1-1.3 2M12 17h.01" />
        </svg>
      );
    case "selection":
      return (
        <svg {...props} strokeWidth="1.25">
          <path stroke="none" d="M0 0h24v24H0z" />
          <path d="M6 6l4.153 11.793a.365 .365 0 0 0 .331 .207a.366 .366 0 0 0 .332 -.207l2.184 -4.793l4.787 -1.994a.355 .355 0 0 0 .213 -.323a.355 .355 0 0 0 -.213 -.323l-11.787 -4.36z" />
          <path d="M13.5 13.5l4.5 4.5" />
        </svg>
      );
    case "freedraw":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="m7.643 15.69 7.774-7.773a2.357 2.357 0 1 0-3.334-3.334L4.31 12.357a3.333 3.333 0 0 0-.977 2.357v1.953h1.953c.884 0 1.732-.352 2.357-.977Z" />
          <path d="m11.25 5.417 3.333 3.333" />
        </svg>
      );
    case "rectangle":
      return (
        <svg {...props} strokeWidth="1.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      );
    case "closed-selection":
      return (
        <svg {...props} strokeWidth="1.25">
          <path
            d="M7.1 7.5c2.4-2.9 7.5-3.5 10.3-.5c2.5 2.7 1.8 7.2-1.1 9.3c-3 2.2-7.4 1.1-9.1-1.6"
            strokeDasharray="2 2"
          />
          <path d="m6.4 14.7-2.8 3.4 4.3-.7" />
        </svg>
      );
    case "ellipse":
      return (
        <svg {...props} strokeWidth="1.35">
          <ellipse cx="12" cy="12" rx="8" ry="5.5" />
        </svg>
      );
    case "bubble":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="M5.2 17.5c-1.4-1.4-2.2-3.2-2.2-5.2c0-4.3 4-7.8 9-7.8s9 3.5 9 7.8s-4 7.8-9 7.8c-1.4 0-2.8-.3-4-.8L4 21l1.2-3.5Z" />
          <path d="M8.3 12.3h.01M12 12.3h.01M15.7 12.3h.01" strokeWidth="2" />
        </svg>
      );
    case "description":
      return (
        <svg {...props} strokeWidth="1.25">
          <circle cx="6.5" cy="7" r="2.25" fill="currentColor" stroke="none" />
          <path d="M10.5 5.25h7A2.5 2.5 0 0 1 20 7.75v6.5a2.5 2.5 0 0 1-2.5 2.5H10l-3.5 2v-7.2" />
          <path d="M11.5 9h5M11.5 12.5h3.5" />
        </svg>
      );
    case "hand":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5" />
          <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5" />
          <path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5" />
          <path d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -5.2-3c-.4-.6-1.4-2.4-3.3-5.8a1.5 1.5 0 0 1 .5-2a1.9 1.9 0 0 1 2.3.3l1.5 1.5" />
        </svg>
      );
    case "image":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="M12.5 6.667h.01" />
          <path d="M4.91 2.625h10.18a2.284 2.284 0 0 1 2.285 2.284v10.182a2.284 2.284 0 0 1-2.284 2.284H4.909a2.284 2.284 0 0 1-2.284-2.284V4.909a2.284 2.284 0 0 1 2.284-2.284Z" />
          <path d="m3.333 12.5 3.334-3.333c.773-.745 1.726-.745 2.5 0l4.166 4.166" />
          <path d="m11.667 11.667.833-.834c.774-.744 1.726-.744 2.5 0l1.667 1.667" />
        </svg>
      );
    case "grid":
      return (
        <svg {...props} strokeWidth="1.5">
          <path d="M3 6h18M3 12h18M3 18h18M6 3v18M12 3v18M18 3v18" />
        </svg>
      );
    case "save":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="M5 3h11l3 3v15H5z" />
          <path d="M8 3v6h8V3M8 20v-6h8v6" />
        </svg>
      );
    case "reload":
      return (
        <svg {...props} strokeWidth="1.25">
          <path d="M20 11a8 8 0 1 0 1 4.1" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case "more":
      return (
        <svg {...props} strokeWidth="1.5">
          <path d="M12 3l-4 7h8z" />
          <circle cx="17" cy="17" r="3" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
        </svg>
      );
    case "folder":
      return (
        <svg {...props} strokeWidth="1.35">
          <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
          <path d="M3.5 9.5h17" />
        </svg>
      );
    case "line":
      return (
        <svg {...props} strokeWidth="1.5">
          <path d="M4.167 10h11.666" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...props} strokeWidth="1.5">
          <path d="M5 12h14M15 8l4 4l-4 4" />
        </svg>
      );
  }
};
