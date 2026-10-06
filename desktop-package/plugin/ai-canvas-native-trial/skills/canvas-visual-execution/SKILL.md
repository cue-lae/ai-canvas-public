---
name: canvas-visual-execution
description: Generate or edit images from published AI Canvas context while enforcing every Canvas selection as an exact edit mask. Use when an image change must stay inside Canvas-selected regions.
---

# Canvas Visual Execution

Use this skill when a published AI Canvas context contains an image, one or more selections, and a visual change to apply. The Canvas selection is the authoritative edit boundary.

## Installed plugin workflow

Read Canvas only with this plugin's native `ai_canvas_native_trial` tool. If that tool is missing, report native loading unavailable; never substitute a project/manual MCP or shell read. Obtain the actual original image and complete source-image selection geometry from that result. Do not use a viewport screenshot as the original. If a tool image cannot be saved losslessly through the available environment, stop and ask for the original attachment; do not reconstruct it.

Resolve the script path relative to this SKILL.md, not a development checkout. The helper discovers the registered installation and uses its bundled Node and image tools. Do not download dependencies, edit Codex settings or bypass execution restrictions. An installed application is required. Generated work belongs in a new user-authorized artifact directory, never inside the plugin or application directory.

Both modes preserve decoded source pixels, including alpha, outside the binary mask; output is a new PNG. JPEG source comparison means decoded pixels, not identical compressed file bytes. Mask geometry uses the original source pixel grid; polygons use even-odd fill and geometry is intersected with the source bounds. Ellipses accept two diagonal corners or four ordered affine corners. Missing geometry, unknown type, zero-area geometry or an empty per-selection mask fails closed. Never replace rotation or skew with an axis-aligned bounding box.

Commands through `scripts/run-visual.ps1`:

- `info <source>`: dimensions.
- `mask <geometry.json> <new-mask.png> <width> <height>`: exact binary mask and per-selection pixel counts.
- `composite <source> <candidate> <mask.png> <new-output.png>`: candidate compositing; candidate-only resizing is permitted.
- `tint <source> <mask.png> <RRGGBB> <new-output.png>`: deterministic recoloring with source luminance and alpha retained.
- `material <source> <reference> <mask.png> <mapping.json> <new-output.png>`: deterministic bilinear reference sampling through an explicit four-corner perspective mapping, retaining source luminance and alpha. Mapping requires `normalizedCorners` in source coordinates in top-left, top-right, bottom-right, bottom-left reference order. It must cover every selected pixel. Do not guess mapping or stretch a reference when visual review rejects it.

For a generative request, first use an available image-generation capability to create a candidate, then composite and inspect it. These helpers do not generate images or grant model access. If generation is unavailable, say so; do not silently run deterministic mode. Deterministic mode requires the user's explicit choice. Run masks and checks for each selection; do not treat a union-only metric as sufficient per-selection review.

## Hard boundary rule

- Convert **every** published selection into a pixel mask in the source image's coordinate system before generating or editing.
- Support all selection types exposed by Canvas: rectangle, ellipse, and path/freeform selections. Do not narrow the task to rectangles.
- Combine masks only when the user explicitly asks to edit multiple selections together; otherwise keep each selection's scope distinguishable.
- The generated image may change inside the mask only. Pixels outside the union of the requested masks must remain unchanged.
- If the published context lacks complete geometry, source-image dimensions, or an unambiguous image-to-selection mapping, stop and report insufficient selection data. Never redraw or guess a boundary from the natural-language description.

## Executable mask workflow

1. Read the latest published Canvas context and identify the source image, selection geometry, selection type, and associated description.
2. Map each selection from Canvas coordinates or normalized coordinates to the exact source-image pixel grid.
3. Write a geometry JSON file with `selections`; each item uses `type` (`rectangle`, `ellipse`, or `path`) and normalized `points` or `normalizedCorners`.
4. Build the hard mask with the bundled helper:

   `powershell.exe -NoProfile -File <this-skill-directory>/scripts/run-visual.ps1 mask geometry.json selection-mask.png <source-width> <source-height>`

   The helper writes a same-size binary PNG mask with black outside and white inside every requested selection. Rectangles and paths are polygons; ellipses use their two corner points.
