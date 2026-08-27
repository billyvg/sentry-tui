/**
 * Compare Sentry Web's frontend contracts with the reviewed local baseline.
 *
 * With no checkout argument this script makes a shallow sparse clone itself:
 *   bun run drift:check
 *
 * Development and baseline refreshes can reuse an existing checkout:
 *   bun run drift:check -- --sentry-repo ../sentry
 *   bun run drift:check -- --sentry-repo ../sentry --write-baseline
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

import localPrebuilts from "../packages/app/src/core/prebuiltDashboards.generated.json";
import {
  formatGeneratedJson,
  generatePrebuiltDashboards,
  type GeneratedDashboard,
} from "./sync-prebuilt-dashboards";

const BASELINE_PATH = resolve(import.meta.dir, "sentry-frontend-baseline.json");
const SENTRY_REPOSITORY = "https://github.com/getsentry/sentry.git";
const SPARSE_PATHS = [
  "static/app/components/tables",
  "static/app/types/workflowEngine",
  "static/app/utils",
  "static/app/views/dashboards",
  "static/app/views/discover/results",
  "static/app/views/explore",
  "static/app/views/insights",
  "static/app/views/issueList",
  "static/app/views/navigation",
];

interface FrontendSnapshot {
  detectorTypes: string[];
  exploreFields: Record<string, string[]>;
  issueSortOptions: string[];
  navigation: Record<string, string[]>;
  prebuiltConfigInputs: Record<string, string>;
  widgetDisplayTypes: string[];
}

interface FrontendBaseline {
  snapshot: FrontendSnapshot;
  source: {
    repository: string;
    revision: string;
  };
}

export interface DriftSection {
  details: string[];
  drifted: boolean;
  title: string;
}

/** Read a command-line option when present. */
function optionalOption(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? undefined : Bun.argv[index + 1];
}

/** Run a subprocess and surface its stderr on failure. */
async function run(command: string[], cwd?: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `${command.join(" ")} failed`);
  return stdout.trim();
}

/** Create the lightweight checkout used by the scheduled job. */
async function cloneSentry(): Promise<{ cleanup: () => void; repoRoot: string }> {
  const tempRoot = mkdtempSync(join(tmpdir(), "sentry-tui-drift-"));
  const repoRoot = join(tempRoot, "sentry");
  try {
    await run([
      "git",
      "clone",
      "--depth=1",
      "--filter=blob:none",
      "--sparse",
      SENTRY_REPOSITORY,
      repoRoot,
    ]);
    await run(["git", "sparse-checkout", "set", ...SPARSE_PATHS], repoRoot);
    return { repoRoot, cleanup: () => rmSync(tempRoot, { recursive: true }) };
  } catch (error) {
    rmSync(tempRoot, { recursive: true });
    throw error;
  }
}

/** Parse one upstream TypeScript source file. */
function sourceFile(repoRoot: string, path: string): ts.SourceFile {
  const absolutePath = join(repoRoot, path);
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Locate a named top-level declaration. */
function declaration(source: ts.SourceFile, name: string): ts.Node {
  for (const statement of source.statements) {
    if (
      (ts.isEnumDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      const match = statement.declarationList.declarations.find(
        (item) => ts.isIdentifier(item.name) && item.name.text === name,
      );
      if (match) return match;
    }
  }
  throw new Error(`Could not find ${name} in ${source.fileName}`);
}

/** Hash selected method tokens while ignoring comments and whitespace. */
function classMethodsHash(
  source: ts.SourceFile,
  className: string,
  names: readonly string[],
): string {
  const node = declaration(source, className);
  if (!ts.isClassDeclaration(node)) throw new Error(`${className} is not a class`);
  const members = node.members.filter((member) => {
    if (names.includes("constructor") && ts.isConstructorDeclaration(member) && member.body)
      return true;
    return (
      ts.isMethodDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      names.includes(member.name.text)
    );
  });
  const found = members.map((member) => {
    if (ts.isConstructorDeclaration(member)) return "constructor";
    if (ts.isMethodDeclaration(member) && member.name) return member.name.getText(source);
    throw new Error(`Unexpected ${className} member`);
  });
  const missing = names.filter((name) => !found.includes(name));
  if (missing.length) throw new Error(`Missing ${className} methods: ${missing.join(", ")}`);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard);
  const tokens: string[] = [];
  for (const member of members) {
    scanner.setText(member.getText(source));
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    ) {
      tokens.push(scanner.getTokenText());
    }
  }
  return new Bun.CryptoHasher("sha256").update(tokens.join("\0")).digest("hex");
}

