const EXACT_ANGLE_EPSILON = 1e-7;

export const imageRotationReadout = (radians: number) => {
  let degrees = ((radians * 180 / Math.PI + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(degrees + 180) < EXACT_ANGLE_EPSILON) degrees = 180;
  if (Math.abs(degrees) < EXACT_ANGLE_EPSILON) degrees = 0;
  const cardinal = Math.round(degrees / 90) * 90;
  const aligned = Math.abs(degrees - cardinal) < EXACT_ANGLE_EPSILON;
  const rounded = Number(degrees.toFixed(1));
  const approximateCardinal = !aligned && rounded % 90 === 0;
  const integer = Math.round(degrees);
  const text = aligned ? String(cardinal) :
    Math.abs(degrees - integer) < EXACT_ANGLE_EPSILON ? String(integer) : degrees.toFixed(1);
  return {
    label: `${approximateCardinal ? "≈" : ""}${text}°`,
    axis: aligned ? (Math.abs(cardinal) === 90 ? "vertical" : "horizontal") : null,
  } as const;
};
