/**
 * Hook for incrementally streaming log.jsonl events
 * Uses byte offset tracking to only read new data on each poll
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { type LogEvent, parseLogLine } from "../../domain/log/log-events.ts";

/** Maximum number of events kept in memory */
const MAX_EVENTS = 10_000;

export interface UseLogStreamOptions {
  projectPath: string;
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number;
}

export interface UseLogStreamResult {
  /** Events read so far, in file order (the last MAX_EVENTS) */
  events: LogEvent[];
}

export function useLogStream(options: UseLogStreamOptions): UseLogStreamResult {
  const { projectPath, pollInterval = 1000 } = options;

  const [events, setEvents] = useState<LogEvent[]>([]);
  const lastByteOffset = useRef(0);
  const lineCount = useRef(0);
  const partialLine = useRef("");
  const polling = useRef(false);
  const prevPath = useRef(projectPath);

  // Reset state when project path changes
  if (prevPath.current !== projectPath) {
    prevPath.current = projectPath;
    lastByteOffset.current = 0;
    lineCount.current = 0;
    partialLine.current = "";
    setEvents([]);
  }

  const poll = useCallback(async () => {
    // Guard against concurrent polls
    if (polling.current) return;
    polling.current = true;

    const logPath = `${projectPath}/.ml-ralph/log.jsonl`;

    try {
      const file = Bun.file(logPath);
      if (!(await file.exists())) return;

      const size = file.size;
      if (size <= lastByteOffset.current) return;

      // Read only new bytes
      const slice = file.slice(lastByteOffset.current, size);
      const newData = await slice.text();
      lastByteOffset.current = size;

      // Prepend any partial line from last read
      const combined = partialLine.current + newData;

      // Split into lines - last element may be partial if no trailing newline
      const lines = combined.split("\n");

      // If the data doesn't end with newline, buffer the last partial line
      if (!combined.endsWith("\n")) {
        partialLine.current = lines.pop() || "";
      } else {
        partialLine.current = "";
      }

      const newEvents: LogEvent[] = [];
      for (const line of lines) {
        lineCount.current += 1;
        const parsed = parseLogLine(line, lineCount.current);
        if (parsed?.kind === "event") newEvents.push(parsed.event);
      }

      if (newEvents.length > 0) {
        setEvents((prev) => {
          const combined = [...prev, ...newEvents];
          if (combined.length > MAX_EVENTS) {
            return combined.slice(-MAX_EVENTS);
          }
          return combined;
        });
      }
    } catch (err: unknown) {
      // Only ignore ENOENT (file not found) — log unexpected errors
      const code = (err as { code?: string })?.code;
      if (code !== "ENOENT") {
        console.error("[use-log-stream] poll error:", err);
      }
    } finally {
      polling.current = false;
    }
  }, [projectPath]);

  // Initial catch-up read
  useEffect(() => {
    poll();
  }, [poll]);

  // Poll for new data
  useEffect(() => {
    const interval = setInterval(poll, pollInterval);
    return () => clearInterval(interval);
  }, [poll, pollInterval]);

  return { events };
}