/** Extract string wire values from an enum. */
function enumValues(source: ts.SourceFile, name: string): string[] {
  const node = declaration(source, name);
  if (!ts.isEnumDeclaration(node)) throw new Error(`${name} is not an enum`);
  return node.members.map((member) => {
    if (!member.initializer || !ts.isStringLiteral(member.initializer)) {
      throw new Error(`${name}.${member.name.getText(source)} is not a string literal`);
    }
    return member.initializer.text;
  });
}

/** Extract string literals from a union type. */
function unionValues(source: ts.SourceFile, name: string): string[] {
  const node = declaration(source, name);
  if (!ts.isTypeAliasDeclaration(node) || !ts.isUnionTypeNode(node.type)) {
    throw new Error(`${name} is not a union type`);
  }
  return node.type.types.flatMap((type) =>
    ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? [type.literal.text] : [],
  );
}

/** Build lookup tables used to evaluate enum members inside field arrays. */
function enumLookup(
  sources: Array<{ name: string; source: ts.SourceFile }>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    sources.map(({ name, source }) => {
      const node = declaration(source, name);
      if (!ts.isEnumDeclaration(node)) throw new Error(`${name} is not an enum`);
      return [
        name,
        Object.fromEntries(
          node.members.map((member) => {
            if (!member.initializer || !ts.isStringLiteral(member.initializer)) {
              throw new Error(`${name}.${member.name.getText(source)} is not a string literal`);
            }
            return [member.name.getText(source), member.initializer.text];
          }),
        ),
      ];
    }),
  );
}

/** Evaluate the literal and enum-member elements used by frontend field lists. */
function arrayValues(
  source: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  enums: Record<string, Record<string, string>>,
): string[] {
  return array.elements.map((element) => {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
      return element.text;
    }
    if (ts.isPropertyAccessExpression(element) && ts.isIdentifier(element.expression)) {
      const value = enums[element.expression.text]?.[element.name.text];
      if (value !== undefined) return value;
    }
    throw new Error(`Cannot evaluate ${element.getText(source)} in ${source.fileName}`);
  });
}

/** Find the first array returned by a named function. */
function returnedArrayValues(
  source: ts.SourceFile,
  name: string,
  enums: Record<string, Record<string, string>>,
): string[] {
  const node = declaration(source, name);
  let array: ts.ArrayLiteralExpression | undefined;
  const visit = (child: ts.Node) => {
    if (
      !array &&
      ts.isReturnStatement(child) &&
      child.expression &&
      ts.isArrayLiteralExpression(child.expression)
    ) {
      array = child.expression;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  if (!array) throw new Error(`Could not find returned array in ${name}`);
  return arrayValues(source, array, enums);
}

/** Evaluate an array-valued variable declaration. */
function variableArrayValues(
  source: ts.SourceFile,
  name: string,
  enums: Record<string, Record<string, string>>,
): string[] {
  const node = declaration(source, name);
  if (
    !ts.isVariableDeclaration(node) ||
    !node.initializer ||
    !ts.isArrayLiteralExpression(node.initializer)
  ) {
    throw new Error(`${name} is not an array variable`);
  }
  return arrayValues(source, node.initializer, enums);
}

/** Evaluate an array property on an object-valued variable. */
function objectArrayPropertyValues(
  source: ts.SourceFile,
  name: string,
  propertyName: string,
): string[] {
  const node = declaration(source, name);
  if (
    !ts.isVariableDeclaration(node) ||
    !node.initializer ||
    !ts.isObjectLiteralExpression(node.initializer)
  ) {
    throw new Error(`${name} is not an object variable`);
  }
  const property = node.initializer.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) && item.name.getText(source) === propertyName,
  );
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) {
    throw new Error(`${name}.${propertyName} is not an array`);
  }
  return arrayValues(source, property.initializer, {});
}

