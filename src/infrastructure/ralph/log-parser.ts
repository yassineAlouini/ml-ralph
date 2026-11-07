/**
 * Log parser for .ml-ralph/log.jsonl
 * Reads and aggregates events into useful views
 */

import {
  type LogEvent,
  type ParsedLog,
  parseLog,
  type RejectedLine,
  type TypedLogEvent,
} from "../../domain/log/log-events.ts";
import type { PRD } from "./templates.ts";

export interface HypothesisWithStatus {
  id: string;
  hypothesis: string;
  expected?: string;
  rubrics?: string[];
  killCriterion?: string;
  status: "pending" | "keep" | "reject" | "iterate" | "pivot";
  experiments: TypedLogEvent<"experiment">[];
  decision?: TypedLogEvent<"decision">;
  createdAt: string;
}

export interface PrdChange {
  ts?: string;
  field: string;
  change: string;
  reason: string;
}

export interface LogSummary {
  hypotheses: HypothesisWithStatus[];
  experiments: TypedLogEvent<"experiment">[];
  learnings: TypedLogEvent<"learning">[];
  research: TypedLogEvent<"research">[];
  prdChanges: PrdChange[];
  currentPhase: string | null;
  phases: TypedLogEvent<"phase">[];
  latestStatus: "running" | "paused" | "complete" | null;
  /** Lines the reader could not use at all (not JSON, no type) */
  rejectedLines: number;
  /** Events the reader had to repair (see LogMeta.issues) */
  eventsWithIssues: number;
}

/**
 * Read log.jsonl: events in file order plus the lines that could not be read.
 * A missing or unreadable file reads as an empty log.
 */
export async function readLog(projectPath: string): Promise<ParsedLog> {
  try {
    const file = Bun.file(`${projectPath}/.ml-ralph/log.jsonl`);
    if (!(await file.exists())) return { events: [], rejected: [] };
    return parseLog(await file.text());
  } catch {
    return { events: [], rejected: [] };
  }
}

/** Read log.jsonl events in file order (see readLog for the rejected lines) */
export async function readLogFile(projectPath: string): Promise<LogEvent[]> {
  return (await readLog(projectPath)).events;
}

/**
 * Read the PRD file
 */
export async function readPrdFile(projectPath: string): Promise<PRD | null> {
  const prdPath = `${projectPath}/.ml-ralph/prd.json`;

  try {
    const file = Bun.file(prdPath);
    if (!(await file.exists())) {
      return null;
    }

    const content = await file.json();
    return content as PRD;
  } catch {
    return null;
  }
}

/**
 * Kanban types for the working plan
 */
export interface KanbanTask {
  id: string;
  title: string;
  why: string;
  expected_outcome?: string;
  phase?: string;
  depends_on?: string;
  notes?: string;
}

export interface CompletedTask extends KanbanTask {
  outcome: string;
  completed_at: string;
}

export interface AbandonedTask extends KanbanTask {
  reason: string;
  abandoned_at: string;
}

export interface Kanban {
  last_updated: string;
  update_reason: string;
  current_focus: KanbanTask | null;
  up_next: KanbanTask[];
  backlog: KanbanTask[];
  completed: CompletedTask[];
  abandoned: AbandonedTask[];
}

/**
 * Read the Kanban file
 */
export async function readKanbanFile(
  projectPath: string,
): Promise<Kanban | null> {
  const kanbanPath = `${projectPath}/.ml-ralph/kanban.json`;

  try {
    const file = Bun.file(kanbanPath);
    if (!(await file.exists())) {
      return null;
    }

    const content = await file.json();
    return content as Kanban;
  } catch {
    return null;
  }
}

/** Text of a v0.4.5 hypothesis `expected` field, which the schema dropped */
function legacyExpected(h: TypedLogEvent<"hypothesis">): string | undefined {
  const expected = h.meta.raw.expected;
  return typeof expected === "string" && expected.trim() ? expected : undefined;
}

/**
 * Aggregate events into a summary for the TUI. Events are taken in file
 * order; hypotheses are listed in the order they first appear.
 */
export function aggregateEvents(
  events: LogEvent[],
  rejected: RejectedLine[] = [],
): LogSummary {
  const hypothesesMap = new Map<string, HypothesisWithStatus>();
  const experiments: TypedLogEvent<"experiment">[] = [];
  const learnings: TypedLogEvent<"learning">[] = [];
  const research: TypedLogEvent<"research">[] = [];
  const prdChanges: PrdChange[] = [];
  const phases: TypedLogEvent<"phase">[] = [];
  let latestStatus: "running" | "paused" | "complete" | null = null;

  for (const event of events) {
    switch (event.type) {
      case "hypothesis": {
        // Re-logging an id resets it; the Map keeps its first-seen position
        hypothesesMap.set(event.id, {
          id: event.id,
          hypothesis: event.claim,
          expected:
            event.expected_delta !== undefined
              ? `Δ ${event.expected_delta > 0 ? "+" : ""}${event.expected_delta}`
              : legacyExpected(event),
          rubrics: event.rubrics.length > 0 ? event.rubrics : undefined,
          killCriterion: event.kill_criterion || undefined,
          status: "pending",
          experiments: [],
          createdAt: event.ts ?? "",
        });
        break;
      }

      case "experiment": {
        experiments.push(event);
        hypothesesMap.get(event.hypothesis_id)?.experiments.push(event);
        break;
      }

      case "decision": {
        const hyp = hypothesesMap.get(event.hypothesis_id);
        if (hyp) {
          if (event.action) hyp.status = event.action;
          hyp.decision = event;
        }
        break;
      }

      case "learning":
        learnings.push(event);
        break;

      case "research":
        research.push(event);
        break;

      case "prd_updated":
        prdChanges.push({
          ts: event.ts,
          field: event.field,
          change: event.change,
          reason: event.reason,
        });
        break;

      case "phase":
        phases.push(event);
        break;

      case "status":
        if (event.status) latestStatus = event.status;
        break;
    }
  }

  const lastPhase = phases[phases.length - 1];

  return {
    hypotheses: Array.from(hypothesesMap.values()),
    experiments,
    learnings,
    research,
    prdChanges,
    currentPhase: lastPhase?.phase ?? null,
    phases,
    latestStatus,
    rejectedLines: rejected.length,
    eventsWithIssues: events.filter((e) => e.meta.issues.length > 0).length,
  };
}
