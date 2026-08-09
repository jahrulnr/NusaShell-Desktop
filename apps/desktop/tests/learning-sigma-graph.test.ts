// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const sigmaConstruct = vi.fn();

vi.mock("sigma", () => ({
  default: class Sigma {
    constructor() {
      sigmaConstruct();
    }
  },
}));
vi.mock("sigma/rendering", () => ({ EdgeArrowProgram: class EdgeArrowProgram {} }));
vi.mock("@sigma/edge-curve", () => ({ EdgeCurvedArrowProgram: class EdgeCurvedArrowProgram {} }));

import { LearningSigmaGraph } from "../src/renderer/learning-sigma-graph.js";

describe("LearningSigmaGraph reducer lifecycle", () => {
  it("does not construct Sigma while its container has no dimensions", () => {
    const container = document.createElement("div");
    const controller = new LearningSigmaGraph(container);

    controller.mount([{ id: "one", label: "One", kind: "skill", state: "active" }], []);

    expect(sigmaConstruct).not.toHaveBeenCalled();
    expect(controller.sigma).toBeNull();
  });

  it("does not recursively re-enter when Sigma emits during setting updates", () => {
    const controller = new LearningSigmaGraph(null as never);
    const graph = {
      order: 1,
      mapNodes: () => [],
      degree: () => 0,
    };
    const sigma = {
      setSetting: vi.fn(() => controller.applyReducers()),
      refresh: vi.fn(),
    };
    controller.graph = graph as never;
    controller.sigma = sigma as never;

    expect(() => controller.applyReducers()).not.toThrow();
    expect(sigma.setSetting).toHaveBeenCalledTimes(4);
    expect(sigma.refresh).toHaveBeenCalledOnce();
  });

  it("keeps isolated nodes visible in a large graph", () => {
    const controller = new LearningSigmaGraph(null as never);
    let nodeReducer: ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const graph = {
      order: 41,
      mapNodes: () => [0],
      degree: () => 0,
    };
    const sigma = {
      setSetting: vi.fn((name, value) => {
        if (name === "nodeReducer") nodeReducer = value;
      }),
      refresh: vi.fn(),
    };
    controller.graph = graph as never;
    controller.sigma = sigma as never;
    controller.cameraRatio = 1;

    controller.applyReducers();

    expect(nodeReducer?.("memory:one", { timestamp: 0 }).hidden).not.toBe(true);
  });
});
