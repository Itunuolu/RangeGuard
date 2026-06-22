import { previewAutonomyExecution, submitGuardedAutonomyAction } from "@/lib/autonomy/executor";
import { getBotControlPlane } from "@/lib/autonomy/runtime";
import { serverConfig } from "@/lib/config";

async function main() {
  const startedAt = new Date();
  const controlPlane = getBotControlPlane("worker-autonomy");

  console.log(`[RangeGuard Autonomy] run started at ${startedAt.toISOString()}`);
  console.log(
    `[RangeGuard Autonomy] mode=${controlPlane.protocolReadiness.canExecuteAutonomously ? "live-guarded" : "dry-run"} executionEnabled=${serverConfig.autonomyExecutionEnabled}`,
  );
  console.log(`[RangeGuard Autonomy] scanned=${controlPlane.runs[0]?.positionsScanned ?? 0} planned=${controlPlane.actions.length}`);

  for (const action of controlPlane.actions) {
    const preview = previewAutonomyExecution(controlPlane.policy, action);
    console.log(
      [
        `[RangeGuard Autonomy] ${action.id}`,
        `type=${action.type}`,
        `status=${action.status}`,
        `execution=${preview.status}`,
        `notional=${action.notionalUsd}`,
      ].join(" "),
    );

    if (!preview.canSubmit) {
      console.log(`[RangeGuard Autonomy] blocked: ${preview.reasons.join(" | ")}`);
    } else {
      const result = await submitGuardedAutonomyAction(controlPlane.policy, action);
      console.log(
        `[RangeGuard Autonomy] guarded submit status=${result.status} submitted=${result.submitted} reason=${result.reasons.join(" | ")}`,
      );
    }
  }

  console.log(`[RangeGuard Autonomy] run finished at ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error("[RangeGuard Autonomy] run failed");
  console.error(error);
  process.exitCode = 1;
});
