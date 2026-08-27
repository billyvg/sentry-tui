# Sentry frontend synchronization

Some sentry-tui behavior deliberately mirrors declarations in
[`getsentry/sentry`](https://github.com/getsentry/sentry/tree/master/static/app).
Sentry Web changes continuously, so a weekly workflow compares the semantic
parts we rely on and maintains one standing GitHub issue when they drift.

## What is monitored

`bun run drift:check` shallow-clones only the relevant frontend directories and
prints a Markdown report for:

- primary and secondary navigation labels;
- issue sort wire values;
- default Explore fields for spans, logs, metrics, and errors;
- detector type wire values;
- dashboard widget display types; and
- the complete prebuilt dashboard catalog, including widget queries and layouts.

The first five surfaces compare against
`scripts/sentry-frontend-baseline.json`. This reviewed semantic snapshot records
intentional product differences without treating formatting or comments in Web
as drift. Prebuilt dashboards compare directly against
`packages/app/src/core/prebuiltDashboards.generated.json`, because that file is runtime data
rather than only a compatibility declaration.

The scheduled workflow is informational: it does not run on pull requests and
does not become a required check. On drift (or if upstream can no longer be
extracted), it creates or updates `ci: Sentry frontend drift detected`. It
closes that issue after the comparison returns to sync.

## Reviewing drift

Use an existing Sentry checkout while investigating:

```bash
bun run drift:check -- --sentry-repo ../sentry
```

For prebuilt dashboard drift, regenerate the runtime catalog:

```bash
bun run dashboards:sync -- --sentry-repo ../sentry
```

Review the generated diff. The extractor intentionally retains only fields the
terminal queries or renders; its small runtime shims model Web helpers used to
construct those values. If Web adds a new helper dependency, update the shim
from its upstream implementation rather than substituting an approximate query.

For navigation, sort, field, or type drift, update the corresponding sentry-tui
implementation when the new behavior is supported. An intentional difference
may remain in the TUI, but it still receives an explicit review before the
baseline moves.

After the implementation and tests agree with the reviewed upstream state,
refresh the semantic baseline:

```bash
bun run drift:check -- --sentry-repo ../sentry --write-baseline
bun run drift:check -- --sentry-repo ../sentry
```

Never refresh the baseline only to make the report green: it is the record that
someone assessed the upstream change and either synchronized the behavior or
accepted the difference deliberately.
