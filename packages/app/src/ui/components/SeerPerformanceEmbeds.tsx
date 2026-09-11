import { useMemo } from "react";

import { fetchProfileSummary } from "~/api/profileDetails";
import { fetchTraceSpans } from "~/api/traceDetails";
import { valueOf } from "~/core/async";
import { embedText } from "~/core/seerEmbeds";
import { fitText } from "~/lib/text";
import { dateTimeText } from "~/lib/time";
import {
  CARD_CHROME,
  type SeerEmbedProps,
  SeerEmbedCard,
  SeerEmbedFields,
  SeerEmbedStatus,
} from "~/ui/components/SeerEmbedCard";
import { useDirectResource } from "~/ui/hooks/useDirectResource";
import { useTheme } from "~/ui/theme";

const PREVIEW_ROWS = 5;

/** Keep the requested resource's previous data out of a replacement reference card. */
export function TraceEmbed(props: SeerEmbedProps) {
  return (
    <TraceCard
      key={JSON.stringify([props.org, props.data["traceId"], props.data["timestamp"]])}
      {...props}
    />
  );
}

/** A bounded ranking by inclusive span duration, with the referenced span retained. */
function TraceCard({ data, width, client, org }: SeerEmbedProps) {
  const theme = useTheme();
  const traceId = embedText(data["traceId"]) ?? "";
  const spanId = embedText(data["spanId"]);
  const timestamp = embedText(data["timestamp"]);
  const load = useMemo(
    () =>
      (api: NonNullable<SeerEmbedProps["client"]>, { signal }: { signal: AbortSignal }) =>
        fetchTraceSpans(api, { org, traceId, timestamp, signal }),
    [org, traceId, timestamp],
  );
  const status = useDirectResource(traceId ? client : null, { org, id: traceId, load });
  const spans = valueOf(status);
  const longest = spans?.slice(0, PREVIEW_ROWS) ?? [];
  const selected = spans?.find((span) => span.id === spanId);
  const shown =
    selected && !longest.includes(selected) ? [...longest.slice(0, -1), selected] : longest;
  const inner = Math.max(1, width - CARD_CHROME);
  return (
    <SeerEmbedCard label="Trace" title={traceId} width={width}>
      <SeerEmbedFields
        fields={[
          ["Span", spanId],
          ["Timestamp", dateTimeText(timestamp)],
        ]}
        width={inner}
      />
      {!traceId ? (
        <text fg={theme.muted}>Trace ID unavailable.</text>
      ) : !client ? (
        <text fg={theme.muted}>Connect to load trace spans.</text>
      ) : (
        <SeerEmbedStatus status={status} noun="trace spans" empty={spans?.length === 0} />
      )}
      {shown.length ? (
        <text fg={theme.muted}>
          {fitText(
            `Longest spans · inclusive duration · ${shown.length}/${spans!.length} returned`,
            inner,
          )}
        </text>
      ) : null}
      {shown.map((span) => (
        <text key={span.id} fg={span.id === spanId ? theme.accent : theme.text}>
          {fitText(
            `${span.id === spanId ? "›" : " "} ${span.durationMs.toFixed(2)}ms  ${[span.op, span.name, span.project].filter(Boolean).join(" · ")}`,
            inner,
          )}
        </text>
      ))}
    </SeerEmbedCard>
  );
}

/** Reset fetch state when either part of the project-scoped profile address changes. */
export function ProfileEmbed(props: SeerEmbedProps) {
  return (
    <ProfileCard
      key={JSON.stringify([props.org, props.data["projectSlug"], props.data["profileId"]])}
      {...props}
    />
  );
}

/** The heaviest leaf frames across threads, using the profile's own time weights. */
function ProfileCard({ data, width, client, org }: SeerEmbedProps) {
  const theme = useTheme();
  const profileId = embedText(data["profileId"]) ?? "";
  const projectSlug = embedText(data["projectSlug"]) ?? "";
  const load = useMemo(
    () =>
      (api: NonNullable<SeerEmbedProps["client"]>, { signal }: { signal: AbortSignal }) =>
        fetchProfileSummary(api, { org, projectSlug, profileId, signal }),
    [org, projectSlug, profileId],
  );
  const valid = Boolean(profileId && projectSlug);
  const status = useDirectResource(valid ? client : null, { org, id: profileId, load });
  const profile = valueOf(status);
  const inner = Math.max(1, width - CARD_CHROME);
  return (
    <SeerEmbedCard label="Profile" title={profileId} width={width}>
      <SeerEmbedFields
        fields={[
          ["Project", projectSlug],
          ["Transaction", profile?.transaction],
        ]}
        width={inner}
      />
      {!valid ? (
        <text fg={theme.muted}>Profile ID and project required.</text>
      ) : !client ? (
        <text fg={theme.muted}>Connect to load profile frames.</text>
      ) : (
        <SeerEmbedStatus
          status={status}
          noun="profile frames"
          empty={profile?.frames.length === 0}
        />
      )}
      {profile?.frames.length ? (
        <text fg={theme.muted}>
          {fitText(
            `Heaviest frames · self ${profile.unit === "ms" ? "time" : "samples"} · all threads`,
            inner,
          )}
        </text>
      ) : null}
      {profile?.frames.slice(0, PREVIEW_ROWS).map((frame) => (
        <text key={frame.id} fg={theme.text}>
          {fitText(
            ` ${frame.weight.toFixed(profile.unit === "ms" ? 2 : 0)}${profile.unit === "ms" ? "ms" : " samples"}  ${frame.name}${frame.location ? ` · ${frame.location}` : ""}`,
            inner,
          )}
        </text>
      ))}
      {profile && profile.frames.length > PREVIEW_ROWS ? (
        <text fg={theme.muted}>
          {fitText(` …and ${profile.frames.length - PREVIEW_ROWS} more frames`, inner)}
        </text>
      ) : null}
    </SeerEmbedCard>
  );
}
