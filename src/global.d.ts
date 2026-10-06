import type {
  PerformanceBenchmarkResult,
} from "./performance/benchmark";

declare global {
  interface Window {
    __AI_CANVAS_P0__?: {
      runPerformanceBenchmark: () => Promise<PerformanceBenchmarkResult>;
      save: () => Promise<void>;
      load: () => Promise<void>;
      getSummary: () => {
        elements: number;
        files: number;
        images: number;
        regions: number;
        annotations: number;
        aiExchanges: number;
      };
      getBenchmark: () => PerformanceBenchmarkResult | null;
    };
  }
}

export {};
