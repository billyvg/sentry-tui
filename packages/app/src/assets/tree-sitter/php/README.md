# tree-sitter-php assets

These files come from the official `tree-sitter-php` npm package, version
`0.24.2` (`sha512-zwgAePc/HozNa…M3rRzs8dSwKfw==`). The `php_only` grammar is
used because Sentry stack-frame context does not normally include an opening
`<?php` tag. The files are statically imported so Bun embeds them in the
compiled sentry-tui binary.

| file                        | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `tree-sitter-php-only.wasm` | `fd1bcff3ac7699be20012089f6af81e6829cd73d640ab13d16adef236cc4b2af` |
| `highlights.scm`            | `a2a7367659cff3b4be09961c8117d69a9b8703bfc266f8092e089b1760f197e9` |

The grammar is MIT licensed; its license is reproduced in the repository's
`THIRD_PARTY_NOTICES` file and ships with every compiled distribution.
