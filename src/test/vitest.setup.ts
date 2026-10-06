if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(contextId: string) {
      if (contextId === "2d") {
        return { filter: "none" };
      }

      return null;
    },
  });
}
