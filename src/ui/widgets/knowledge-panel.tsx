/**
 * Knowledge panel - shared tabs for PRD, Hypotheses, Learnings, Research, Kanban, Experiments
 * Used by both Planning and Monitor screens
 */

import { useAppStore } from "../../application/state/index.ts";
import { useRalphState } from "../hooks/index.ts";
import { Box, Text } from "../ink.tsx";
import { colors } from "../theme/colors.ts";
import { ExperimentsPanel } from "./experiments-panel.tsx";
import { HypothesesPanel } from "./hypotheses-panel.tsx";
import { KanbanPanel } from "./kanban-panel.tsx";
import { LearningsPanel } from "./learnings-panel.tsx";
import { PanelBoundary } from "./panel-boundary.tsx";
import { PrdPanel } from "./prd-panel.tsx";
import { ResearchPanel } from "./research-panel.tsx";
import { PlanningTabs } from "./tabs.tsx";

const ITEMS_PER_PAGE = 5;

/** One-line note on log lines the reader skipped or repaired, or null */
export function formatLogHealth(
  rejectedLines: number,
  eventsWithIssues: number,
): string | null {
  const parts: string[] = [];
  if (rejectedLines > 0) {
    parts.push(
      `${rejectedLines} log line${rejectedLines === 1 ? "" : "s"} skipped`,
    );
  }
  if (eventsWithIssues > 0) {
    parts.push(
      `${eventsWithIssues} event${eventsWithIssues === 1 ? "" : "s"} with issues`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function KnowledgePanel() {
  const {
    selectedTab,
    projectPath,
    scrollOffset,
    backlogExpanded,
    backlogOffset,
    completedExpanded,
    completedOffset,
    abandonedExpanded,
    abandonedOffset,
    selectedExperimentId,
    expandedExperimentId,
  } = useAppStore();

  // Read Ralph state from .ml-ralph files
  const { prd, log, kanban, evals, scoring, isLoaded } = useRalphState({
    projectPath: projectPath || process.cwd(),
    pollInterval: 2000,
  });

  const logHealth = log
    ? formatLogHealth(log.rejectedLines, log.eventsWithIssues)
    : null;

  // Map old tab names to new ones for backward compatibility
  const activeTab =
    selectedTab === "stories"
      ? "hypotheses"
      : (selectedTab as
          | "prd"
          | "hypotheses"
          | "learnings"
          | "research"
          | "kanban"
          | "experiments");

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* PRD Status */}
      {prd && (
        <Box paddingX={1} marginBottom={0}>
          <Text color={colors.textMuted}>
            <Text color={colors.accentBlue}>{prd.project}</Text>
            {" · "}
            <Text
              color={
                prd.status === "approved"
                  ? colors.accentGreen
                  : colors.accentYellow
              }
            >
              {prd.status}
            </Text>
            {log?.currentPhase && (
              <>
                {" · "}
                <Text color={colors.accentPurple}>{log.currentPhase}</Text>
              </>
            )}
            {logHealth && (
              <>
                {" · "}
                <Text color={colors.accentYellow}>{logHealth}</Text>
              </>
            )}
          </Text>
        </Box>
      )}

      {/* Knowledge panel */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={colors.border}
        flexGrow={1}
      >
        {/* Tabs header */}
        <Box paddingX={1}>
          <PlanningTabs activeTab={activeTab} />
        </Box>

        {/* Tab content */}
        <Box
          flexDirection="column"
          paddingX={1}
          flexGrow={1}
          overflowY="hidden"
        >
          {!isLoaded ? (
            <Box padding={1}>
              <Text color={colors.textMuted}>Loading...</Text>
            </Box>
          ) : (
            <PanelBoundary name={activeTab} resetKey={activeTab}>
              {activeTab === "prd" && <PrdPanel prd={prd} />}
              {activeTab === "hypotheses" && (
                <HypothesesPanel
                  hypotheses={log?.hypotheses ?? []}
                  evals={evals}
                  scoring={scoring}
                  offset={scrollOffset}
                  limit={ITEMS_PER_PAGE}
                />
              )}
              {activeTab === "learnings" && (
                <LearningsPanel
                  learnings={log?.learnings ?? []}
                  offset={scrollOffset}
                  limit={ITEMS_PER_PAGE}
                />
              )}
              {activeTab === "research" && (
                <ResearchPanel
                  research={log?.research ?? []}
                  offset={scrollOffset}
                  limit={ITEMS_PER_PAGE}
                />
              )}
              {activeTab === "kanban" && (
                <KanbanPanel
                  kanban={kanban}
                  offset={scrollOffset}
                  limit={ITEMS_PER_PAGE}
                  backlogExpanded={backlogExpanded}
                  backlogOffset={backlogOffset}
                  completedExpanded={completedExpanded}
                  completedOffset={completedOffset}
                  abandonedExpanded={abandonedExpanded}
                  abandonedOffset={abandonedOffset}
                />
              )}
              {activeTab === "experiments" && (
                <ExperimentsPanel
                  hypotheses={log?.hypotheses ?? []}
                  experiments={log?.experiments ?? []}
                  evals={evals}
                  scoring={scoring}
                  successCriteria={prd?.success_criteria ?? []}
                  selectedId={selectedExperimentId}
                  expandedId={expandedExperimentId}
                  offset={scrollOffset}
                  limit={ITEMS_PER_PAGE}
                />
              )}
            </PanelBoundary>
          )}
        </Box>
      </Box>
    </Box>
  );
}
