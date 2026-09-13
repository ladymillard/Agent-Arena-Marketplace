import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine/engine.ts";
import { MemoryStore } from "../src/store/store.ts";
import { TestClock } from "../src/core/clock.ts";
import { createServer } from "../src/http/server.ts";
import { ArenaClient } from "../src/sdk/client.ts";

const CLI = fileURLToPath(new URL("../bin/arena.ts", import.meta.url));
const execFileAsync = promisify(execFile);

async function hub() {
  const engine = new Engine({ store: new MemoryStore(), clock: new TestClock() });
  const server = createServer({ engine, adminToken: "operator-token-for-tests", tickIntervalMs: 0, rateLimit: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    engine,
    baseUrl,
    client: (apiKey?: string) => new ArenaClient({ baseUrl, apiKey }),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function join(h: Awaited<ReturnType<typeof hub>>, handle: string) {
  const { agent, apiKey } = await h.client().register({ handle, skills: ["typescript"] });
  h.engine.issueCredits(agent.id as string, 200_000, "test");
  return { id: agent.id as string, client: h.client(apiKey), apiKey };
}

async function runCli(args: string[], env: Record<string, string>) {
  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
  return stdout;
}

test("cli --json prints raw API responses for human-formatted work commands", async (t) => {
  const h = await hub();
  t.after(() => h.close());

  const sponsor = await join(h, "cli-sponsor");
  const worker = await join(h, "cli-worker");
  const reviewer = await join(h, "cli-reviewer");
  const env = { ARENA_URL: h.baseUrl };

  const { bounty: openBounty } = await sponsor.client.post({
    title: "Open CLI task",
    brief: "Leave this bounty open so the board command has a row to render.",
    reward: 20_000,
    acceptance: [{ kind: "artifact", key: "result" }],
  });

  const { bounty: paidBounty } = await sponsor.client.post({
    title: "Paid CLI task",
    brief: "Complete this bounty so the leaderboard command has a standing.",
    reward: 20_000,
    acceptance: [{ kind: "artifact", key: "result" }],
  });
  await worker.client.claim(paidBounty.id);
  await worker.client.submit(paidBounty.id, {
    summary: "Completed for CLI JSON coverage.",
    artifacts: { result: "done" },
  });

  const { bounty: reviewBounty } = await sponsor.client.post({
    title: "Review CLI task",
    brief: "Submit this bounty so the review queue command has a submission.",
    reward: 20_000,
    acceptance: [{ kind: "review", quorum: 1, approvals: 1 }],
  });
  await worker.client.claim(reviewBounty.id);
  await worker.client.submit(reviewBounty.id, { summary: "Ready for review by another agent." });

  const humanBoard = await runCli(["board", "--status", "open"], env);
  assert.match(humanBoard, new RegExp(`${openBounty.id}  Open CLI task`));
  assert.throws(() => JSON.parse(humanBoard));

  const board = JSON.parse(await runCli(["board", "--status", "open", "--json"], env)) as {
    bounties: { id: string; title: string }[];
  };
  assert.ok(board.bounties.some((b) => b.id === openBounty.id && b.title === "Open CLI task"));

  const leaderboard = JSON.parse(await runCli(["leaderboard", "--json"], env)) as {
    leaderboard: { handle: string; earned: { credits: number } }[];
  };
  assert.equal(leaderboard.leaderboard[0].handle, "cli-worker");
  assert.ok(leaderboard.leaderboard[0].earned.credits > 0);

  const queue = JSON.parse(await runCli(["review-queue", "--json"], { ...env, ARENA_KEY: reviewer.apiKey })) as {
    submissions: { bountyId: string; summary: string }[];
  };
  assert.equal(queue.submissions.length, 1);
  assert.equal(queue.submissions[0].bountyId, reviewBounty.id);
});
