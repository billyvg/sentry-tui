/**
 * Crontab and interval schedules, as English.
 *
 * The web hands a cron monitor's schedule to `cronstrue`
 * (`crons/utils/crontabAsText.tsx`), which is a dependency and a locale
 * database this client has no room for. What a monitor row needs is one short
 * phrase for the shapes people actually schedule things on — every N minutes,
 * daily at a time, weekdays at a time — so this covers those and says so when
 * it cannot: an expression it does not recognise comes back `undefined`, and
 * the caller shows the raw crontab, which is still the truth.
 */

/** Weekday names, indexed the way cron numbers them (0 and 7 are both Sunday). */
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Weekday abbreviations cron accepts in place of a number. */
const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Nonstandard shorthands, expanded before parsing. */
const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/**
 * A crontab expression as a phrase, or `undefined` for one this does not
 * recognise.
 *
 * @example crontabAsText("0 9 * * *")   // "Every day at 09:00"
 * @example crontabAsText("0 6 * * 1") // "Every Monday at 06:00"
 * @example crontabAsText("30 6 * * 1-5") // "Every Monday–Friday at 06:30"
 */
export function crontabAsText(expression: string): string | undefined {
  const normalised = MACROS[expression.trim().toLowerCase()] ?? expression;
  const fields = normalised.trim().split(/\s+/);
  // Five fields, or six with the nonstandard leading seconds column.
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    fields.length === 6 ? fields.slice(1) : fields;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return undefined;

  const everyDate = dayOfMonth === "*" && month === "*";
  const everyDay = everyDate && dayOfWeek === "*";

  if (minute === "*" && hour === "*" && everyDay) return "Every minute";

  const minuteStep = stepOf(minute);
  if (minuteStep !== undefined && hour === "*" && everyDay) {
    return `Every ${plural(minuteStep, "minute")}`;
  }

  const minuteAt = numberOf(minute);
  if (minuteAt === undefined) return undefined;

  const hourStep = stepOf(hour);
  if (hourStep !== undefined && everyDay) {
    return `Every ${plural(hourStep, "hour")} at :${pad(minuteAt)}`;
  }

  if (hour === "*" && everyDay) {
    return `Every hour at :${pad(minuteAt)}`;
  }

  const hourAt = numberOf(hour);
  if (hourAt === undefined) return undefined;
  const at = `at ${pad(hourAt)}:${pad(minuteAt)}`;

  if (everyDay) return `Every day ${at}`;

  // A day-of-week restriction, with day-of-month left open: the common
  // "weekdays at 06:30" shape.
  if (everyDate) {
    const days = dayList(dayOfWeek);
    return days ? `Every ${days} ${at}` : undefined;
  }

  // A day-of-month restriction. Both fields restricted at once (the rare
  // "first Monday of the month" form) is left to the raw expression.
  if (dayOfWeek !== "*") return undefined;

  const dayAt = numberOf(dayOfMonth);
  if (dayAt === undefined) return undefined;
  if (month === "*") return `Day ${dayAt} of every month ${at}`;

  const monthAt = monthNumber(month);
  if (monthAt === undefined) return undefined;
  return `${MONTH_NAMES[monthAt - 1]} ${dayAt} ${at}`;
}

/**
 * An interval schedule as a phrase — the `[value, unit]` form of
 * `MonitorConfig.schedule` (`crons/types.tsx:77-88`).
 *
 * @example intervalAsText(15, "minute") // "Every 15 minutes"
 */
export function intervalAsText(value: number, unit: string): string {
  return `Every ${plural(value, unit)}`;
}

/** `n` with its unit, pluralised, and with the `1` left off: `Every hour`. */
function plural(value: number, unit: string): string {
  if (value === 1) return unit;
  return `${value} ${unit}s`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The `n` of a step field — a star, a slash, then a number. */
function stepOf(field: string): number | undefined {
  const match = field.match(/^\*\/(\d+)$/);
  if (!match) return undefined;
  const step = Number(match[1]);
  return step > 0 ? step : undefined;
}

/** A field that is a single number, or `undefined` for anything else. */
function numberOf(field: string): number | undefined {
  return /^\d+$/.test(field) ? Number(field) : undefined;
}

/** A month field as 1-12, by number or by name. */
function monthNumber(field: string): number | undefined {
  const numeric = numberOf(field);
  if (numeric !== undefined) return numeric >= 1 && numeric <= 12 ? numeric : undefined;
  return MONTH_ALIASES[field.toLowerCase().slice(0, 3)];
}

/**
 * A day-of-week field as names: `1` → `Monday`, `1-5` → `Monday–Friday`,
 * `1,3` → `Monday and Wednesday`.
 */
function dayList(field: string): string | undefined {
  const range = field.match(/^([^-]+)-([^-]+)$/);
  if (range) {
    const from = dayName(range[1]!);
    const to = dayName(range[2]!);
    return from && to ? `${from}–${to}` : undefined;
  }

  const names = field.split(",").map((part) => dayName(part));
  if (names.some((name) => name === undefined)) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One day-of-week token as a name, by number (0 or 7 being Sunday) or alias. */
function dayName(token: string): string | undefined {
  const trimmed = token.trim();
  const numeric = numberOf(trimmed);
  if (numeric !== undefined) return DAY_NAMES[numeric === 7 ? 0 : numeric];
  const alias = DAY_ALIASES[trimmed.toLowerCase().slice(0, 3)];
  return alias === undefined ? undefined : DAY_NAMES[alias];
}
