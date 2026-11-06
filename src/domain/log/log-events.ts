/**
 * Log events - the one place that reads .ml-ralph/log.jsonl lines.
 *
 * Writes are checked strictly against LOG_EVENT_SCHEMAS (see
 * domain/validation/log-event.ts). Reads are lenient, because a log holds
 * history: lines written by older ml-ralph versions, by hand, or by other
 * agents. Terms:
 *
 * - **Log event**: a line that parsed to a JSON object with a string `type`.
 *   It comes back typed by its schema. Missing or invalid fields are filled
 *   with defaults ('' for strings, [] for lists, {} for objects, undefined for
 *   numbers and enum values) and every such repair is recorded as an issue.
 *   A type without a schema comes back as `{ type: "unknown", originalType }`.
 * - **Issue**: one human-readable note on a log event, `"<field>: <problem>"`.
 * - **Rejected line**: a non-blank line that is not JSON, not an object, or
 *   has no type. It is returned with its line number, never dropped silently.
 * - **Upgrade table**: old field names seen in real logs, read as the current
 *   ones before the schema check (e.g. `statement` -> `claim`). A current
 *   field always wins over its alias.
 *
 * Events keep file order; timestamps are normalised to `ts` but never used
 * for sorting. The original object is kept in `meta.raw`.
 */

import {
  type FieldSpec,
  LOG_EVENT_SCHEMAS,
  type LogEventSchema,
  type LogEventType,
} from "../validation/log-event.ts";

/** Where an event came from and what the reader had to repair */
export interface LogMeta {
  /** 1-based line number in log.jsonl */
  line: number;
  issues: string[];
  /** The object as written, before upgrades and repairs */
  raw: Record<string, unknown>;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type SpecOf<F> = F extends { spec: infer S } ? S : never;
type OptionalKeys<F> = {
  [K in keyof F]: F[K] extends { optional: true } ? K : never;
}[keyof F];
type RequiredKeys<F> = Exclude<keyof F, OptionalKeys<F>>;

/** What the reader returns for a field spec: numbers and enums may be undefined */
type ReadSpec<S> = S extends { kind: "string" }
  ? string
  : S extends { kind: "number" }
    ? number | undefined
    : S extends { kind: "enum"; values: infer V extends readonly string[] }
      ? V[number] | undefined
      : S extends { kind: "array"; items: infer I }
        ? ReadSpec<I>[]
        : S extends { kind: "object"; fields: infer F }
          ? keyof F extends never
            ? Record<string, unknown>
            : ReadFields<F>
          : S extends { kind: "numberMap" }
            ? Record<string, number>
            : S extends { kind: "oneOf"; options: readonly (infer O)[] }
              ? ReadSpec<O>
              : never;

type ReadFields<F> = Simplify<
  { [K in RequiredKeys<F>]: ReadSpec<SpecOf<F[K]>> } & {
    [K in OptionalKeys<F>]?: ReadSpec<SpecOf<F[K]>>;
  }
>;

/** A log event of one schema type, as the reader returns it */
export type TypedLogEvent<T extends LogEventType> = Simplify<
  { type: T; ts?: string; meta: LogMeta } & ReadFields<
    (typeof LOG_EVENT_SCHEMAS)[T]["fields"]
  >
>;

/** A log event whose type has no schema (e.g. agent-invented types) */
export interface UnknownLogEvent {
  type: "unknown";
  originalType: string;
  ts?: string;
  meta: LogMeta;
}

export type LogEvent =
  | { [T in LogEventType]: TypedLogEvent<T> }[LogEventType]
  | UnknownLogEvent;

export interface RejectedLine {
  line: number;
  /** The line as written, cut to 500 characters */
  text: string;
  reason: string;
}

export type ParsedLine =
  | { kind: "event"; event: LogEvent }
  | { kind: "rejected"; rejected: RejectedLine };

export interface ParsedLog {
  events: LogEvent[];
  rejected: RejectedLine[];
}

const SCHEMAS: Readonly<Record<string, LogEventSchema>> = LOG_EVENT_SCHEMAS;

/** Old names for `ts`, in order of preference */
const TS_ALIASES = ["timestamp", "at"] as const;

/** Old field names per event type: current name -> aliases, in order */
const FIELD_ALIASES: Record<string, Record<string, readonly string[]>> = {
  hypothesis: {
    claim: ["statement", "hypothesis"],
    kill_criterion: ["rule"],
  },
  experiment: { hypothesis_id: ["id"], observations: ["result"] },
  decision: { action: ["choice"], reason: ["what"] },
};

/** Free-form decision actions seen in real logs, by their leading word */
const DECISION_ACTION_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/^(abandon|kill|close|reject|drop)\b/, "reject"],
  [/^(adopt|accept|promote|keep)\b/, "keep"],
  [/^(continue|extend|iterate)\b/, "iterate"],
  [/^pivot\b/, "pivot"],
];

const MAX_TEXT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(spec: FieldSpec): string {
  switch (spec.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "enum":
      return `one of ${spec.values.join(", ")}`;
    case "array":
      return `list of ${describe(spec.items)}`;
    case "object":
      return "object";
    case "numberMap":
      return "object of numbers";
    case "oneOf":
      return spec.options.map(describe).join(" or ");
  }
}

/** True when the value passes the spec with nothing to repair */
function fits(spec: FieldSpec, value: unknown): boolean {
  const issues: string[] = [];
  read(spec, value, "", issues);
  return issues.length === 0;
}

/**
 * Read one value against its spec. Always returns a value of the read type;
 * every repair is pushed to `issues` as "<path>: <problem>".
 */
