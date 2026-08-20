import { TextAttributes } from "@opentui/core";

/**
 * Named `<text attributes>` bitmasks.
 *
 * The prop takes a raw number, so call sites otherwise read as `attributes={1}`
 * with a trailing comment. Re-exported here so the comment lives in one place.
 */
export const BOLD = TextAttributes.BOLD;
export const ITALIC = TextAttributes.ITALIC;
export const DIM = TextAttributes.DIM;
export const NONE = TextAttributes.NONE;
