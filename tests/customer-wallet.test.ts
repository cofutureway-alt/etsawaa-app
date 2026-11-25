import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateWallet,
  nearestExpiry,
  walletAvailable,
  walletCap,
  walletCoversAll,
  walletRemainder,
  type WalletGiftLot,
} from "../app/features/wallet/split.ts";

/**
 * Checkout wallet split (phase A). The database stays the authority
 * (fn_wallet_spend caps and locks); these checks pin the preview math the
 * customer sees, including the gift-first, earliest-expiry-first order.
 */

const NOW = Date.parse("2026-11-25T12:00:00Z");
const lot = (id: string, remaining: number, expires: string): WalletGiftLot => ({
  id, remaining_piastres: remaining, expires_at: expires,
});

test("available = refund + gift, negatives and junk ignored", () => {
  assert.equal(walletAvailable({ refund_piastres: 1500, gift_piastres: 500 }), 2000);
  assert.equal(walletAvailable(null), 0);
  assert.equal(walletAvailable({ refund_piastres: -100, gift_piastres: 250 }), 250);
  assert.equal(walletAvailable({ refund_piastres: Number.NaN, gift_piastres: 100 }), 100);
  assert.equal(walletAvailable({ refund_piastres: 10.7, gift_piastres: 0 }), 10);
});

test("the request is capped by the balance and by the order total", () => {
  assert.equal(walletCap(5000, 3000, 100000), 3000, "balance caps it");
  assert.equal(walletCap(5000, 30000, 4000), 4000, "order total caps it");
  assert.equal(walletCap(2000, 3000, 100000), 2000, "a smaller request stands");
  assert.equal(walletCap(0, 3000, 100000), 0, "zero spends nothing");
  assert.equal(walletCap(-500, 3000, 100000), 0, "negative spends nothing");
  assert.equal(walletCap(500, 3000, 0), 0, "an empty order spends nothing");
  assert.equal(walletCap(500, 0, 100000), 0, "an empty balance spends nothing");
});

test("remainder is what is left to pay, never negative", () => {
  assert.equal(walletRemainder(10000, 2500), 7500);
  assert.equal(walletRemainder(10000, 10000), 0);
  assert.equal(walletRemainder(10000, 12000), 0);
  assert.equal(walletRemainder(0, 0), 0);
});

test("coversAll only when the wallet really pays the whole order", () => {
  assert.equal(walletCoversAll(10000, 10000), true);
  assert.equal(walletCoversAll(10000, 12000), true);
  assert.equal(walletCoversAll(10000, 9999), false);
  assert.equal(walletCoversAll(0, 0), false, "an empty order is not a wallet payment");
});

test("gift lots are spent first, earliest expiry first, then refund", () => {
  const lots = [
    lot("late", 2000, "2027-02-01T00:00:00Z"),
    lot("early", 1000, "2026-12-01T00:00:00Z"),
    lot("used-up", 0, "2026-11-26T00:00:00Z"),
    lot("expired", 5000, "2026-11-01T00:00:00Z"),
  ];
  const a = allocateWallet(2500, lots, 10000, NOW);
  assert.deepEqual(a.lots, [
    { id: "early", amount_piastres: 1000 },
    { id: "late", amount_piastres: 1500 },
  ]);
  assert.equal(a.gift_piastres, 2500);
  assert.equal(a.refund_piastres, 0, "refund stays untouched while gifts can pay");
});

test("an expired lot is skipped and its money never counts", () => {
  const lots = [lot("expired", 5000, "2026-11-01T00:00:00Z"), lot("soon", 500, "2026-12-01T00:00:00Z")];
  const a = allocateWallet(2000, lots, 1000, NOW);
  assert.deepEqual(a.lots, [{ id: "soon", amount_piastres: 500 }]);
  assert.equal(a.gift_piastres, 500);
  assert.equal(a.refund_piastres, 1000, "the rest comes from the refund bucket");
});

test("refund bucket alone when there are no live lots", () => {
  const a = allocateWallet(3000, [], 5000, NOW);
  assert.deepEqual(a.lots, []);
  assert.equal(a.gift_piastres, 0);
  assert.equal(a.refund_piastres, 3000);
});

test("a zero or negative amount allocates nothing", () => {
  assert.deepEqual(allocateWallet(0, [lot("x", 1000, "2027-01-01T00:00:00Z")], 5000, NOW).lots, []);
  assert.equal(allocateWallet(-10, [], 5000, NOW).refund_piastres, 0);
});

test("the nearest active expiry ignores dead lots", () => {
  const lots = [
    lot("expired", 500, "2026-11-01T00:00:00Z"),
    lot("empty", 0, "2026-11-26T00:00:00Z"),
    lot("second", 100, "2027-03-01T00:00:00Z"),
    lot("first", 100, "2027-01-01T00:00:00Z"),
  ];
  assert.equal(nearestExpiry(lots, NOW), "2027-01-01T00:00:00Z");
  assert.equal(nearestExpiry([lot("expired", 500, "2026-11-01T00:00:00Z")], NOW), null);
  assert.equal(nearestExpiry([], NOW), null);
});