function read(
  spec: FieldSpec,
  value: unknown,
  path: string,
  issues: string[],
): unknown {
  const note = (problem: string) => issues.push(`${path}: ${problem}`);
  const missing = value === undefined || value === null;
  const expected = () =>
    note(missing ? "missing" : `expected ${describe(spec)}`);

  switch (spec.kind) {
    case "string": {
      if (typeof value === "string") {
        if (!value.trim()) note("empty");
        return value;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        note("expected string");
        return String(value);
      }
      expected();
      return missing ? "" : JSON.stringify(value);
    }
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const n = Number(value);
        if (Number.isFinite(n)) {
          note("expected number, read from text");
          return n;
        }
      }
      expected();
      return undefined;
    }
    case "enum": {
      if (typeof value === "string" && spec.values.includes(value)) {
        return value;
      }
      note(
        missing
          ? "missing"
          : `${JSON.stringify(value)} is not ${describe(spec)}`,
      );
      return undefined;
    }
    case "array": {
      if (Array.isArray(value)) {
        if (spec.nonEmpty && value.length === 0) note("empty");
        return value.map((item, i) =>
          read(spec.items, item, `${path}[${i}]`, issues),
        );
      }
      if (typeof value === "string" && spec.items.kind === "string") {
        note("expected list, read one string as a list");
        return [value];
      }
      expected();
      return [];
    }
    case "object": {
      if (!isRecord(value)) {
        expected();
        return {};
      }
      if (Object.keys(spec.fields).length === 0) return value;
      return readFields(spec.fields, value, path, issues);
    }
    case "numberMap": {
      if (!isRecord(value)) {
        expected();
        return {};
      }
      const out: Record<string, number> = {};
      for (const [key, v] of Object.entries(value)) {
        const n = read({ kind: "number" }, v, `${path}.${key}`, issues);
        if (n !== undefined) out[key] = n as number;
      }
      return out;
    }
    case "oneOf": {
      const match = spec.options.find((option) => fits(option, value));
      const first = spec.options[0];
      if (match) return read(match, value, path, issues);
      if (!first) return value;
      return read(first, value, path, issues);
    }
  }
}

function readFields(
  fields: LogEventSchema["fields"],
  data: Record<string, unknown>,
  prefix: string,
  issues: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const value = data[name];
    if (value === undefined && field.optional) continue;
    out[name] = read(field.spec, value, path, issues);
  }
  return out;
}

/** Apply the upgrade table: old names fill in missing current fields */
function upgrade(type: string, raw: Record<string, unknown>) {
  const data = { ...raw };
  for (const [current, aliases] of Object.entries(FIELD_ALIASES[type] ?? {})) {
    if (data[current] !== undefined) continue;
    const alias = aliases.find((a) => data[a] !== undefined);
    if (alias) data[current] = data[alias];
  }
  return data;
}

function readTs(raw: Record<string, unknown>): string | undefined {
  for (const key of ["ts", ...TS_ALIASES]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** Map a free-form decision action onto the schema's actions, if it is clear */
function readDecisionAction(
  data: Record<string, unknown>,
  issues: string[],
): void {
  const action = data.action;
  if (typeof action !== "string") return;
  const values = LOG_EVENT_SCHEMAS.decision.fields.action.spec
    .values as readonly string[];
  if (values.includes(action)) return;
  const word = action.trim().toLowerCase();
  const hit = DECISION_ACTION_WORDS.find(([pattern]) => pattern.test(word));
  if (!hit) return;
  issues.push(
    `action: read ${JSON.stringify(action)} as ${JSON.stringify(hit[1])}`,
  );
  data.action = hit[1];
}

function reject(text: string, line: number, reason: string): ParsedLine {
  return {
    kind: "rejected",
    rejected: { line, text: text.slice(0, MAX_TEXT), reason },
  };
}

/**
 * Read one line of log.jsonl. Returns null for a blank line, otherwise one
 * log event or one rejected line, tagged with `lineNo` (1-based).
 */
export function parseLogLine(text: string, lineNo: number): ParsedLine | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return reject(
      trimmed,
      lineNo,
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(parsed)) return reject(trimmed, lineNo, "not a JSON object");
  const type = parsed.type;
  if (typeof type !== "string" || !type.trim()) {
    return reject(trimmed, lineNo, "no string `type` field");
  }

  const ts = readTs(parsed);
  const issues: string[] = [];
  const meta: LogMeta = { line: lineNo, issues, raw: parsed };
  const schema = Object.hasOwn(SCHEMAS, type) ? SCHEMAS[type] : undefined;
  if (!schema) {
    const event: UnknownLogEvent = {
      type: "unknown",
      originalType: type,
      meta,
    };
    if (ts !== undefined) event.ts = ts;
    return { kind: "event", event };
  }

  const data = upgrade(type, parsed);
  if (type === "decision") readDecisionAction(data, issues);
  const fields = readFields(schema.fields, data, "", issues);
  const event = {
    type,
    ...(ts !== undefined ? { ts } : {}),
    ...fields,
    meta,
  } as LogEvent;
  return { kind: "event", event };
}

/** Read a whole log.jsonl text: events in file order plus rejected lines */
export function parseLog(text: string): ParsedLog {
  const events: LogEvent[] = [];
  const rejected: RejectedLine[] = [];
  text.split("\n").forEach((line, i) => {
    const parsed = parseLogLine(line, i + 1);
    if (!parsed) return;
    if (parsed.kind === "event") events.push(parsed.event);
    else rejected.push(parsed.rejected);
  });
  return { events, rejected };
}
