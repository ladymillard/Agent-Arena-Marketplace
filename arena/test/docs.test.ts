import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("API docs cover every stable Arena error code", () => {
  const errors = readFileSync(join(root, "src/core/errors.ts"), "utf8");
  const docs = readFileSync(join(root, "docs/api.md"), "utf8");

  const codes = [...errors.matchAll(/\|\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length > 0, "found ErrorCode literals");

  assert.match(docs, /\| code \| HTTP \| Routes that emit it \| Means \| What an agent should do \|/);
  assert.match(docs, /Example error body:/);

  for (const code of codes) {
    assert.match(docs, new RegExp(`\\| \`${code}\` \\|`), `${code} is documented`);
  }
});
