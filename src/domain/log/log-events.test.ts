import { describe, expect, test } from "bun:test";
import { type LogEvent, parseLog, parseLogLine } from "./log-events.ts";

const line = (o: unknown) => JSON.stringify(o);

const HYPOTHESIS = {
  ts: "2026-01-01T00:00:00Z",
  type: "hypothesis",
  id: "H-1",
  claim: "bigger batch helps",
  expected_delta: 0.01,
  rubrics: ["batch size changed"],
  kill_criterion: "no gain",
};

function only(text: string): LogEvent {
  const { events, rejected } = parseLog(text);
  expect(rejected).toEqual([]);
  expect(events).toHaveLength(1);
  return events[0] as LogEvent;
}

describe("parseLog: well-formed events", () => {
  test("a valid hypothesis comes back typed, with its line and no issues", () => {
    const e = only(line(HYPOTHESIS));
    if (e.type !== "hypothesis") throw new Error(e.type);
    const claim: string = e.claim;
    expect(claim).toBe("bigger batch helps");
    expect(e.expected_delta).toBe(0.01);
    expect(e.ts).toBe("2026-01-01T00:00:00Z");
    expect(e.meta.line).toBe(1);
    expect(e.meta.issues).toEqual([]);
  });

  test("events keep file order and their 1-based line numbers; blank lines are skipped", () => {
    const text = [
      line({ ts: "b", type: "learning", insight: "second", source: "x" }),
      "",
      line({ ts: "a", type: "learning", insight: "first?", source: "x" }),
    ].join("\n");
    const { events, rejected } = parseLog(text);
    expect(rejected).toEqual([]);
    expect(events.map((e) => e.meta.line)).toEqual([1, 3]);
    expect(events.map((e) => e.ts)).toEqual(["b", "a"]);
  });
});

describe("parseLog: lenient reading", () => {
  test("a research entry without source reads as an empty source plus an issue", () => {
    const e = only(
      line({ ts: "t", type: "research", topic: "x", findings: "y" }),
    );
    if (e.type !== "research") throw new Error(e.type);
    expect(e.source).toBe("");
    expect(e.key_insights).toEqual([]);
    expect(e.meta.issues.some((i) => i.startsWith("source:"))).toBe(true);
  });

  test("a missing number reads as undefined, never 0", () => {
    const e = only(line({ ...HYPOTHESIS, expected_delta: undefined }));
    if (e.type !== "hypothesis") throw new Error(e.type);
    expect(e.expected_delta).toBeUndefined();
    expect(e.meta.issues.some((i) => i.startsWith("expected_delta:"))).toBe(
      true,
    );
  });

  test("a numeric string is read as a number, with an issue", () => {
    const e = only(line({ ...HYPOTHESIS, expected_delta: "0.02" }));
    if (e.type !== "hypothesis") throw new Error(e.type);
    expect(e.expected_delta).toBe(0.02);
    expect(e.meta.issues).toHaveLength(1);
  });

  test("an enum value outside the schema reads as undefined, with an issue", () => {
    const e = only(
      line({
        ts: "t",
        type: "decision",
        hypothesis_id: "H-1",
        action: "hold-for-later",
        reason: "r",
      }),
    );
    if (e.type !== "decision") throw new Error(e.type);
    expect(e.action).toBeUndefined();
    expect(e.meta.issues.some((i) => i.startsWith("action:"))).toBe(true);
  });

  test("the original object stays available in meta.raw", () => {
    const e = only(line({ ...HYPOTHESIS, extra: 5 }));
    expect(e.meta.raw.extra).toBe(5);
  });
});

