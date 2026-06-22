import { Connection, PublicKey } from "@solana/web3.js";

import { previewAutonomyExecution } from "@/lib/autonomy/executor";
import { getBotControlPlane } from "@/lib/autonomy/runtime";
import { serverConfig } from "@/lib/config";

type Check = {
  label: string;
  passed: boolean;
  detail: string;
};

function publicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function record(checks: Check[], label: string, passed: boolean, detail: string) {
  checks.push({ label, passed, detail });
}

async function checkKeeperHealth(url: string) {
  const healthUrl = new URL(url);
  healthUrl.searchParams.set("health", "1");

  const response = await fetch(healthUrl, {
    method: "GET",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; detail?: string } | null;

  return {
    ok: response.ok && body?.ok === true,
    detail: body?.detail ? `HTTP ${response.status}: ${body.detail}` : `HTTP ${response.status}`,
  };
}

async function main() {
  const checks: Check[] = [];
  const guardProgramId = publicKey(serverConfig.autonomyGuardProgramId);
  const policyAddress = publicKey(serverConfig.autonomyPolicyAddress);
  const keeperAuthority = publicKey(serverConfig.autonomyKeeperAuthority);
  const riskAuthority = publicKey(serverConfig.autonomyRiskAuthority);
  const allowedProgramIds = serverConfig.autonomyAllowedProgramIds.map(publicKey);

  record(checks, "MOCK_MODE disabled", !serverConfig.mockMode, `MOCK_MODE=${serverConfig.mockMode}`);
  record(
    checks,
    "Autonomy enabled",
    serverConfig.autonomyExecutionEnabled,
    `AUTONOMY_EXECUTION_ENABLED=${serverConfig.autonomyExecutionEnabled}`,
  );
  record(checks, "Guard program id valid", Boolean(guardProgramId), serverConfig.autonomyGuardProgramId || "missing");
  record(checks, "Policy account valid", Boolean(policyAddress), serverConfig.autonomyPolicyAddress || "missing");
  record(checks, "Keeper authority valid", Boolean(keeperAuthority), serverConfig.autonomyKeeperAuthority || "missing");
  record(checks, "Risk authority valid", Boolean(riskAuthority), serverConfig.autonomyRiskAuthority || "missing");
  record(
    checks,
    "Risk authority independent",
    Boolean(keeperAuthority && riskAuthority && !keeperAuthority.equals(riskAuthority)),
    "Risk signer must be separate from keeper delegate.",
  );
  record(
    checks,
    "Allowed target programs valid",
    allowedProgramIds.length > 0 && allowedProgramIds.every(Boolean),
    serverConfig.autonomyAllowedProgramIds.join(", ") || "missing",
  );

  if (guardProgramId && policyAddress) {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const [guardAccount, policyAccount] = await Promise.all([
      connection.getAccountInfo(guardProgramId),
      connection.getAccountInfo(policyAddress),
    ]);

    record(checks, "Guard program deployed", Boolean(guardAccount?.executable), guardAccount ? "account found" : "missing");
    record(
      checks,
      "Policy owned by guard program",
      Boolean(policyAccount && policyAccount.owner.equals(guardProgramId)),
      policyAccount ? `owner=${policyAccount.owner.toBase58()}` : "missing",
    );
  }

  if (serverConfig.autonomyKeeperSignerUrl) {
    try {
      const keeper = await checkKeeperHealth(serverConfig.autonomyKeeperSignerUrl);
      record(checks, "Keeper signer reachable", keeper.ok, keeper.detail);
    } catch (error) {
      record(
        checks,
        "Keeper signer reachable",
        false,
        error instanceof Error ? error.message : "keeper health request failed",
      );
    }
  } else {
    record(checks, "Keeper signer reachable", false, "AUTONOMY_KEEPER_SIGNER_URL missing");
  }

  const controlPlane = getBotControlPlane("release-check-wallet");
  record(
    checks,
    "Control plane ready",
    controlPlane.protocolReadiness.canExecuteAutonomously,
    controlPlane.protocolReadiness.blockers.join(" | ") || "ready",
  );

  const previews = controlPlane.actions.map((action) => previewAutonomyExecution(controlPlane.policy, action));
  record(
    checks,
    "All planned actions ready",
    previews.length > 0 && previews.every((preview) => preview.canSubmit),
    previews.map((preview) => `${preview.actionId}:${preview.status}`).join(", ") || "no actions planned",
  );

  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    console.error(`[RangeGuard Release Check] blocked by ${failed.length} failed check(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("[RangeGuard Release Check] live guarded autonomy prerequisites passed.");
}

main().catch((error) => {
  console.error("[RangeGuard Release Check] failed");
  console.error(error);
  process.exitCode = 1;
});
