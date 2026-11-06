/**
 * Reads real log.jsonl files end to end. Skipped unless ML_RALPH_LOG_CORPUS
 * names a glob of logs, e.g.
 *   ML_RALPH_LOG_CORPUS="$HOME/projects/*\/.ml-ralph/log.jsonl" bun test log-corpus
 * Checks that no line is silently lost and that the TUI's readers never throw.
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { aggregateEvents } from "../../infrastructure/ralph/log-parser.ts";
import { __testing as cognitiveMap } from "../../ui/widgets/cognitive-map.tsx";
import { formatLogActivity } from "../../ui/widgets/log-event-formatter.ts";
import { parseLog } from "./log-events.ts";

const pattern = process.env.ML_RALPH_LOG_CORPUS?.replace(/^~/, homedir());

function corpusFiles(glob: string): string[] {
  const absolute = glob.startsWith("/");
  const files = [
    ...new Bun.Glob(absolute ? glob.slice(1) : glob).scanSync({
      cwd: absolute ? "/" : process.cwd(),
      absolute: true,
      dot: true,
    }),
  ];
  return files.sort();
}

describe.skipIf(!pattern)("log corpus (ML_RALPH_LOG_CORPUS)", () => {
  const files = pattern ? corpusFiles(pattern) : [];

  test("the glob matches at least one log", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`reads ${file} without losing lines or throwing`, async () => {
      const text = await Bun.file(file).text();
      const nonBlank = text.split("\n").filter((l) => l.trim()).length;
      const { events, rejected } = parseLog(text);
      expect(events.length + rejected.length).toBe(nonBlank);
      expect(() => aggregateEvents(events, rejected)).not.toThrow();
      expect(() => cognitiveMap.extractCognitiveState(events)).not.toThrow();
      events.forEach((e, i) => {
        expect(() => formatLogActivity(e, i)).not.toThrow();
      });
    });
  }
});
