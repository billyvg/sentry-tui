import { HOST_API_VERSION, type AppPayloadMetadata } from "@sentry-tui/runtime-contract/runtime";
import { APP_VERSION } from "~/version";
import { App, type AppProps } from "~/ui/App";
import { ThemeProvider, type ThemeProviderProps } from "~/ui/theme";

/** Metadata the host checks again after the module has loaded. */
export const payload: AppPayloadMetadata = {
  version: APP_VERSION,
  hostApiVersion: HOST_API_VERSION,
};

export interface PayloadAppProps extends AppProps {
  theme: Omit<ThemeProviderProps, "children">;
}

/**
 * The replaceable application tree.
 *
 * Its theme provider deliberately lives in the payload: the app and its
 * context must come from the same module graph. The host keeps a provider of
 * its own around the crash boundary above this component.
 */
export function PayloadApp({ theme, ...props }: PayloadAppProps) {
  return (
    <ThemeProvider {...theme}>
      <App {...props} />
    </ThemeProvider>
  );
}
