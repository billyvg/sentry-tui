/**
 * Generate the prebuilt dashboard catalog from a local getsentry/sentry checkout.
 *
 * Usage:
 *   bun run ./scripts/sync-prebuilt-dashboards.ts --sentry-repo ../sentry
 */

import type { BunPlugin } from "bun";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import type { DashboardWidget, WidgetQuery } from "~/api/dashboards";

const OUTPUT_PATH = resolve(
  import.meta.dir,
  "../packages/app/src/core/prebuiltDashboards.generated.json",
);
const SENTRY_MODULE_ROOT = "sentry/";
const PREBUILT_MODULE_ROOT = "sentry/views/dashboards/utils/prebuiltConfigs";
const REAL_UPSTREAM_MODULES = new Set([
  "sentry/views/dashboards/widgetLibrary/rageAndDeadClicksWidget",
  "sentry/views/dashboards/widgetLibrary/serverTreeWidget",
  "sentry/views/dashboards/widgetLibrary/webVitalsWidgets",
  "sentry/views/insights/browser/common/queries/useResourcesQuery",
  "sentry/views/insights/browser/resources/constants",
  "sentry/views/insights/browser/resources/settings",
  "sentry/views/insights/browser/resources/types",
  "sentry/views/insights/browser/webVitals/settings",
  "sentry/views/insights/common/views/spans/types",
]);

interface UpstreamQuery extends Partial<WidgetQuery> {
  aggregates?: string[];
  columns?: string[];
  conditions?: string;
  name?: string;
  orderby?: string;
}

interface UpstreamWidget extends Omit<Partial<DashboardWidget>, "queries"> {
  displayType: string;
  queries: UpstreamQuery[];
  title: string;
}

interface UpstreamDashboard {
  description?: string;
  title: string;
  widgets: UpstreamWidget[];
}

export interface GeneratedDashboard {
  description: string;
  title: string;
  widgets: DashboardWidget[];
}

export interface GeneratedPrebuiltDashboards {
  dashboards: Record<string, GeneratedDashboard>;
  source: {
    path: string;
    repository: string;
    revision: string;
  };
}

/** Read a required command-line option. */
function option(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index < 0 ? undefined : Bun.argv[index + 1];
  if (!value) throw new Error(`Missing ${name} <path>`);
  return value;
}

/** Resolve a Sentry module alias to the corresponding TypeScript source. */
function resolveSentryModule(appRoot: string, moduleName: string): string {
  const base = join(appRoot, moduleName.slice(SENTRY_MODULE_ROOT.length));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  const path = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!path) throw new Error(`Cannot resolve upstream module ${moduleName}`);
  return path;
}

/** Copy selected enum declarations into a tiny executable shim module. */
function enumDeclarations(path: string, names: readonly string[]): string {
  const sourceText = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const declarations = source.statements
    .filter(
      (statement): statement is ts.EnumDeclaration =>
        ts.isEnumDeclaration(statement) && names.includes(statement.name.text),
    )
    .map((statement) => statement.getText(source));

  if (declarations.length !== names.length) {
    throw new Error(`Expected enums ${names.join(", ")} in ${path}`);
  }
  return declarations.join("\n");
}

/** Copy the initializer of a simple upstream constant into a shim module. */
function variableDeclaration(path: string, name: string): string {
  const sourceText = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === name,
    );
    if (declaration?.initializer) {
      return `export const ${name} = ${declaration.initializer.getText(source)};`;
    }
  }
  throw new Error(`Expected variable ${name} in ${path}`);
}

