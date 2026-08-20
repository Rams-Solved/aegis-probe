import { test } from "node:test";
import assert from "node:assert/strict";
import { allAttacks, attacksByCategory } from "./index.js";

test("every attack has a unique id", () => {
  const ids = allAttacks.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate attack ids found: ${ids.join(", ")}`);
});

test("every attack has at least one turn", () => {
  for (const attack of allAttacks) {
    assert.ok(attack.turns.length > 0, `${attack.id} has no turns`);
    for (const turn of attack.turns) {
      assert.ok(turn.trim().length > 0, `${attack.id} has an empty turn`);
    }
  }
});

test("attacksByCategory contains exactly the attacks whose category field matches", () => {
  for (const [category, attacks] of Object.entries(attacksByCategory)) {
    for (const attack of attacks) {
      assert.equal(attack.category, category);
    }
  }
});

test("allAttacks is the union of every category bucket", () => {
  const fromCategories = Object.values(attacksByCategory).flat();
  assert.equal(allAttacks.length, fromCategories.length);
  const allIds = new Set(allAttacks.map((a) => a.id));
  for (const attack of fromCategories) {
    assert.ok(allIds.has(attack.id));
  }
});

test("multi-turn attacks category actually has multiple turns", () => {
  for (const attack of attacksByCategory["multi-turn"]) {
    assert.ok(attack.turns.length >= 2, `${attack.id} is in multi-turn but only has ${attack.turns.length} turn(s)`);
  }
});
