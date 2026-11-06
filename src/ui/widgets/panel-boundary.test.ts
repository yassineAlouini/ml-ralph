import { describe, expect, test } from "bun:test";
import { formatLogHealth } from "./knowledge-panel.tsx";
import { PanelBoundary, panelFailureText } from "./panel-boundary.tsx";

describe("PanelBoundary", () => {
  test("a render error puts the boundary into its failed state", () => {
    expect(PanelBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({
      error: "boom",
    });
    expect(PanelBoundary.getDerivedStateFromError("plain")).toEqual({
      error: "plain",
    });
  });

  test("the failed state names the panel and the error", () => {
    expect(panelFailureText("research", "boom")).toBe(
      "research panel failed: boom",
    );
  });
});

describe("formatLogHealth", () => {
  test("is empty for a clean log", () => {
    expect(formatLogHealth(0, 0)).toBeNull();
  });

  test("counts skipped lines and events with issues", () => {
    expect(formatLogHealth(3, 12)).toBe(
      "3 log lines skipped · 12 events with issues",
    );
    expect(formatLogHealth(1, 0)).toBe("1 log line skipped");
    expect(formatLogHealth(0, 1)).toBe("1 event with issues");
  });
});
