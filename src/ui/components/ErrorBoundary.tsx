import { Component, type ErrorInfo, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";

import { useTheme } from "~/ui/theme";
import { reportError } from "~/telemetry/index";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Tears the renderer down and exits — the same quit the app uses. */
  onQuit: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a crash in the render tree and turns it into a screen the user can
 * read and leave.
 *
 * Without this, a throw anywhere in a component unmounts the whole tree and
 * leaves the terminal showing whatever the last frame was, with no way out but
 * closing it. The report matters as much as the screen: a render crash is the
 * one class of bug the API layer can never see.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      source: "ui.render.crashed",
      handled: false,
      // The React tree that led here, which no JS stack trace records.
      extra: { componentStack: info.componentStack },
    });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} onQuit={this.props.onQuit} />;
  }
}

/**
 * The fallback. A function component so it can own the keyboard — the crashed
 * tree took every other key handler with it, and `exitOnCtrlC` is off, so
 * without this there is nothing left listening for a way out.
 */
function CrashScreen({ error, onQuit }: { error: Error; onQuit: () => void }) {
  const theme = useTheme();
  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) onQuit();
  });

  return (
    <box style={{ flexGrow: 1, padding: 2, flexDirection: "column" }}>
      <text fg={theme.danger}>sentry-tui hit an error and can't keep drawing this screen.</text>
      <text> </text>
      <text fg={theme.text}>{error.message}</text>
      <text> </text>
      <text fg={theme.muted}>Press q to quit.</text>
    </box>
  );
}
