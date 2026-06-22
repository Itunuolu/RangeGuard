import assert from "node:assert/strict";

process.env.MOCK_MODE = "false";
process.env.NEXT_PUBLIC_MOCK_MODE = "false";
process.env.AUTONOMY_EXECUTION_ENABLED = "true";
process.env.AUTONOMY_GUARD_PROGRAM_ID = "GTEGpV9Gr9uMr4CvkKHQUskrVJ8cZQRD7ewPcoRrrVps";
process.env.AUTONOMY_POLICY_ADDRESS = "Cdq6fQixg6i1i8gh2Uk7mwbKo3UWEd96pfSD5FcS4rxy";
process.env.AUTONOMY_KEEPER_AUTHORITY = "FaUvNvb3nJ1mAHVWGp6wxApYVnc4AYgMT3muAL2xsLR8";
process.env.AUTONOMY_RISK_AUTHORITY = "CPLDQKWk8jad5sg4v5t9ovs4V5kME3CMcUtKChtJFzLS";
process.env.AUTONOMY_KEEPER_SIGNER_URL = "http://127.0.0.1:9/rangeguard";
process.env.AUTONOMY_ALLOWED_PROGRAM_IDS =
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo,JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

async function main() {
  const { previewAutonomyExecution } = await import("@/lib/autonomy/executor");
  const { canKeeperSignTargetInstructions, digestTargetInstructions } = await import(
    "@/lib/autonomy/meteoraTransactionBuilder"
  );
  const { getBotControlPlane } = await import("@/lib/autonomy/runtime");

  const controlPlane = getBotControlPlane("autonomy-test-wallet");
  const delegatedAuthority = controlPlane.policy.delegatedAuthority;

  assert.equal(controlPlane.protocolReadiness.canExecuteAutonomously, true);
  assert.equal(controlPlane.policy.executionMode, "DelegatedGuarded");
  assert.equal(controlPlane.policy.requireWalletConfirm, false);
  assert.notEqual(controlPlane.policy.delegatedAuthority, controlPlane.policy.riskAuthority);
  assert.ok(controlPlane.actions.length > 0);

  for (const action of controlPlane.actions) {
    assert.equal(action.status, "Queued");
    assert.equal(action.executionStatus, "Ready");
    assert.ok(action.transactionPlan.actionHash);
    assert.ok(action.transactionPlan.guardInstructionBase64);
    assert.equal(action.transactionPlan.guardAccounts?.length, 4);
    assert.equal(action.transactionPlan.guardAccounts?.[1]?.isSigner, true);
    assert.equal(action.transactionPlan.guardAccounts?.[2]?.isSigner, true);
    assert.equal(action.transactionPlan.guardAccounts?.[3]?.pubkey, "Sysvar1nstructions1111111111111111111111111");

    const preview = previewAutonomyExecution(controlPlane.policy, action);
    assert.equal(preview.canSubmit, true);
    assert.equal(preview.status, "Ready");
  }

  const action = controlPlane.actions[0];
  assert.ok(action);

  const oversizedAction = {
    ...action,
    guardrailResults: action.guardrailResults.map((result) =>
      result.id === "position-size" ? { ...result, passed: false, detail: "Test cap failure." } : result,
    ),
  };
  const oversizedPreview = previewAutonomyExecution(controlPlane.policy, oversizedAction);
  assert.equal(oversizedPreview.canSubmit, false);
  assert.equal(oversizedPreview.status, "Blocked");

  const disallowedTargetAction = {
    ...action,
    transactionPlan: {
      ...action.transactionPlan,
      targetProgramIds: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
      allowedProgramIds: ["LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"],
    },
  };
  const disallowedPreview = previewAutonomyExecution(controlPlane.policy, disallowedTargetAction);
  assert.equal(disallowedPreview.canSubmit, false);
  assert.equal(disallowedPreview.status, "Blocked");

  assert.ok(delegatedAuthority);
  assert.equal(canKeeperSignTargetInstructions([delegatedAuthority], delegatedAuthority), true);
  assert.equal(canKeeperSignTargetInstructions([controlPlane.policy.riskAuthority || ""], delegatedAuthority), false);

  const targetInstructions = [
    {
      programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
      keys: [{ pubkey: delegatedAuthority, isSigner: true, isWritable: false }],
      dataBase64: "AA==",
    },
  ];
  assert.equal(digestTargetInstructions(targetInstructions), digestTargetInstructions(targetInstructions));

  console.log("[RangeGuard Autonomy Test] safety gates passed");
}

main().catch((error) => {
  console.error("[RangeGuard Autonomy Test] failed");
  console.error(error);
  process.exitCode = 1;
});