/** Collect translated string literals from selected navigation sources. */
function translatedStrings(sources: ts.SourceFile[]): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      values.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  sources.forEach(visit);
  return [...new Set(values)];
}

/** Collect `property: t("value")` declarations such as taxonomy labels. */
function translatedPropertyStrings(source: ts.SourceFile, propertyName: string): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === propertyName &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "t" &&
      node.initializer.arguments[0] &&
      ts.isStringLiteral(node.initializer.arguments[0])
    ) {
      values.push(node.initializer.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(values)];
}

/** Read a translated string constant such as Sentry's prebuilt nav label. */
function translatedVariableString(source: ts.SourceFile, name: string): string {
  const node = declaration(source, name);
  if (
    !ts.isVariableDeclaration(node) ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer) ||
    !node.initializer.arguments[0] ||
    !ts.isStringLiteral(node.initializer.arguments[0])
  ) {
    throw new Error(`${name} is not a translated string constant`);
  }
  return node.initializer.arguments[0].text;
}

/** Extract the reviewed frontend contracts without executing Web's application code. */
function frontendSnapshot(repoRoot: string): FrontendSnapshot {
  const dashboardTypes = sourceFile(repoRoot, "static/app/views/dashboards/types.tsx");
  const detectorTypes = sourceFile(repoRoot, "static/app/types/workflowEngine/detectors.tsx");
  const issueUtils = sourceFile(repoRoot, "static/app/views/issueList/utils.tsx");
  const spanTypes = sourceFile(repoRoot, "static/app/views/insights/types.tsx");
  const logTypes = sourceFile(repoRoot, "static/app/views/explore/logs/types.tsx");
  const metricTypes = sourceFile(repoRoot, "static/app/views/explore/metrics/types.tsx");
  const issueTaxonomies = sourceFile(repoRoot, "static/app/views/issueList/taxonomies.tsx");
  const tokenizeSearch = sourceFile(repoRoot, "static/app/utils/tokenizeSearch.tsx");
  const enums = enumLookup([
    { name: "SpanFields", source: spanTypes },
    { name: "OurLogKnownFieldKey", source: logTypes },
    { name: "TraceMetricKnownFieldKey", source: metricTypes },
    { name: "VirtualTableSampleColumnKey", source: metricTypes },
  ]);

  return {
    navigation: {
      primary: translatedStrings([
        sourceFile(repoRoot, "static/app/views/navigation/navigation.tsx"),
      ]),
      issues: [
        ...translatedStrings([
          sourceFile(
            repoRoot,
            "static/app/views/navigation/secondary/sections/issues/issuesSecondaryNavigation.tsx",
          ),
        ]),
        ...translatedPropertyStrings(issueTaxonomies, "label"),
      ],
      explore: translatedStrings([
        sourceFile(
          repoRoot,
          "static/app/views/navigation/secondary/sections/explore/exploreSecondaryNavigation.tsx",
        ),
      ]),
      dashboards: [
        ...translatedStrings([
          sourceFile(
            repoRoot,
            "static/app/views/navigation/secondary/sections/dashboards/dashboardsSecondaryNavigation.tsx",
          ),
        ]),
        translatedVariableString(dashboardTypes, "PREBUILT_DASHBOARD_LABEL"),
      ],
      monitors: translatedStrings([
        sourceFile(
          repoRoot,
          "static/app/views/navigation/secondary/sections/monitors/monitorsSecondaryNavigation.tsx",
        ),
      ]),
    },
    issueSortOptions: enumValues(issueUtils, "IssueSortOptions"),
    exploreFields: {
      traces: returnedArrayValues(
        sourceFile(repoRoot, "static/app/views/explore/spans/spansQueryParams.tsx"),
        "defaultFields",
        enums,
      ),
      logs: returnedArrayValues(
        sourceFile(repoRoot, "static/app/views/explore/contexts/logs/fields.tsx"),
        "defaultLogFields",
        enums,
      ),
      metrics: variableArrayValues(
        sourceFile(repoRoot, "static/app/views/explore/metrics/constants.tsx"),
        "TraceSamplesTableEmbeddedColumns",
        enums,
      ),
      errors: objectArrayPropertyValues(
        sourceFile(repoRoot, "static/app/views/discover/results/data.tsx"),
        "DEFAULT_ERROR_VIEW",
        "fields",
      ),
    },
    detectorTypes: unionValues(detectorTypes, "DetectorType"),
    prebuiltConfigInputs: {
      MutableSearch: classMethodsHash(tokenizeSearch, "MutableSearch", [
        "constructor",
        "fromQueryObject",
        "formatString",
        "addFilterValues",
        "addDisjunctionFilterValues",
        "addFilterValue",
        "addOp",
      ]),
    },
    widgetDisplayTypes: enumValues(dashboardTypes, "DisplayType"),
  };
}