5. Call the image-generation capability to make a candidate. The candidate is provisional: prompt coordinates or a model-side mask are not evidence of exact containment.
6. Always perform a raster composite after generation. Use the original image as the complete base, copy candidate pixels only where the binary mask is white, and copy the original pixels everywhere else. Use the bundled `run-visual.ps1 composite` command; do not use an SVG preview as the enforcement step.
7. The composite must use the same source dimensions. If the candidate has another size, resize it only as an intermediate candidate before masking; never resize the source or the mask. Reject mismatched source/mask dimensions.
8. Re-open the written PNG and compare every pixel outside the mask with the original. Any non-zero outside-mask difference is a hard failure and the image must not be returned. Also inspect the selected regions for the requested material and preserved architectural details.
9. Return the generated image only after both checks pass, together with the edited selections, source dimensions, selected-pixel count, and `outsideChanged=0` evidence.

## Shared visual integrity gates

These checks apply to both generative and deterministic modes as post-processing review gates only. They do not change the selected coordinates, mask construction, reference mapping, compositing algorithm, or deterministic output path.

- Preserve the source perspective, geometry, openings, occlusion, edge structure, and frozen details unless the edit contract explicitly changes them.
- The requested material or color must read as part of the target surface: its scale, orientation, edge transition, luminance, and local contrast must be compatible with the surrounding scene.
- Reject hard rectangular seams, stretched or tiled reference patterns, floating-decal appearance, inconsistent grain direction, and lighting or shadow responses that contradict the source.
- Review each edited selection independently and confirm that neighboring content and every unselected pixel remain unchanged.
- If a deterministic candidate fails one of these gates, correct only the deterministic material mapping or blending parameters in a new external round; do not introduce a generative step or alter the mask to make the result appear better.

## Multi-round generation and review

Use this workflow when the first candidate is visually incomplete, misplaced, or otherwise fails the requested result while the source image, selection geometry, and edit intent remain unchanged.

### Single-pass first

- Default to one complete generation attempt. Run the automatic gates and independent per-selection visual review immediately; if they pass, stop and return that candidate without creating another round.
- Multi-round execution is a recovery path, not a required ceremony. Start another isolated round only for a concrete failure such as material misplacement, color leakage, structural distortion, or an unverifiable gate.
- “One generation” means one candidate is exposed to the user. It does not mean the system may skip validation or promise that a generative model will always succeed on its first attempt.

### Generative aesthetic brief and quality gates

Before calling the image-generation capability, write a compact visual brief for the round. Reusable fields are: the subject's role in the scene, the intended material hierarchy, the lighting and color relationship, the perspective/scale to preserve, the details that must remain unchanged, and explicit negative constraints. Do not replace this brief with vague style words such as “高级”“豪华” or “更有设计感”.

- Treat a reference image as evidence for material character, color range, grain direction, lighting response, and finish—not as a full rectangular texture to stretch across the target.
- Preserve the target's existing geometry, openings, perspective, occlusion, edge wear, and local luminance unless the user explicitly asks to change them. A material change should read as part of the surface, not as a floating decal.
- Give each selection a clear visual role and hierarchy: one dominant material or color change, supporting detail only where it serves that role, and no new focal object, text, logo, or unrelated style drift.
- Match material scale and orientation to the target surface. Reject candidates with stretched reference patterns, repeated seams, wrong grain direction, inconsistent scale, hard rectangular edges, or lighting that contradicts the surrounding scene.
- Review transitions at the selection boundary and at architectural/content features inside the selection. A candidate can satisfy the pixel mask and still fail if windows, joints, shadows, or structural lines are visually overwritten.
- Prefer controlled local variation over uniform pasted texture: preserve source luminance and occlusion cues, vary material response with the target surface, and avoid a single flat color wash when the requested reference implies a structured material.
- The visual review must answer four questions independently: Is the requested material recognizable? Is it correctly located and scaled? Does it belong to the target surface under the existing light? Did it preserve the scene's hierarchy and all frozen details? Any “no” is a visual rejection even when automatic mask checks pass.

