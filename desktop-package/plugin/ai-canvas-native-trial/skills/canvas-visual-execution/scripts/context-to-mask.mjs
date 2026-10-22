import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSelectionGeometry } from './make-mask.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function selectionsFromContext(context, imageId, regionIds) {
  if (!context || typeof context !== 'object' || context.version !== 1 ||
      !['ai-canvas-codex-visual-context', 'ai-canvas-focused-context'].includes(context.format)) {
    throw new Error('A supported published Canvas context is required');
  }
  if (!nonempty(imageId) || !Array.isArray(regionIds) || regionIds.length === 0 ||
      regionIds.some(id => !nonempty(id)) || new Set(regionIds).size !== regionIds.length) {
    throw new Error('Choose one explicit imageId and distinct nonempty regionIds');
  }
  const focused = context.format === 'ai-canvas-focused-context';
  const images = focused ? context.focusImages : [context.originalImage];
  if (!Array.isArray(images)) throw new Error('Published original image metadata is missing');
  const matches = images.filter(image => image?.imageId === imageId);
  if (matches.length !== 1 || matches[0].pixelsAvailable !== true) {
    throw new Error('The requested image has no unambiguous published original; a description scope alone is insufficient');
  }
  const image = matches[0];
  if (!Number.isInteger(image.naturalWidth) || !Number.isInteger(image.naturalHeight) ||
      image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('Original source dimensions are unavailable');
  const requested = new Set(regionIds), occurrences = new Map(regionIds.map(id => [id, []]));
  const collect = (region, ownerId) => {
    if (!region || !requested.has(region.regionId)) return;
    if (ownerId !== imageId || (region.imageId !== undefined && region.imageId !== ownerId)) {
      throw new Error(`Region ${region.regionId} belongs to another image`);
    }
    if (region.selectionGeometry === undefined || region.selectionGeometry === null) {
      throw new Error(`Region ${region.regionId} has no exact selection geometry; publish it again, never infer from bounds`);
    }
    const geometry = validateSelectionGeometry(region.selectionGeometry, image.naturalWidth, image.naturalHeight);
    occurrences.get(region.regionId).push(geometry);
  };
  if (focused) {
    for (const focusImage of images) {
      if (!Array.isArray(focusImage?.visibleAnnotations)) throw new Error('Published visible annotations are missing');
      for (const annotation of focusImage.visibleAnnotations) collect(annotation, focusImage.imageId);
    }
    if (context.descriptionScopes !== undefined && !Array.isArray(context.descriptionScopes)) {
      throw new Error('Published description scopes are invalid');
    }
    for (const scope of context.descriptionScopes ?? []) collect(scope, scope?.imageId);
  } else if (context.selection) {
    collect(context.selection, context.selection.imageId);
  }
  return {
    selections: regionIds.map(id => {
      const copies = occurrences.get(id);
      if (!copies.length) throw new Error(`Requested region ${id} is not in the published context`);
      if (copies.some(geometry => JSON.stringify(geometry) !== JSON.stringify(copies[0]))) {
        throw new Error(`Conflicting duplicate geometry for region ${id}`);
      }
      return { id, ...copies[0] };
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, imageId, ...regionIds] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) {
    throw new Error('Use context.json new-geometry.json imageId regionId...');
  }
  const geometry = selectionsFromContext(JSON.parse(await readFile(input, 'utf8')), imageId, regionIds);
  await writeFile(output, `${JSON.stringify(geometry, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ imageId, regionIds, selections: geometry.selections.length }));
}