/** Runtime shims for the small set of Web helpers used while defining dashboards. */
function shimSource(appRoot: string, moduleName: string): string {
  switch (moduleName) {
    case "sentry/locale":
      return "export const t = (message: string) => message;";
    case "sentry/views/dashboards/types":
      return `${enumDeclarations(resolveSentryModule(appRoot, moduleName), ["DisplayType", "WidgetType", "SlideoutId"])}\n${variableDeclaration(resolveSentryModule(appRoot, moduleName), "MAX_TABLE_LIMIT")}`;
    case "sentry/views/insights/types":
      return enumDeclarations(resolveSentryModule(appRoot, moduleName), [
        "ModuleName",
        "SpanFields",
        "SpanFunction",
      ]);
    case "sentry/utils/discover/fields":
      return `${enumDeclarations(resolveSentryModule(appRoot, moduleName), ["DurationUnit", "SizeUnit", "RateUnit"])}
        ${variableDeclaration(resolveSentryModule(appRoot, moduleName), "RATE_UNIT_TITLE")}`;
    case "sentry/utils/fields":
      return enumDeclarations(resolveSentryModule(appRoot, moduleName), ["FieldKind"]);
    case "sentry/utils/tokenizeSearch":
      return `
        ${variableDeclaration(resolveSentryModule(appRoot, moduleName), "EMPTY_OPTION_VALUE")}
        export class MutableSearch {
          parts: string[];
          constructor(query: string | string[]) {
            this.parts = Array.isArray(query) ? [...query] : query ? [query] : [];
          }
          static fromQueryObject(values: Record<string, string | string[] | number | undefined>) {
            const query = new MutableSearch("");
            for (const [key, value] of Object.entries(values)) {
              if (Array.isArray(value)) query.addFilterValues(key, value);
              else if (value) query.addFilterValue(key, String(value));
            }
            return query;
          }
          addFilterValue(key: string, value: string) {
            this.parts.push(key + ":" + value);
            return this;
          }
          addFilterValues(key: string, values: string[]) {
            for (const value of values) this.addFilterValue(key, value);
            return this;
          }
          addDisjunctionFilterValues(key: string, values: string[]) {
            if (values.length === 0) return this;
            this.addOp("(");
            values.forEach((value, index) => {
              if (index > 0) this.addOp("OR");
              this.addFilterValue(key, value);
            });
            this.addOp(")");
            return this;
          }
          addOp(value: string) {
            this.parts.push(value);
            return this;
          }
          formatString() {
            return this.parts.join(" ").trim();
          }
        }
      `;
    case "sentry/views/dashboards/constants":
      return variableDeclaration(resolveSentryModule(appRoot, moduleName), "NUM_DESKTOP_COLS");
    case "sentry/components/tables/gridEditable":
      return "export const COL_WIDTH_UNDEFINED = -1;";
    case "sentry/views/explore/metrics/constants":
      return variableDeclaration(resolveSentryModule(appRoot, moduleName), "NONE_UNIT");
    case "sentry/views/insights/pages/backend/settings":
      return variableDeclaration(
        resolveSentryModule(appRoot, moduleName),
        "OVERVIEW_PAGE_ALLOWED_OPS",
      );
    case "sentry/views/insights/pages/frontend/settings":
      return `${variableDeclaration(resolveSentryModule(appRoot, moduleName), "WEB_VITALS_OPS")}
        ${variableDeclaration(resolveSentryModule(appRoot, moduleName), "OVERVIEW_PAGE_ALLOWED_OPS")}`;
    case "sentry/views/insights/pages/mobile/settings":
      return variableDeclaration(
        resolveSentryModule(appRoot, moduleName),
        "OVERVIEW_PAGE_ALLOWED_OPS",
      );
    default:
      throw new Error(`No runtime shim for upstream module ${moduleName}`);
  }
}

/** Build plugin that evaluates Sentry's declarative configs in isolation. */
function sentryLoader(appRoot: string): BunPlugin {
  return {
    name: "sentry-prebuilt-dashboard-loader",
    setup(builder) {
      builder.onResolve({ filter: /^sentry\// }, ({ path }) => {
        if (path === PREBUILT_MODULE_ROOT || path.startsWith(`${PREBUILT_MODULE_ROOT}/`)) {
          return { path: resolveSentryModule(appRoot, path) };
        }
        if (REAL_UPSTREAM_MODULES.has(path)) return { path: resolveSentryModule(appRoot, path) };
        return { path, namespace: "sentry-dashboard-shim" };
      });
      builder.onLoad({ filter: /.*/, namespace: "sentry-dashboard-shim" }, ({ path }) => ({
        contents: shimSource(appRoot, path),
        loader: "ts",
      }));
    },
  };
}

