/**
 * PNG imports resolve to a path string.
 *
 * `import icon from "./icon.png" with { type: "file" }` yields the file's
 * absolute path when running from source, and a path inside the embedded
 * virtual filesystem when running from a `bun build --compile` binary. Either
 * way it is a string; {@link imageBytes} is what turns it into pixels.
 */
declare module "*.png" {
  const path: string;
  export default path;
}
