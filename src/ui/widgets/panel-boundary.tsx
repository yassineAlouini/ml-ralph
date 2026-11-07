/**
 * Panel boundary - contains a render error to the panel that threw it, so one
 * bad record shows a one-line failure instead of taking down the whole TUI.
 */

import { Component, type ReactNode } from "react";
import { Box, Text } from "../ink.tsx";
import { colors } from "../theme/colors.ts";

export function panelFailureText(name: string, error: string): string {
  return `${name} panel failed: ${error}`;
}

interface PanelBoundaryProps {
  /** Panel name shown in the failure line */
  name: string;
  /** Changing this clears a failure (e.g. the selected tab) */
  resetKey?: string;
  children: ReactNode;
}

interface PanelBoundaryState {
  error: string | null;
  resetKey?: string;
}

export class PanelBoundary extends Component<
  PanelBoundaryProps,
  PanelBoundaryState
> {
  override state: PanelBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  static getDerivedStateFromProps(
    props: PanelBoundaryProps,
    state: PanelBoundaryState,
  ): Partial<PanelBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <Box paddingX={1}>
        <Text color={colors.accentRed}>
          {panelFailureText(this.props.name, this.state.error)}
        </Text>
      </Box>
    );
  }
}