/** Describe additions, removals, or ordering changes between string lists. */
export function listDifference(expected: string[], actual: string[]): string[] {
  const added = actual.filter((value) => !expected.includes(value));
  const removed = expected.filter((value) => !actual.includes(value));
  const details = [
    ...(added.length ? [`added ${added.map((value) => `\`${value}\``).join(", ")}`] : []),
    ...(removed.length ? [`removed ${removed.map((value) => `\`${value}\``).join(", ")}`] : []),
  ];
  if (details.length === 0 && JSON.stringify(expected) !== JSON.stringify(actual)) {
    details.push("order changed");
  }
  return details;
}

/** Compare one map of named string lists. */
function mapSections(
  title: string,
  expected: Record<string, string[]>,
  actual: Record<string, string[]>,
): DriftSection {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  const details = keys.flatMap((key) => {
    const difference = listDifference(expected[key] ?? [], actual[key] ?? []);
    return difference.map((line) => `**${key}**: ${line}`);
  });
  return { title, details, drifted: details.length > 0 };
}

/** Compare one flat set-like declaration. */
function listSection(title: string, expected: string[], actual: string[]): DriftSection {
  const details = listDifference(expected, actual);
  return { title, details, drifted: details.length > 0 };
}

/** Compare named semantic hashes used by the dashboard extractor's shims. */
function valueMapSection(
  title: string,
  expected: Record<string, string>,
  actual: Record<string, string>,
): DriftSection {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  const details = keys.flatMap((key) => {
    if (!(key in expected)) return [`**${key}**: added`];
    if (!(key in actual)) return [`**${key}**: removed`];
    return expected[key] === actual[key] ? [] : [`**${key}**: behavior changed`];
  });
  return { title, details, drifted: details.length > 0 };
}

/** Identify changes in one dashboard while keeping the report compact. */
export function dashboardDifference(
  expected: GeneratedDashboard,
  actual: GeneratedDashboard,
): string[] {
  const details: string[] = [];
  if (expected.title !== actual.title) details.push(`title changed to \`${actual.title}\``);
  if (expected.description !== actual.description) details.push("description changed");

  const widgetKey = (widget: GeneratedDashboard["widgets"][number]) => widget.id ?? widget.title;
  const expectedWidgets = new Map(expected.widgets.map((widget) => [widgetKey(widget), widget]));
  const actualWidgets = new Map(actual.widgets.map((widget) => [widgetKey(widget), widget]));
  const added = [...actualWidgets.keys()].filter((key) => !expectedWidgets.has(key));
  const removed = [...expectedWidgets.keys()].filter((key) => !actualWidgets.has(key));
  const changed = [...actualWidgets.keys()].filter((key) => {
    const previous = expectedWidgets.get(key);
    return previous && JSON.stringify(previous) !== JSON.stringify(actualWidgets.get(key));
  });
  if (added.length) details.push(`widgets added: ${added.map((key) => `\`${key}\``).join(", ")}`);
  if (removed.length)
    details.push(`widgets removed: ${removed.map((key) => `\`${key}\``).join(", ")}`);
  if (changed.length)
    details.push(`widgets changed: ${changed.map((key) => `\`${key}\``).join(", ")}`);
  return details;
}

/** Compare generated prebuilt definitions with the runtime catalog. */
function dashboardSection(
  expected: Record<string, GeneratedDashboard>,
  actual: Record<string, GeneratedDashboard>,
): DriftSection {
  const expectedIds = Object.keys(expected);
  const actualIds = Object.keys(actual);
  const details = listDifference(expectedIds, actualIds).map(
    (detail) => `Dashboard IDs: ${detail}`,
  );
  for (const id of actualIds.filter((candidate) => expected[candidate])) {
    const difference = dashboardDifference(expected[id]!, actual[id]!);
    if (difference.length)
      details.push(`**${id} — ${actual[id]!.title}**: ${difference.join("; ")}`);
  }
  return { title: "Prebuilt Dashboards", details, drifted: details.length > 0 };
}

/** Render the stable markdown report consumed by both people and the workflow. */
export function report(revision: string, sections: DriftSection[]): string {
  const lines = [
    "## Sentry Frontend Drift Report",
    "",
    `Compared against \`getsentry/sentry@${revision.slice(0, 12)}\`.`,
    "",
  ];
  for (const section of sections) {
    lines.push(`### ${section.title}`, "");
    if (section.drifted) {
      lines.push(...section.details.map((detail) => `⚠️ ${detail}`));
    } else {
      lines.push("✅ In sync");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Run the comparison or refresh the reviewed semantic baseline. */
async function main(): Promise<void> {
  const suppliedRepo = optionalOption("--sentry-repo");
  const checkout = suppliedRepo
    ? { repoRoot: resolve(suppliedRepo), cleanup: () => undefined }
    : await cloneSentry();

  try {
    const revision = await run(["git", "rev-parse", "HEAD"], checkout.repoRoot);
    const snapshot = frontendSnapshot(checkout.repoRoot);
    if (Bun.argv.includes("--write-baseline")) {
      const baseline: FrontendBaseline = {
        source: { repository: SENTRY_REPOSITORY, revision },
        snapshot,
      };
      await Bun.write(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
      await formatGeneratedJson(BASELINE_PATH);
      console.log(`Wrote ${BASELINE_PATH}`);
      return;
    }

    const baseline = (await Bun.file(BASELINE_PATH).json()) as FrontendBaseline;
    const upstreamPrebuilts = await generatePrebuiltDashboards(checkout.repoRoot);
    const sections = [
      mapSections("Navigation", baseline.snapshot.navigation, snapshot.navigation),
      listSection(
        "Issue Sort Options",
        baseline.snapshot.issueSortOptions,
        snapshot.issueSortOptions,
      ),
      mapSections("Explore Fields", baseline.snapshot.exploreFields, snapshot.exploreFields),
      listSection("Detector Types", baseline.snapshot.detectorTypes, snapshot.detectorTypes),
      listSection(
        "Widget Display Types",
        baseline.snapshot.widgetDisplayTypes,
        snapshot.widgetDisplayTypes,
      ),
      valueMapSection(
        "Prebuilt Config Inputs",
        baseline.snapshot.prebuiltConfigInputs,
        snapshot.prebuiltConfigInputs,
      ),
      dashboardSection(
        localPrebuilts.dashboards as unknown as Record<string, GeneratedDashboard>,
        upstreamPrebuilts.dashboards,
      ),
    ];
    console.log(report(revision, sections));
    if (sections.some((section) => section.drifted)) process.exitCode = 1;
  } finally {
    checkout.cleanup();
  }
}

if (import.meta.main) await main();