describe("parseLog: upgrade table (old field names seen in real logs)", () => {
  test("timestamp and at are read as ts", () => {
    const { events } = parseLog(
      [
        line({ timestamp: "t1", type: "learning", insight: "i", source: "s" }),
        line({ at: "t2", type: "learning", insight: "i", source: "s" }),
      ].join("\n"),
    );
    expect(events.map((e) => e.ts)).toEqual(["t1", "t2"]);
    expect(events.every((e) => e.meta.issues.length === 0)).toBe(true);
  });

  test("a v0.4.5 hypothesis (hypothesis/expected) reads its text as claim", () => {
    const e = only(
      line({
        ts: "t",
        type: "hypothesis",
        id: "H-2",
        hypothesis: "old text",
        expected: "+0.01",
        rationale: "why",
      }),
    );
    if (e.type !== "hypothesis") throw new Error(e.type);
    expect(e.claim).toBe("old text");
    expect(e.rationale).toBe("why");
  });

  test("statement is read as claim and rule as kill_criterion", () => {
    const e = only(
      line({
        ts: "t",
        type: "hypothesis",
        id: "H-3",
        statement: "stated",
        rule: "kill if worse",
      }),
    );
    if (e.type !== "hypothesis") throw new Error(e.type);
    expect(e.claim).toBe("stated");
    expect(e.kill_criterion).toBe("kill if worse");
  });

  test("an experiment's id and result are read as hypothesis_id and observations", () => {
    const e = only(
      line({
        ts: "t",
        type: "experiment",
        id: "H-4",
        result: "went up",
        metrics: { auc: 0.9 },
      }),
    );
    if (e.type !== "experiment") throw new Error(e.type);
    expect(e.hypothesis_id).toBe("H-4");
    expect(e.observations).toBe("went up");
    expect(e.meta.issues).toEqual([]);
  });

  test("a decision's choice and what are read as action and reason", () => {
    const e = only(
      line({
        ts: "t",
        type: "decision",
        hypothesis_id: "H-5",
        choice: "keep",
        what: "it worked",
      }),
    );
    if (e.type !== "decision") throw new Error(e.type);
    expect(e.action).toBe("keep");
    expect(e.reason).toBe("it worked");
  });

  test("free-form decision actions seen in real logs map onto the schema's actions", () => {
    const action = (a: string) => {
      const e = only(
        line({
          ts: "t",
          type: "decision",
          hypothesis_id: "H",
          action: a,
          reason: "r",
        }),
      );
      return e.type === "decision" ? e.action : null;
    };
    expect(action("abandon")).toBe("reject");
    expect(action("close (negative)")).toBe("reject");
    expect(action("kill")).toBe("reject");
    expect(action("adopt")).toBe("keep");
    expect(action("promote")).toBe("keep");
    expect(action("continue")).toBe("iterate");
  });

  test("a current field name wins over its old alias", () => {
    const e = only(line({ ...HYPOTHESIS, statement: "older" }));
    if (e.type !== "hypothesis") throw new Error(e.type);
    expect(e.claim).toBe("bigger batch helps");
  });
});

describe("parseLog: unknown types and rejected lines", () => {
  test("an unknown event type passes through as 'unknown'", () => {
    const e = only(line({ ts: "t", type: "monitor", kernel: "k" }));
    if (e.type !== "unknown") throw new Error(e.type);
    expect(e.originalType).toBe("monitor");
    expect(e.meta.raw.kernel).toBe("k");
  });

  test("invalid JSON, non-objects and type-less objects are rejected with their line", () => {
    const { events, rejected } = parseLog(
      ['{"type": "phase", bad', "[1,2]", line({ event: "x" })].join("\n"),
    );
    expect(events).toEqual([]);
    expect(rejected.map((r) => r.line)).toEqual([1, 2, 3]);
    expect(
      rejected.every((r) => r.reason.length > 0 && r.text.length > 0),
    ).toBe(true);
  });
});

describe("parseLogLine", () => {
  test("returns null for a blank line", () => {
    expect(parseLogLine("   ", 7)).toBeNull();
  });

  test("returns one event or one rejected line, tagged with the given line number", () => {
    const ok = parseLogLine(line(HYPOTHESIS), 12);
    expect(ok?.kind).toBe("event");
    if (ok?.kind === "event") expect(ok.event.meta.line).toBe(12);
    const bad = parseLogLine("not json", 13);
    expect(bad?.kind).toBe("rejected");
    if (bad?.kind === "rejected") expect(bad.rejected.line).toBe(13);
  });
});
