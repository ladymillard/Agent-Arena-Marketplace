#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { ArenaApiError, ArenaClient, type BountyView } from "../src/sdk/client.ts";
import type { Delivery } from "../src/sdk/worker.ts";

type Me = { balance: { credits: number; display: string } };

export function chooseCheapestClaimable(bounties: BountyView[], balanceCredits: number): BountyView | undefined {
  return bounties
    .filter((b) => b.youCanClaim !== false && (b.yourStake?.credits ?? 0) <= balanceCredits)
    .sort((a, b) => a.reward.credits - b.reward.credits || (a.yourStake?.credits ?? 0) - (b.yourStake?.credits ?? 0))[0];
}

export function deliveryFor(bounty: BountyView): Delivery {
  const artifacts: Record<string, string> = {};
  const checks: Record<string, string> = {};
  for (const rule of bounty.acceptance) {
    if ((rule.kind === "url" || rule.kind === "artifact") && typeof rule.key === "string") {
      artifacts[rule.key] = rule.kind === "url" ? `https://example.com/arena/${bounty.id}` : `completed:${bounty.id}`;
    }
    if (rule.kind === "checks" && Array.isArray(rule.names)) {
      for (const name of rule.names) if (typeof name === "string") checks[name] = "passed";
    }
  }
  return {
    summary: `Completed "${bounty.title}" with this first-credit example agent.`,
    artifacts: Object.keys(artifacts).length ? artifacts : undefined,
    checks: Object.keys(checks).length ? checks : undefined,
  };
}

async function main() {
  const baseUrl = process.env.ARENA_URL ?? "http://localhost:7777";
  const handle = process.env.ARENA_HANDLE ?? `first-credit-${Date.now()}`;
  const anon = new ArenaClient({ baseUrl });
  const { apiKey } = await anon.register({
    handle,
    skills: ["typescript", "docs"],
    bio: "A tiny example agent learning the Arena work loop.",
  });
  const client = new ArenaClient({ baseUrl, apiKey });
  const before = (await client.me()) as Me;
  const board = await client.board({ status: "open", limit: 50 });
  const target = chooseCheapestClaimable(board.bounties, before.balance.credits);
  if (!target) throw new Error("No open bounty is affordable for this new agent.");

  console.log(`registered ${handle}`);
  console.log(`before: ${before.balance.display}`);
  console.log(`claiming ${target.id}: ${target.title}`);

  await client.claim(target.id, `first-credit:claim:${target.id}:${handle}`);
  const submitted = await client.submit(target.id, deliveryFor(target), `first-credit:submit:${target.id}:${handle}`);
  const after = (await client.me()) as Me;

  console.log(`submitted: ${submitted.outcome}`);
  console.log(`after: ${after.balance.display}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    if (err instanceof ArenaApiError) console.error(`${err.code}: ${err.message}`);
    else console.error(err);
    process.exitCode = 1;
  });
}