/** Retain the query fields the TUI sends to Sentry's APIs. */
function normalizeQuery(query: UpstreamQuery): WidgetQuery {
  return {
    name: query.name ?? "",
    conditions: query.conditions ?? "",
    columns: query.columns ?? [],
    aggregates: query.aggregates ?? [],
    orderby: query.orderby ?? "",
    ...(query.fields ? { fields: query.fields } : {}),
    ...(query.fieldAliases ? { fieldAliases: query.fieldAliases } : {}),
    ...(query.selectedAggregate === undefined
      ? {}
      : { selectedAggregate: query.selectedAggregate }),
  };
}

/** Retain only the widget fields the terminal can query or render. */
function normalizeWidget(widget: UpstreamWidget): DashboardWidget {
  return {
    ...(widget.id ? { id: widget.id } : {}),
    title: widget.title,
    ...(widget.description == null ? {} : { description: widget.description }),
    displayType: widget.displayType,
    ...(widget.widgetType == null ? {} : { widgetType: widget.widgetType }),
    queries: widget.queries.map(normalizeQuery),
    ...(widget.interval ? { interval: widget.interval } : {}),
    ...(widget.limit == null ? {} : { limit: widget.limit }),
    ...(widget.layout == null ? {} : { layout: widget.layout }),
  };
}

/** Read the checked-out revision without requiring the generator itself to use the network. */
async function gitRevision(repoRoot: string): Promise<string> {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || "git rev-parse failed");
  return stdout.trim();
}

/** Format a generated JSON artifact with the repository's pinned formatter. */
export async function formatGeneratedJson(path: string): Promise<void> {
  const process = Bun.spawn(["bunx", "oxfmt", "--write", path], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `Could not format ${path}`);
}

/** Import a generated bundle from a uniquely owned temporary directory. */
async function importBundle(bundle: string): Promise<{
  PREBUILT_DASHBOARDS: Record<number, UpstreamDashboard>;
}> {
  const tempDir = mkdtempSync(join(tmpdir(), "sentry-tui-prebuilt-"));
  const bundlePath = join(tempDir, "prebuilt-dashboards.mjs");
  try {
    await Bun.write(bundlePath, bundle);
    return (await import(pathToFileURL(bundlePath).href)) as {
      PREBUILT_DASHBOARDS: Record<number, UpstreamDashboard>;
    };
  } finally {
    rmSync(tempDir, { recursive: true });
  }
}

/** Extract the runtime dashboard catalog from a local Sentry checkout. */
export async function generatePrebuiltDashboards(
  sentryRepoRoot: string,
): Promise<GeneratedPrebuiltDashboards> {
  const repoRoot = resolve(sentryRepoRoot);
  const appRoot = join(repoRoot, "static/app");
  const entry = resolveSentryModule(appRoot, PREBUILT_MODULE_ROOT);
  const build = await Bun.build({
    entrypoints: [entry],
    plugins: [sentryLoader(appRoot)],
    target: "bun",
    format: "esm",
  });
  if (!build.success || !build.outputs[0]) {
    throw new AggregateError(build.logs, "Could not bundle Sentry's dashboard configs");
  }
  const bundle = await build.outputs[0].text();
  const upstream = await importBundle(bundle);
  const dashboards = Object.fromEntries(
    Object.entries(upstream.PREBUILT_DASHBOARDS).map(([id, dashboard]) => [
      id,
      {
        title: dashboard.title,
        description: dashboard.description ?? "",
        widgets: dashboard.widgets.map(normalizeWidget),
      } satisfies GeneratedDashboard,
    ]),
  );
  return {
    source: {
      repository: "https://github.com/getsentry/sentry",
      revision: await gitRevision(repoRoot),
      path: "static/app/views/dashboards/utils/prebuiltConfigs.tsx",
    },
    dashboards,
  };
}

/** Generate the checked-in dashboard catalog. */
async function main(): Promise<void> {
  const generated = await generatePrebuiltDashboards(option("--sentry-repo"));
  await Bun.write(OUTPUT_PATH, `${JSON.stringify(generated, null, 2)}\n`);
  await formatGeneratedJson(OUTPUT_PATH);
  console.log(`Wrote ${Object.keys(generated.dashboards).length} dashboards to ${OUTPUT_PATH}`);
}

if (import.meta.main) await main();
