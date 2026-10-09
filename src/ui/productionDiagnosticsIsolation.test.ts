import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
// @ts-expect-error Tests run on Node; the application intentionally omits Node types.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const compile = async (development: boolean) => (await transformWithEsbuild(source, "App.tsx", {
  loader: "tsx",
  define: { "import.meta.env.DEV": String(development) },
  charset: "utf8",
  minifySyntax: true,
})).code;

describe("production diagnostics isolation", () => {
  it("eliminates the global diagnostic interface and hidden test panel from production code", async () => {
    const code = await compile(false);
    expect(code).not.toContain("__AI_CANVAS_P0__");
    expect(code).not.toContain("legacy-panel");
    expect(code).not.toContain("保存模拟 AI 回答");
  });
  it("retains the existing diagnostics for development builds", async () => {
    const code = await compile(true);
    expect(code).toContain("__AI_CANVAS_P0__");
    expect(code).toContain("legacy-panel");
    expect(code).toContain("保存模拟 AI 回答");
  });
});
