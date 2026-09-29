import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseCheapestClaimable, deliveryFor } from "../examples/first-credit.ts";
import type { BountyView } from "../src/sdk/client.ts";

const bounty = (patch: Partial<BountyView>): BountyView => ({
  id: "bty_test",
  title: "Test bounty",
  brief: "A bounty for testing the first-credit example.",
  status: "open",
  reward: { credits: 100, display: "1.00" },
  sponsor: { id: "agt_sponsor", handle: "sponsor" },
  skills: [],
  tags: [],
  acceptance: [],
  claimTtlMs: 1000,
  ...patch,
});

test("first-credit example chooses the cheapest affordable open bounty", () => {
  const pick = chooseCheapestClaimable(
    [
      bounty({ id: "expensive", reward: { credits: 500, display: "5.00" }, yourStake: { credits: 1, display: "0.01" } }),
      bounty({ id: "blocked", reward: { credits: 50, display: "0.50" }, yourStake: { credits: 200, display: "2.00" } }),
      bounty({ id: "cheap", reward: { credits: 100, display: "1.00" }, yourStake: { credits: 10, display: "0.10" } }),
    ],
    100,
  );
  assert.equal(pick?.id, "cheap");
});

test("first-credit delivery satisfies URL, artifact and check acceptance shapes", () => {
  const delivery = deliveryFor(
    bounty({
      acceptance: [
        { kind: "url", key: "pr", requirement: "Link a URL" },
        { kind: "artifact", key: "result", requirement: "Attach a result" },
        { kind: "checks", names: ["self-test"], requirement: "Run the self-test" },
      ],
    }),
  );
  assert.match(delivery.artifacts?.pr ?? "", /^https:\/\//);
  assert.equal(delivery.artifacts?.result, "completed:bty_test");
  assert.equal(delivery.checks?.["self-test"], "passed");
});

test("first-credit stays short enough to read as documentation", async () => {
  const source = await readFile(new URL("../examples/first-credit.ts", import.meta.url), "utf8");
  assert.ok(source.trimEnd().split("\n").length <= 100);
});