These aesthetic gates are adapted from the project's mature space-design guidance for material hierarchy, atmosphere, lighting coherence, constructability, and operational clarity. They guide the generative candidate only; they never relax the exact Canvas selection boundary or turn a reference into a project-wide style rule.

### Deterministic mode

When the user explicitly prioritizes guaranteed placement over generative variation, use a more deterministic local-compositing path: map the approved reference material or transformation into each exact mask, preserve source luminance/edge structure where appropriate, and avoid asking the generative model to decide placement. This mode still requires the same mask, dimension, outside-pixel, per-selection, and visual checks. It improves positional repeatability but may reduce creative variation, so it must not be silently substituted for a generative request.

1. **Keep rounds isolated.** Create a new external round directory for every candidate (for example, `experiment-001`, `experiment-002`). Preserve the source, geometry, masks, scripts, crops, reports, and rejected candidates from earlier rounds. Never overwrite a prior round and never write intermediate output into the formal project workspace, Git checkout, or project `temp/` unless that location was explicitly authorized.
2. **Rebuild from a trusted baseline.** If a candidate failed visual review, do not blindly keep layering corrections onto it. Prefer the original source image or the last independently reviewed-good region as the baseline, then apply the requested edits again. This prevents artifacts, misplaced material, or color from leaking between selections and rounds.
3. **Run the automatic gates on every round.** Re-check source/output dimensions, mask dimensions, outside-mask pixel equality, total selected pixels, and per-selection changed-pixel counts. A round is not ready for review if any gate fails or if only a union mask was checked while individual selections were not.
4. **Review each selection independently.** Re-open the composite and a crop for every selection. Confirm the requested material or visual change is in the intended selection, architectural/content details are preserved, and no neighboring selection contains a leaked color, texture, object, or structural change. A visually plausible full composite is not sufficient evidence by itself.
5. **Continue autonomously within the fixed contract.** When the target image, input, selection semantics, reference direction, and external-only boundary are unchanged, the execution may diagnose the concrete failure and run additional rounds without asking for per-round user approval. Failed intermediate candidates remain external and are not presented as final results.
6. **Use concrete rejection reasons.** A rejected round must record the exact defect and the next correction, such as “redwood texture appears in selection 1” or “selection 3 is offset from the intended pier.” Do not report a generic failure or silently change the target.
7. **Separate execution completion from total-control approval.** The execution may report `待总控复核` only after its automatic gates and its own per-selection visual check pass. The total-control reviewer must independently inspect the final composite and selection crops. If the reviewer rejects it, the reviewer sends the concrete defect back and the execution continues with the next isolated round. Only total-control approval permits a user-facing “passed” report.
8. **Stop on boundary changes or hard risk.** Autonomous rounds do not authorize changing the source image, selection geometry or meaning, reference direction, output contract, formal project path, product scope, Git/deployment boundary, or mask policy. Stop and report if geometry is lost or ambiguous, the input changes, the tool cannot preserve the boundary, output evidence is unverifiable, or any write escapes the external experiment directory.

The final report must distinguish: automatic mask evidence, per-selection visual evidence, rejected-round history, unresolved items, and whether browser/device or product-chain acceptance was performed. An experiment-only pass never implies that the production product or the user has accepted the result.

## Failure behavior

Fail closed when geometry is missing, ambiguous, clipped without a defined policy, or cannot be mapped to source pixels. Ask for a fresh Canvas publication or a supported geometry payload rather than approximating the region.

The commercial-space-design skill may supply material and architectural interpretation, but it does not override this skill's selection boundary.
