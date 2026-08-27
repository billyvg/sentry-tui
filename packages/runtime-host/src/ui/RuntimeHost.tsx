import { Component, useCallback, useRef, useState, type ErrorInfo, type ReactNode } from "react";

import { PayloadApp as FallbackApp, type PayloadAppProps } from "@sentry-tui/app/payloadEntry";
import { APP_VERSION } from "@sentry-tui/app/version";
import { HOST_API_VERSION } from "@sentry-tui/runtime-contract/runtime";
import type { ReadyUpdate } from "@sentry-tui/runtime-contract/update";
import { reportError } from "@sentry-tui/runtime-host/telemetry/index";
import { discardFailedPayload } from "@sentry-tui/runtime-host/update/selfUpdate";
import { loadAppPayload, type LoadedAppPayload } from "@sentry-tui/runtime-host/ui/loadPayload";

interface RuntimeHostProps extends Omit<PayloadAppProps, "onApplyUpdate"> {
  initialPayload?: LoadedAppPayload;
  onRestart: (binaryPath: string) => void;
}

/**
 * Keep the native renderer and React root alive while replacing the app tree.
 *
 * Payload state is intentionally not serialized here. Preserving navigation
 * across the component remount is a separate contract; this host's job is to
 * make that future work possible without first tearing down the terminal.
 */
export function RuntimeHost({ initialPayload, onRestart, ...props }: RuntimeHostProps) {
  const fallback = useRef<LoadedAppPayload>({
    App: FallbackApp,
    metadata: { version: APP_VERSION, hostApiVersion: HOST_API_VERSION },
    entryPath: "",
  });
  const previous = useRef<LoadedAppPayload | undefined>(
    initialPayload ? fallback.current : undefined,
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
        setActive((current) => {
          previous.current = current;
          return loaded;
        });
        return true;
      } catch {
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
    previous.current = undefined;
    setActive(restored);
  }, [active]);

  const ActiveApp = active.App;
  return (
    <PayloadBoundary key={active.metadata.version} onFailure={rollback}>
      <ActiveApp {...props} onApplyUpdate={applyUpdate} />
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
