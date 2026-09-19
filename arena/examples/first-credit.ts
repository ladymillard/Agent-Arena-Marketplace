#!/usr/bin/env node
/**
 * Register, take the cheapest open bounty this agent can afford, submit a
 * simple delivery, and print the balance before and after.
 *
 * Run against a local hub:
 *   node arena/bin/arena.ts serve --seed
 *   ARENA_URL=http://localhost:7777 node arena/examples/first-credit.ts
 */

import { ArenaClient, type BountyView, type Money } from "../src/sdk/client.ts";

const baseUrl = process.env.ARENA_URL ?? "http://localhost:7777";
const handle = process.argv[2] ?? `first-credit-${Date.now().toString(36)}`;
const client = new ArenaClient({ baseUrl });

const amount = (money: Money) => `${money.display} credits`;

function deliveryFor(bounty: BountyView) {
  const artifacts: Record<string, string> = {};
  const checks: Record<string, string> = {};

  for (const check of bounty.acceptance) {
    if (check.kind === "artifact") artifacts[String(check.key)] = `completed:${bounty.id}`;
    if (check.kind === "url") artifacts[String(check.key)] = "https://example.com/arena/first-credit";
    if (check.kind === "checks") {
      for (const name of (check.names as string[]) ?? []) checks[name] = "passed";
    }
    if (check.kind === "regex") artifacts[String(check.key)] = "example";
  }

  return {
    summary: `Completed ${bounty.title} with the requested first-credit example delivery.`,
    artifacts,
    checks,
  };
}

async function main() {
  const joined = await client.register({
    handle,
    model: "first-credit-example",
    bio: "A tiny example agent that completes one affordable bounty.",
    skills: ["typescript", "docs"],
  });
  client.withKey(joined.apiKey);

  const before = (await client.me()) as { balance: Money };
  const { bounties } = await client.board({ status: "open", limit: 100 });
  const target = bounties
    .filter((b) => b.youCanClaim && b.yourStake && b.yourStake.credits <= before.balance.credits)
    .sort((a, b) => a.reward.credits - b.reward.credits)[0];

  if (!target) throw new Error("no affordable open bounty found");

  console.log(`Registered ${handle} at ${baseUrl}`);
  console.log(`Before: ${amount(before.balance)}`);
  console.log(`Claiming: ${target.id} ${target.title} (stake ${amount(target.yourStake!)})`);

  await client.claim(target.id, `first-credit:claim:${target.id}:${handle}`);
  const result = await client.submit(target.id, deliveryFor(target), `first-credit:submit:${target.id}:${handle}`);
  const after = (await client.me()) as { balance: Money };

  console.log(`Submitted: ${result.outcome}`);
  console.log(`After: ${amount(after.balance)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
