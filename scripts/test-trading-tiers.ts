import assert from "node:assert/strict";

import { mockPools } from "@/lib/mock/data";
import { simulateWalletPoolBridge } from "@/lib/protocol/tradeBridge";
import { quoteProfitDeduction, resolveTradingTier } from "@/lib/protocol/tradingTiers";

function main() {
  assert.equal(resolveTradingTier(9.99), null);
  assert.equal(resolveTradingTier(10)?.id, "TIER 1");
  assert.equal(resolveTradingTier(999.99)?.profitDeductionBps, 2_000);
  assert.equal(resolveTradingTier(1_000)?.id, "TIER 2");
  assert.equal(resolveTradingTier(9_999.99)?.profitDeductionBps, 1_200);
  assert.equal(resolveTradingTier(10_000)?.id, "TIER 3");

  assert.equal(quoteProfitDeduction({ investedCapitalUsd: 500, grossProfitUsd: 100 }).deductionUsd, 20);
  assert.equal(quoteProfitDeduction({ investedCapitalUsd: 2_000, grossProfitUsd: 100 }).deductionUsd, 12);
  assert.equal(quoteProfitDeduction({ investedCapitalUsd: 12_000, grossProfitUsd: 100 }).deductionUsd, 8.5);
  assert.equal(quoteProfitDeduction({ investedCapitalUsd: 12_000, grossProfitUsd: 0 }).deductionUsd, 0);
  assert.equal(quoteProfitDeduction({ investedCapitalUsd: 12_000, grossProfitUsd: -100 }).deductionUsd, 0);

  const bridge = simulateWalletPoolBridge({
    walletAddress: "FaUvNvb3nJ1mAHVWGp6wxApYVnc4AYgMT3muAL2xsLR8",
    walletBalanceSol: 4,
    walletTokenAccounts: 5,
    pool: mockPools[0],
    investedCapitalUsd: 10_000,
    simulatedGrossProfitUsd: 120,
  });

  assert.equal(bridge.tradingTier?.id, "TIER 3");
  assert.equal(bridge.profitDeductionUsd, 10.2);
  assert.equal(bridge.simulatedNetProfitUsd, 109.8);
  assert.equal(bridge.profitDeductionBps, 850);
  assert.equal(bridge.canPrepareTrade, true);

  console.log("[RangeGuard Tier Test] profit deduction tier checks passed");
}

main();
