/**
 * Feature badges on the Explore sidebar.
 *
 * The web hard-codes three of them, so this is a literal rather than anything
 * derived: `new` on Metrics
 * (`views/navigation/secondary/sections/explore/exploreSecondaryNavigation.tsx:62`),
 * `alpha` on Errors (`:74`) and `beta` on Conversations (`:149`). The other six
 * items carry none.
 *
 * Kept in its own module, and keyed by nav label rather than by screen id,
 * because a badge annotates a *sidebar item* — it is not a property of the
 * kind of screen behind it. Errors is a Discover table and Conversations is
 * not, and both are badged.
 */

/** Badge text by Explore nav label, exactly as the web draws it. */
export const EXPLORE_NAV_BADGES: Readonly<Record<string, string>> = {
  Metrics: "NEW",
  Errors: "ALPHA",
  Conversations: "BETA",
};
