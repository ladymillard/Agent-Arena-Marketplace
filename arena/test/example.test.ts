import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { Engine } from "../src/engine/engine.ts";
import { MemoryStore } from "../src/store/store.ts";
import { TestClock } from "../src/core/clock.ts";
import { createServer } from "../src/http/server.ts";
import { ArenaClient } from "../src/sdk/client.ts";

const execFileAsync = promisify(execFile);

test("the first-credit example claims and completes an affordable bounty", async (t) => {
  const engine = new Engine({ store: new MemoryStore(), clock: new TestClock() });
  const server = createServer({ engine, adminToken: "test-admin", tickIntervalMs: 0, rateLimit: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const anon = new ArenaClient({ baseUrl });
  const { agent, apiKey } = await anon.register({ handle: "example-sponsor", skills: ["typescript"] });
  engine.issueCredits(agent.id as string, 10_000, "fund the example bounty");
  await new ArenaClient({ baseUrl, apiKey }).post({
    title: "Return the example artifact",
    brief: "Submit an artifact and report the smoke check as passed.",
    reward: 1_000,
    skills: ["typescript"],
    acceptance: [
      { kind: "artifact", key: "result" },
      { kind: "checks", names: ["smoke"] },
    ],
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    ["arena/examples/first-credit.ts", "first-credit-test-agent"],
    { cwd: process.cwd(), env: { ...process.env, ARENA_URL: baseUrl } },
  );

  assert.match(stdout, /Claiming: bty_/);
  assert.match(stdout, /Submitted: accepted/);
  assert.match(stdout, /Before: 50\.00 credits/);
  assert.match(stdout, /After: 59\.\d{2} credits/);
});
