import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";
import { serverConfig } from "@/lib/config";
import { evaluatePositionHealth } from "@/lib/risk/positionHealth";

async function main() {
  const startedAt = new Date();
  const adapter = getMeteoraDlmmAdapter();
  const positions = await adapter.getUserPositions("worker-scan");

  console.log(`[RangeGuard] scan started at ${startedAt.toISOString()}`);
  console.log(`[RangeGuard] mode=${serverConfig.mockMode ? "mock" : "live-read"} positions=${positions.length}`);

  for (const position of positions) {
    const health = evaluatePositionHealth({
      lowerBin: position.lowerBin,
      upperBin: position.upperBin,
      currentActiveBin: position.currentActiveBin,
      feesEarnedUsd: position.feesEarnedUsd,
      currentValueUsd: position.currentValueUsd,
      estimatedPnlPct: position.estimatedPnlPct,
    });

    console.log(
      [
        `[RangeGuard] ${position.id}`,
        `${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`,
        `status="${health.status}"`,
        `score=${health.score}`,
        `suggested="${health.suggestedAction}"`,
        `reason="${health.reason}"`,
      ].join(" "),
    );

    if (health.suggestedAction !== "Hold") {
      console.log(
        `[RangeGuard] suggested action created for manual review only; no transaction was executed for ${position.id}`,
      );
    }
  }

  console.log(`[RangeGuard] scan finished at ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error("[RangeGuard] scan failed");
  console.error(error);
  process.exitCode = 1;
});
