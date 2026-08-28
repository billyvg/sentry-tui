import { Component, useCallback, useRef, useState, type ErrorInfo, type ReactNode } from "react";

import { PayloadApp as FallbackApp, type PayloadAppProps } from "@sentry-tui/app/payloadEntry";
import { APP_VERSION } from "@sentry-tui/app/version";
import { HOST_API_VERSION } from "@sentry-tui/runtime-contract/runtime";
import type { ReadyUpdate } from "@sentry-tui/runtime-contract/update";
import { reportError } from "@sentry-tui/runtime-host/telemetry/index";
import { discardFailedPayload } from "@sentry-tui/runtime-host/update/selfUpdate";
import { reportUpdateFailure } from "@sentry-tui/runtime-host/update/telemetry";
import { loadAppPayload, type LoadedAppPayload } from "@sentry-tui/runtime-host/ui/loadPayload";
import { cloneSessionSnapshot } from "@sentry-tui/runtime-host/ui/sessionSnapshot";

interface RuntimeHostProps extends Omit<
  PayloadAppProps,
  "onApplyUpdate" | "initialSessionSnapshot" | "onSessionSnapshot"
> {
  initialPayload?: LoadedAppPayload;
  onRestart: (binaryPath: string) => void;
}

interface PreviousPayload {
  payload: LoadedAppPayload;
  sessionSnapshot: unknown | undefined;
}

/**
 * Keep the native renderer and React root alive while replacing the app tree.
 *
 * Payload state crosses this boundary only as opaque, bounded JSON. Schema
 * ownership and migrations stay with the replaceable app, so a host can carry
 * session state between payload versions without understanding either one.
 */
export function RuntimeHost({ initialPayload, onRestart, ...props }: RuntimeHostProps) {
  const fallback = useRef<LoadedAppPayload>({
    App: FallbackApp,
    metadata: { version: APP_VERSION, hostApiVersion: HOST_API_VERSION },
    entryPath: "",
  });
  const sessionSnapshot = useRef<unknown>(undefined);
  const previous = useRef<PreviousPayload | undefined>(
    initialPayload ? { payload: fallback.current, sessionSnapshot: undefined } : undefined,
  );
  const [active, setActive] = useState<LoadedAppPayload>(() => initialPayload ?? fallback.current);

  const applyUpdate = useCallback(
    async (update: ReadyUpdate): Promise<boolean> => {
      if (update.kind === "host") {
        onRestart(update.path);
        return true;
      }

      try {
        const loaded = await loadAppPayload(update.path);
        const preservedSnapshot = sessionSnapshot.current;
        setActive((current) => {
          previous.current = { payload: current, sessionSnapshot: preservedSnapshot };
          return loaded;
        });
        return true;
      } catch (error) {
        reportUpdateFailure(error, {
          kind: update.kind,
          version: update.version,
          stage: "apply",
        });
        discardFailedPayload(update.path);
        return false;
      }
    },
    [onRestart],
  );

  const rollback = useCallback(() => {
    const restored = previous.current;
    if (!restored) return;
    if (active.entryPath) discardFailedPayload(active.entryPath);
    sessionSnapshot.current = restored.sessionSnapshot;
    previous.current = undefined;
    setActive(restored.payload);
  }, [active]);

  const captureSessionSnapshot = useCallback((value: unknown) => {
    const snapshot = cloneSessionSnapshot(value);
    if (snapshot !== undefined) sessionSnapshot.current = snapshot;
  }, []);

  const ActiveApp = active.App;
  const initialSessionSnapshot = cloneSessionSnapshot(sessionSnapshot.current);
  return (
    <PayloadBoundary key={active.metadata.version} onFailure={rollback}>
      <ActiveApp
        {...props}
        onApplyUpdate={applyUpdate}
        initialSessionSnapshot={initialSessionSnapshot}
        onSessionSnapshot={captureSessionSnapshot}
      />
    </PayloadBoundary>
  );
}

interface PayloadBoundaryProps {
  children: ReactNode;
  onFailure: () => void;
}

/** Roll a bad payload back before the outer, session-ending boundary sees it. */
class PayloadBoundary extends Component<PayloadBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      source: "ui.render.crashed",
      handled: true,
      extra: { componentStack: info.componentStack, runtime_payload: true },
    });
    this.props.onFailure();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
