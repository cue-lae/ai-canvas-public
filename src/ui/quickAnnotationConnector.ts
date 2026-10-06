import type { Bounds, Point } from "../domain/types";

export type ConnectorSide = "left" | "right";

/** Derived screen geometry only; never changes the stored label placement. */
export function resolveQuickAnnotationConnector(
  anchor: Point,
  label: Bounds,
  previousSide?: ConnectorSide,
) {
  const center = label.x + label.width / 2;
  const buffer = Math.min(8, label.width / 4);
  const side: ConnectorSide = anchor.x < center - buffer ? "left"
    : anchor.x > center + buffer ? "right"
    : previousSide ?? (anchor.x <= center ? "left" : "right");
  const target = {
    x: label.x + (side === "right" ? label.width : 0),
    y: label.y + label.height / 2,
  };
  const direction = Math.sign(target.x - anchor.x) || 1;
  const span = Math.abs(target.x - anchor.x);
  const path = `M ${anchor.x} ${anchor.y} C ${anchor.x + direction * span * 0.55} ${anchor.y}, ${target.x - direction * span * 0.55} ${target.y}, ${target.x} ${target.y}`;
  return { side, target, path };
}
