import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";

const stylesSource = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Description workspace scope styling contract", () => {
  it("keeps image summaries transparent or softly purple on hover", () => {
    expect(stylesSource).toContain(
      ".description-workspace__image-summary:hover:not(:disabled),",
    );
    expect(stylesSource).toContain(
      ".description-workspace__image-summary:focus-visible {",
    );
    expect(stylesSource).toContain("padding: 0 4px;");
    expect(stylesSource).toContain(
      "background: color-mix(in srgb, var(--canvas-accent-surface) 72%, transparent);",
    );
    expect(stylesSource).toContain("background: transparent;");
    expect(stylesSource).not.toContain(
      ".description-workspace.has-content-underlay .description-workspace__image-summary",
    );
  });

  it("keeps scope buttons transparent until an underlay is present", () => {
    expect(stylesSource).toContain(
      ".description-workspace__scope-row > button:not(.description-workspace__scope-toggle) {",
    );
    expect(stylesSource).toContain("background: transparent;");
    expect(stylesSource).toContain(
      ".description-workspace.has-content-underlay",
    );
    expect(stylesSource).toContain(
      "background: color-mix(in srgb, var(--canvas-raised) 53%, transparent);",
    );
    expect(stylesSource).toContain(
      ".description-workspace:not(.has-content-underlay)",
    );
    expect(stylesSource).toContain("color: var(--canvas-accent-text);");
    expect(stylesSource).toContain(
      "background: color-mix(in srgb, var(--canvas-accent-surface) 72%, transparent);",
    );
  });

  it("keeps unlinked toggles transparent and linked toggles softly purple", () => {
    expect(stylesSource).toContain(
      ".description-workspace__scope-row > .description-workspace__scope-toggle {",
    );
    expect(stylesSource).toContain("background: transparent;");
    expect(stylesSource).toContain(
      ".description-workspace__scope-row.is-linked > .description-workspace__scope-toggle {",
    );
    expect(stylesSource).toContain(
      "background: color-mix(in srgb, var(--canvas-accent-surface) 72%, transparent);",
    );
    expect(stylesSource).toContain(
      ".description-workspace:not(.has-content-underlay)",
    );
  });
});
