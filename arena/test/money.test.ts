import test from "node:test";
import assert from "node:assert/strict";
import { add, bps, credits, feeSplit, format, parse, weightedSplit } from "../src/core/money.ts";

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function integerBelow(random: () => number, exclusiveMax: number): number {
  return Math.floor(random() * exclusiveMax);
}

function expectedRemainderSplit(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));

  const shares = weights.map((w) => Math.floor((amount * w) / total));
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  let remainder = amount - shares.reduce((a, b) => a + b, 0);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    shares[order[k].i] += 1;
    remainder -= 1;
  }
  return shares;
}

test("credits rejects anything that is not a whole number", () => {
  assert.throws(() => credits(1.5), /safe integer/);
  assert.throws(() => credits(NaN), /safe integer/);
  assert.equal(credits(-7), -7);
});

test("feeSplit never loses or invents a credit", () => {
  for (const amount of [1, 7, 99, 100, 12345, 999_999]) {
    for (const rate of [0, 1, 250, 500, 3333, 10_000]) {
      const { fee, net } = feeSplit(credits(amount), rate);
      assert.equal(add(fee, net), amount, `${amount}@${rate}`);
      assert.ok(fee >= 0 && net >= 0);
    }
  }
});

test("bps rejects rates outside 0..10000", () => {
  assert.throws(() => bps(credits(100), -1));
  assert.throws(() => bps(credits(100), 10_001));
});

test("weightedSplit preserves the pool and is deterministic across seeded curves", () => {
  const random = mulberry32(0xc0ffee);
  const cases: Array<{ amount: number; weights: number[] }> = [
    { amount: 0, weights: [1, 1, 1] },
    { amount: 1, weights: [1, 1, 1] },
    { amount: 1_000_001, weights: [50, 25, 15, 6, 4] },
    { amount: 1_000_000_007, weights: [13, 0, 89, 34, 55, 0, 21] },
    { amount: 500, weights: [7] },
    { amount: 500, weights: [0, 7, 0, 3] },
    { amount: 500, weights: [0, 0] },
    { amount: 500, weights: [1, 1, 1, 1] },
  ];

  for (let i = 0; i < 300; i++) {
    const weightCount = 1 + integerBelow(random, 9);
    const weights = Array.from({ length: weightCount }, () => integerBelow(random, 100));
    const amount = i % 17 === 0 ? 1_000_000_000 + integerBelow(random, 10_000) : integerBelow(random, 100_000);
    cases.push({ amount, weights });
  }

  for (const { amount, weights } of cases) {
    const first = weightedSplit(credits(amount), weights);
    const second = weightedSplit(credits(amount), weights);
    assert.deepEqual(second, first, `${amount}@${weights.join(",")}`);
    assert.equal(first.reduce((a, b) => add(a, b), credits(0)), amount, `${amount}@${weights.join(",")}`);
    assert.ok(first.every((share) => share >= 0), `${amount}@${weights.join(",")}`);
  }
});

test("weightedSplit assigns remainders by highest weight and then lowest index", () => {
  assert.deepEqual(weightedSplit(credits(100), [1, 1, 1]), [34, 33, 33]);
  // Floors 3,6,6,0 = 15; remainder 2 goes to the two weight-9 slots, lowest index first.
  assert.deepEqual(weightedSplit(credits(17), [5, 9, 9, 1]), [3, 7, 7, 0]);

  const cases = [
    { amount: 100, weights: [1, 1, 1] },
    { amount: 17, weights: [5, 9, 9, 1] },
    { amount: 23, weights: [0, 3, 0, 3, 7] },
    { amount: 1, weights: [0, 0, 4, 4] },
    { amount: 1_000_001, weights: [50, 25, 15, 6, 4] },
  ];

  for (const { amount, weights } of cases) {
    assert.deepEqual(weightedSplit(credits(amount), weights), expectedRemainderSplit(amount, weights));
  }

  assert.deepEqual(weightedSplit(credits(500), [0, 0]), expectedRemainderSplit(500, [0, 0]));
  assert.deepEqual(weightedSplit(credits(500), []), expectedRemainderSplit(500, []));
});

test("format and parse round-trip", () => {
  assert.equal(format(credits(123_45)), "123.45");
  assert.equal(format(credits(-5)), "-0.05");
  assert.equal(parse("250"), 25_000);
  assert.equal(parse("250.07"), 25_007);
  assert.throws(() => parse("250.071"), /decimal amount/);
});
