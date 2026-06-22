"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  HandCoins,
  History,
  KeyRound,
  PauseCircle,
  Radar,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  XCircle,
} from "lucide-react";

import { ActionPreviewDialog } from "@/components/app/action-preview-dialog";
import { HealthBadge } from "@/components/app/health-badge";
import { PageHeader } from "@/components/app/page-header";
import { TokenPair } from "@/components/app/token-pair";
import { WalletConnectPrompt } from "@/components/app/wallet-connect-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useBotControlPlane } from "@/hooks/use-rangeguard-data";
import { executeBotAction, retryRecoveryAddLiquidity, withdrawRecoveryToOwner } from "@/lib/api/client";
import type { BotAction, GuardrailResult, KeeperExecutionReceipt } from "@/lib/types";
import { formatPercent, formatUsd, shortenAddress } from "@/lib/utils/format";

function BotMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-[#667085]">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-[#101828]">{value}</p>
          <p className="mt-2 text-xs text-[#667085]">{detail}</p>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#eef8f8] text-[#006d77]">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function GuardrailList({ results }: { results: GuardrailResult[] }) {
  return (
    <div className="space-y-2">
      {results.map((result) => (
        <div key={result.id} className="flex gap-2 rounded-md border border-[#e4eaf1] bg-white p-3 text-sm">
          {result.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#067647]" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b42318]" />
          )}
          <div>
            <p className="font-semibold text-[#101828]">{result.label}</p>
            <p className="mt-1 leading-5 text-[#667085]">{result.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function actionPreview(action: BotAction) {
  return [
    { label: "Action", value: action.type },
    { label: "Status", value: action.status },
    { label: "Notional", value: formatUsd(action.notionalUsd) },
    { label: "Gross profit", value: formatUsd(action.simulatedGrossProfitUsd || 0) },
    { label: "Estimated fee", value: `${action.estimatedFeeUsd} SOL` },
    { label: "Estimated slippage", value: `${action.estimatedSlippageBps} bps` },
    {
      label: "Proposed range",
      value:
        action.proposedLowerBin && action.proposedUpperBin
          ? `${action.proposedLowerBin} - ${action.proposedUpperBin}`
          : "No bin change",
    },
    { label: "Execution", value: action.executionStatus },
    {
      label: "Policy account",
      value: action.transactionPlan.onChainPolicyAddress
        ? shortenAddress(action.transactionPlan.onChainPolicyAddress, 6)
        : "Not configured",
    },
    {
      label: "Action hash",
      value: action.transactionPlan.actionHash ? `${action.transactionPlan.actionHash.slice(0, 12)}...` : "Missing",
    },
    {
      label: "Guard instruction",
      value: action.transactionPlan.guardInstructionBase64 ? "Built" : "Missing",
    },
    {
      label: "Target programs",
      value:
        action.transactionPlan.targetProgramIds?.map((programId) => shortenAddress(programId, 4)).join(", ") || "None",
    },
  ];
}

function phaseSignature(receipt: KeeperExecutionReceipt, phaseId: string) {
  return receipt.phaseResults?.find((phase) => phase.phaseId === phaseId)?.signature || null;
}

function phaseSubmitted(receipt: KeeperExecutionReceipt, phaseId: string) {
  return Boolean(
    receipt.phaseResults?.some((phase) => phase.phaseId === phaseId && phase.status === "Submitted" && phase.signature),
  );
}

function receiptNeedsRecovery(receipt: KeeperExecutionReceipt) {
  if (receipt.recoveryResolution || receipt.recovery?.state === "Resolved") return false;
  if (receipt.status === "RecoveryRequired") return true;

  return (
    phaseSubmitted(receipt, "remove-old-position") &&
    !phaseSubmitted(receipt, "add-new-position") &&
    !phaseSubmitted(receipt, "retry-add-liquidity")
  );
}

function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function receiptStatusVariant(status: string) {
  if (status === "Executed" || status === "Recovered") return "low";
  if (status === "RecoveryRequired") return "avoid";
  if (status === "PostflightFailed") return "medium";
  return "avoid";
}

function recoveryKey(receipt: KeeperExecutionReceipt, mode: "RetryAddLiquidity" | "WithdrawToOwner") {
  return `${mode}-${receipt.actionId || "receipt"}-${receipt.startedAt}`;
}

function recoveryTokenTransfers(receipt: KeeperExecutionReceipt) {
  const recoveryTransfers = receipt.recovery?.withdrawToOwner?.tokenTransfers || [];
  const transfers = recoveryTransfers.length > 0 ? recoveryTransfers : receipt.tokenMetadata?.transfers || [];

  return transfers.map((transfer) => ({
    mint: transfer.mint,
    amount: transfer.amount,
    tokenProgramId: transfer.tokenProgramId ?? null,
  }));
}

function recoveryPreview(
  receipt: KeeperExecutionReceipt,
  mode: "RetryAddLiquidity" | "WithdrawToOwner",
  ownerAddress?: string,
) {
  const transfers = recoveryTokenTransfers(receipt);
  const lowerBin = receipt.expectedNewLowerBin ?? receipt.proposedLowerBin ?? "?";
  const upperBin = receipt.expectedNewUpperBin ?? receipt.proposedUpperBin ?? "?";

  return [
    { label: "Receipt", value: receipt.actionId || "Unlabeled receipt" },
    { label: "Mode", value: mode === "RetryAddLiquidity" ? "Retry add-liquidity" : "Withdraw to owner" },
    { label: "Pool", value: receipt.poolAddress ? shortenAddress(receipt.poolAddress, 6) : "Unknown" },
    { label: "Original range", value: `${lowerBin} - ${upperBin}` },
    {
      label: "Phase 1",
      value: phaseSignature(receipt, "remove-old-position")
        ? shortenAddress(phaseSignature(receipt, "remove-old-position") || "", 6)
        : "Missing",
    },
    {
      label: "Phase 2",
      value: phaseSignature(receipt, "add-new-position") ? "Already submitted" : "Not submitted",
    },
    {
      label: mode === "RetryAddLiquidity" ? "New signer" : "Owner wallet",
      value: mode === "RetryAddLiquidity"
        ? "Fresh keeper-generated signer"
        : ownerAddress
          ? shortenAddress(ownerAddress, 6)
          : "Connect wallet",
    },
    {
      label: "Token transfers",
      value:
        mode === "WithdrawToOwner"
          ? transfers.length > 0
            ? `${transfers.length} transfer(s)`
            : "Missing token details"
          : "Not required",
    },
  ];
}

export default function BotPage() {
  const [tab, setTab] = useState<"guard" | "copy">("guard");
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [submittingRecoveryKey, setSubmittingRecoveryKey] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const queryClient = useQueryClient();
  const { data, isLoading } = useBotControlPlane(walletAddress);
  const policy = data?.policy;
  const readiness = data?.protocolReadiness;

  async function refreshRecoveryViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bot-control-plane", walletAddress] }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
      queryClient.invalidateQueries({ queryKey: ["positions", walletAddress] }),
    ]);
  }

  async function handleGuardedExecute(actionId: string) {
    setSubmittingActionId(actionId);
    setExecutionResult(null);

    try {
      const response = await executeBotAction(actionId, walletAddress);
      setExecutionResult(
        response.result.submitted
          ? `Submitted ${response.result.actionId} to the remote keeper signer.`
          : response.result.status === "AcceptedDryRun" || response.result.status === "Simulated"
            ? `${response.result.status}: keeper verified ${response.result.actionId}. No transaction was broadcast.`
          : `${response.result.status}: ${response.result.reasons.join(" ")}`,
      );
    } catch (error) {
      setExecutionResult(error instanceof Error ? error.message : "Guarded execution request failed.");
    } finally {
      void refreshRecoveryViews();
      setSubmittingActionId(null);
    }
  }

  async function handleRecoveryRequest(mode: "RetryAddLiquidity" | "WithdrawToOwner", receipt: KeeperExecutionReceipt) {
    const key = recoveryKey(receipt, mode);

    setSubmittingRecoveryKey(key);
    setExecutionResult(null);

    try {
      const response =
        mode === "RetryAddLiquidity"
          ? await retryRecoveryAddLiquidity(receipt, walletAddress)
          : await withdrawRecoveryToOwner(receipt, {
              walletAddress,
              ownerAddress: walletAddress,
              tokenTransfers: recoveryTokenTransfers(receipt),
            });
      const result = response.result;
      const prefix = result.submitted
        ? `${mode} submitted`
        : result.status === "Simulated" || result.status.endsWith("Simulated")
          ? `${mode} simulated`
          : `${mode} ${result.status}`;

      setExecutionResult(`${prefix}: ${result.reasons.join(" ")}`);
    } catch (error) {
      setExecutionResult(error instanceof Error ? error.message : "Recovery request failed.");
    } finally {
      void refreshRecoveryViews();
      setSubmittingRecoveryKey(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Autonomy Protocol"
        title="Guard Bot"
        description="A protocol-grade LP automation control plane: policy, simulation, guardrails, delegated authority readiness, and auditable action planning."
      />

      {!connected ? <WalletConnectPrompt /> : null}

      {isLoading || !data || !policy || !readiness ? (
        <Card>
          <CardContent className="p-6">Loading autonomy control plane...</CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-6">
          <div className="flex w-full flex-col gap-2 rounded-lg border border-[#d9e1ec] bg-white p-2 sm:w-fit sm:flex-row">
            <Button
              variant={tab === "guard" ? "subtle" : "ghost"}
              className="justify-start"
              onClick={() => setTab("guard")}
            >
              <Bot className="h-4 w-4" />
              Autonomy Bot
            </Button>
            <Button
              variant={tab === "copy" ? "subtle" : "ghost"}
              className="justify-start"
              onClick={() => setTab("copy")}
            >
              <Copy className="h-4 w-4" />
              Copy LPing
            </Button>
          </div>

          {tab === "guard" ? (
            <div className="grid gap-6">
              <Card className="overflow-hidden">
                <CardContent className="grid gap-6 p-5 xl:grid-cols-[1fr_380px] xl:items-center">
                  <div>
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <Badge variant={policy.status === "Armed" ? "low" : "medium"}>{policy.status}</Badge>
                      <Badge variant="outline">{policy.executionMode}</Badge>
                      <Badge variant={readiness.canExecuteAutonomously ? "low" : "avoid"}>
                        {readiness.canExecuteAutonomously ? "Live guarded ready" : "Execution gated"}
                      </Badge>
                    </div>
                    <h2 className="text-2xl font-semibold text-[#101828]">Autonomy treated as protocol policy.</h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-[#667085]">
                      The bot can plan true autonomous LP actions only when policy guardrails pass, a guard program is
                      configured, a keeper authority is delegated, and the execution mode permits delegated guarded
                      submission. Until then, it runs as dry-run simulation and wallet-confirmed previews.
                    </p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4">
                        <p className="text-xs text-[#667085]">Guard program</p>
                        <p className="mt-1 font-semibold text-[#101828]">
                          {policy.guardProgramId ? shortenAddress(policy.guardProgramId, 6) : "Not configured"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4">
                        <p className="text-xs text-[#667085]">Delegated authority</p>
                        <p className="mt-1 font-semibold text-[#101828]">
                          {policy.delegatedAuthority ? shortenAddress(policy.delegatedAuthority, 6) : "Missing"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4">
                        <p className="text-xs text-[#667085]">Policy account</p>
                        <p className="mt-1 font-semibold text-[#101828]">
                          {policy.onChainPolicyAddress ? shortenAddress(policy.onChainPolicyAddress, 6) : "Missing"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4">
                        <p className="text-xs text-[#667085]">Risk authority</p>
                        <p className="mt-1 font-semibold text-[#101828]">
                          {policy.riskAuthority ? shortenAddress(policy.riskAuthority, 6) : "Missing"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4">
                        <p className="text-xs text-[#667085]">Run mode</p>
                        <p className="mt-1 font-semibold text-[#101828]">{data.runs[0]?.mode || "DryRun"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#101828]">{policy.name}</p>
                        <p className="mt-1 text-xs text-[#667085]">Protocol feature, not a dashboard toggle</p>
                      </div>
                      <Switch checked={policy.status === "Armed"} disabled aria-label="Autonomy protocol status" />
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[#667085]">Open</p>
                        <p className="mt-1 text-xl font-semibold">{data.stats.openPositions}</p>
                        <p className="text-xs text-[#667085]">watched positions</p>
                      </div>
                      <div>
                        <p className="text-[#667085]">Planned</p>
                        <p className="mt-1 text-xl font-semibold">{data.stats.plannedActions}</p>
                        <p className="text-xs text-[#667085]">actions this run</p>
                      </div>
                      <div>
                        <p className="text-[#667085]">Blocked</p>
                        <p className="mt-1 text-xl font-semibold">{data.stats.blockedActions}</p>
                        <p className="text-xs text-[#667085]">failed guardrails</p>
                      </div>
                      <div>
                        <p className="text-[#667085]">Realized</p>
                        <p className="mt-1 text-xl font-semibold">{formatUsd(data.stats.realizedPnlUsd)}</p>
                        <p className="text-xs text-[#667085]">PnL estimate</p>
                      </div>
                    </div>
                    <div className="mt-5 rounded-lg border border-[#fde9a2] bg-[#fff9e8] p-3">
                      <p className="text-sm font-semibold text-[#7a4e00]">Daily autonomy limit</p>
                      <p className="mt-1 text-sm text-[#7a4e00]">
                        {formatUsd(data.stats.dailyLimitUsedUsd)} / {formatUsd(data.stats.dailyLimitUsd)} planned notional
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <BotMetric label="Execution readiness" value={readiness.canExecuteAutonomously ? "Ready" : "Gated"} detail="Guard + keeper + policy checks" icon={KeyRound} />
                <BotMetric label="Actions planned" value={String(data.stats.plannedActions)} detail="Generated by policy engine" icon={SlidersHorizontal} />
                <BotMetric label="Run scanned" value={String(data.runs[0]?.positionsScanned || 0)} detail="Open LP positions checked" icon={Radar} />
                <BotMetric label="Fees ready" value={formatUsd(86.4)} detail="Claim preview available" icon={HandCoins} />
              </div>

              {!readiness.canExecuteAutonomously ? (
                <Card className="border-[#fde9a2] bg-[#fff9e8]">
                  <CardContent className="flex gap-4 p-5 text-[#7a4e00]">
                    <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
                    <div>
                      <h3 className="font-semibold">True autonomy is intentionally blocked.</h3>
                      <p className="mt-2 text-sm leading-6">
                        The bot has protocol execution code paths, but live submission requires every prerequisite below.
                      </p>
                      <ul className="mt-3 list-inside list-disc space-y-1 text-sm">
                        {readiness.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {executionResult ? (
                <Card className="border-[#bfe4e2] bg-[#f5fbfb]">
                  <CardContent className="flex gap-3 p-4 text-sm leading-6 text-[#074f57]">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{executionResult}</p>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>Executed keeper rebalances</CardTitle>
                      <p className="mt-2 text-sm leading-6 text-[#667085]">
                        Live devnet receipts from the keeper signer, including both phase signatures and postflight checks.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={data.receiptPersistence.databaseConfigured ? "low" : "medium"}>
                        <Database className="mr-1 h-3.5 w-3.5" />
                        {data.receiptPersistence.databaseConfigured ? "Prisma sync on" : "Receipt file only"}
                      </Badge>
                      <Badge variant="outline">{data.receiptPersistence.receiptsFound} receipt(s)</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.executionReceipts.length === 0 ? (
                    <div className="flex gap-3 rounded-lg border border-[#e4eaf1] bg-[#f8fafc] p-4 text-sm leading-6 text-[#667085]">
                      <History className="mt-0.5 h-4 w-4 shrink-0 text-[#006d77]" />
                      <p>No keeper live rebalance receipts have been recorded yet.</p>
                    </div>
                  ) : (
                    data.executionReceipts.map((receipt) => {
                      const removeSignature = phaseSignature(receipt, "remove-old-position");
                      const addSignature =
                        phaseSignature(receipt, "add-new-position") || phaseSignature(receipt, "retry-add-liquidity");
                      const needsRecovery = receiptNeedsRecovery(receipt);
                      const displayedStatus = needsRecovery ? "RecoveryRequired" : receipt.status;
                      const ownerAddress = publicKey?.toBase58();
                      const withdrawTransfers = recoveryTokenTransfers(receipt);
                      const retryKey = recoveryKey(receipt, "RetryAddLiquidity");
                      const withdrawKey = recoveryKey(receipt, "WithdrawToOwner");

                      return (
                        <div
                          key={`${receipt.actionId}-${receipt.completedAt || receipt.startedAt}`}
                          className="grid gap-4 rounded-lg border border-[#e4eaf1] p-4 xl:grid-cols-[1.15fr_1fr_1fr]"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={receiptStatusVariant(displayedStatus)}>{displayedStatus}</Badge>
                              <Badge variant="outline">{receipt.requestType}</Badge>
                            </div>
                            <p className="mt-3 font-semibold text-[#101828]">
                              {receipt.actionId || "Keeper rebalance"}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[#667085]">
                              {receipt.poolAddress ? shortenAddress(receipt.poolAddress, 6) : "Unknown pool"} -
                              {receipt.completedAt
                                ? ` completed ${new Date(receipt.completedAt).toLocaleString()}`
                                : " pending completion time"}
                            </p>
                          </div>

                          <div className="grid gap-2 text-sm">
                            <div className="rounded-md border border-[#e4eaf1] p-3">
                              <p className="text-xs text-[#667085]">Old position</p>
                              <p className="mt-1 font-semibold text-[#101828]">
                                {receipt.oldPositionAddress ? shortenAddress(receipt.oldPositionAddress, 6) : "Missing"}
                              </p>
                            </div>
                            <div className="rounded-md border border-[#e4eaf1] p-3">
                              <p className="text-xs text-[#667085]">New position</p>
                              <p className="mt-1 font-semibold text-[#101828]">
                                {receipt.newPositionAddress ? shortenAddress(receipt.newPositionAddress, 6) : "Not opened"}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="rounded-md border border-[#e4eaf1] p-3">
                              <p className="text-xs text-[#667085]">Verified range</p>
                              <p className="mt-1 font-semibold text-[#101828]">
                                {receipt.postflight
                                  ? `${receipt.postflight.lowerBin} - ${receipt.postflight.upperBin}`
                                  : `${receipt.expectedNewLowerBin ?? "?"} - ${receipt.expectedNewUpperBin ?? "?"}`}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {removeSignature ? (
                                <a
                                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c7d2df] px-3 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
                                  href={explorerTx(removeSignature)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Phase 1
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                              {addSignature ? (
                                <a
                                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c7d2df] px-3 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
                                  href={explorerTx(addSignature)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Phase 2
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                          {needsRecovery ? (
                            <div className="xl:col-span-3 rounded-lg border border-[#fecdca] bg-[#fff6f5] p-4 text-sm leading-6 text-[#912018]">
                              <div className="flex gap-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                <div>
                                  <p className="font-semibold">Recovery required</p>
                                  <p className="mt-1">
                                    Phase 1 was submitted, but the add-liquidity phase did not complete. The safe paths
                                    are retry add-liquidity with a fresh position signer or withdraw keeper-held token
                                    balances back to the owner wallet.
                                  </p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <ActionPreviewDialog
                                      action={
                                        submittingRecoveryKey === retryKey
                                          ? "Submitting..."
                                          : "Submit retry"
                                      }
                                      title="Retry Add Liquidity"
                                      description="This asks the devnet keeper to reuse the original range and generate a fresh new-position signer."
                                      disabled={
                                        !readiness.canExecuteAutonomously ||
                                        submittingRecoveryKey === retryKey
                                      }
                                      disabledLabel={
                                        !readiness.canExecuteAutonomously ? "Execution gated" : "Submitting..."
                                      }
                                      safetyNote="Retry is devnet-only and still routed through the on-chain guard policy. It only attempts the missing add-liquidity leg."
                                      onPrimaryAction={() => void handleRecoveryRequest("RetryAddLiquidity", receipt)}
                                      preview={recoveryPreview(receipt, "RetryAddLiquidity", ownerAddress)}
                                      trigger={
                                        <Button variant="secondary" size="sm">
                                          <RotateCcw className="h-3.5 w-3.5" />
                                          Retry add-liquidity
                                        </Button>
                                      }
                                    />
                                    <ActionPreviewDialog
                                      action={
                                        submittingRecoveryKey === withdrawKey
                                          ? "Submitting..."
                                          : "Submit fallback"
                                      }
                                      title="Withdraw To Owner"
                                      description="This asks the devnet keeper to build guarded SPL token transfers from keeper token accounts back to the owner wallet."
                                      disabled={
                                        !readiness.canExecuteAutonomously ||
                                        !ownerAddress ||
                                        withdrawTransfers.length === 0 ||
                                        submittingRecoveryKey === withdrawKey
                                      }
                                      disabledLabel={
                                        !ownerAddress
                                          ? "Connect owner wallet"
                                          : withdrawTransfers.length === 0
                                            ? "Token details required"
                                            : !readiness.canExecuteAutonomously
                                              ? "Execution gated"
                                              : "Submitting..."
                                      }
                                      safetyNote="Withdraw fallback is only for recovery when retry is unsafe. It requires explicit token mint and amount inputs before it can submit."
                                      onPrimaryAction={() => void handleRecoveryRequest("WithdrawToOwner", receipt)}
                                      preview={recoveryPreview(receipt, "WithdrawToOwner", ownerAddress)}
                                      trigger={
                                        <Button variant="secondary" size="sm">
                                          <WalletCards className="h-3.5 w-3.5" />
                                          Withdraw to owner
                                        </Button>
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
                <Card>
                  <CardHeader>
                    <CardTitle>Protocol action queue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.actions.map((action) => (
                      <div key={action.id} className="grid gap-4 rounded-lg border border-[#e4eaf1] p-4 xl:grid-cols-[1.15fr_1fr_150px] xl:items-center">
                        <div>
                          {action.position ? (
                            <TokenPair
                              tokenA={action.position.pool.tokenASymbol}
                              tokenB={action.position.pool.tokenBSymbol}
                              size="sm"
                            />
                          ) : null}
                          <p className="mt-3 font-semibold text-[#101828]">{action.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[#667085]">{action.reason}</p>
                        </div>
                        <div>
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant={action.status === "Blocked" ? "avoid" : "medium"}>{action.status}</Badge>
                            <Badge variant="outline">{action.executionStatus}</Badge>
                            {action.position ? <HealthBadge status={action.position.healthStatus} /> : null}
                          </div>
                          {action.position ? <Progress value={action.position.healthScore} /> : null}
                          <p className="mt-2 text-sm text-[#667085]">
                            {formatUsd(action.notionalUsd)} notional · {action.estimatedSlippageBps} bps slippage
                          </p>
                        </div>
                        <ActionPreviewDialog
                          action={submittingActionId === action.id ? "Submitting..." : "Submit guarded execution"}
                          title={action.title}
                          description="This is the guarded execution plan. The live path submits only to the configured keeper signer with a guard-program action hash."
                          disabled={
                            !readiness.canExecuteAutonomously ||
                            action.status === "Blocked" ||
                            submittingActionId === action.id
                          }
                          disabledLabel={action.status === "Blocked" ? "Blocked by guardrails" : "Execution gated"}
                          safetyNote="Autonomous submission is allowed only through the guard program and remote keeper signer. The backend never holds a private key, and target programs must match the allowlist."
                          onPrimaryAction={() => void handleGuardedExecute(action.id)}
                          preview={actionPreview(action)}
                          trigger={<Button variant="secondary" className="w-full">Preview</Button>}
                        />
                        <div className="xl:col-span-3">
                          <GuardrailList results={action.guardrailResults} />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Policy rails</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        ["Max position size", formatUsd(policy.maxPositionSizeUsd)],
                        ["Daily notional", formatUsd(policy.dailyNotionalLimitUsd)],
                        ["Max slippage", `${policy.maxSlippageBps} bps`],
                        ["Max pool risk", `${policy.maxPoolRiskScore}/100`],
                        ["Liquidity floor", formatUsd(policy.minPoolLiquidityUsd)],
                        ["Daily rebalances", String(policy.dailyRebalanceLimit)],
                        ["Stop loss review", `${policy.stopLossPct}%`],
                        ["Take profit review", `${policy.takeProfitPct}%`],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-[#e4eaf1] p-3 text-sm">
                          <span className="text-[#667085]">{label}</span>
                          <span className="font-semibold text-[#101828]">{value}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Latest autonomy run</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.runs.map((run) => (
                        <div key={run.id} className="rounded-lg border border-[#e4eaf1] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant={run.mode === "LiveGuarded" ? "low" : "outline"}>{run.mode}</Badge>
                            <span className="text-xs text-[#667085]">{new Date(run.startedAt).toLocaleTimeString()}</span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[#667085]">
                            Scanned {run.positionsScanned} positions, planned {run.actionsPlanned} actions, blocked{" "}
                            {run.actionsBlocked}.
                          </p>
                        </div>
                      ))}
                      <div className="flex gap-3 rounded-lg border border-[#bfe4e2] bg-[#f5fbfb] p-4 text-sm leading-6 text-[#344054]">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#006d77]" />
                        <p>Live autonomy is routed through an on-chain guard policy plus a remote keeper signer.</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6">
              <Card>
                <CardContent className="grid gap-6 p-5 xl:grid-cols-[1fr_360px] xl:items-center">
                  <div>
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <Badge variant="outline">Simulation only</Badge>
                      <Badge variant="medium">No blind mirroring</Badge>
                      <Badge variant="low">Policy caps required</Badge>
                    </div>
                    <h2 className="text-2xl font-semibold text-[#101828]">
                      Copy LPing starts as a protocol watchlist.
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-[#667085]">
                      RangeGuard tracks LP wallets, simulates their actions against your policy, and queues copy actions
                      only when guardrails pass. Live mirroring still needs delegated guarded execution.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#fde9a2] bg-[#fff9e8] p-5">
                    <div className="flex gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#7a4e00]" />
                      <div>
                        <p className="font-semibold text-[#7a4e00]">Copying another LP is not alpha by itself.</p>
                        <p className="mt-2 text-sm leading-6 text-[#7a4e00]">
                          The same caps, simulations, liquidity checks, and slippage rules must apply before any copy
                          action can become executable.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4">
                {data.copyTargets.map((target) => (
                  <Card key={target.id}>
                    <CardContent className="grid gap-4 p-5 lg:grid-cols-[72px_1fr_1fr_1fr_160px] lg:items-center">
                      <div className="text-2xl font-semibold text-[#006d77]">{target.rank}</div>
                      <div>
                        <p className="font-semibold text-[#101828]">{target.name}</p>
                        <p className="mt-1 text-sm text-[#667085]">{shortenAddress(target.walletAddress, 5)}</p>
                        <p className="mt-2 text-sm text-[#667085]">{target.style}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#667085]">Simulated 30d</p>
                        <p className="mt-1 font-semibold text-[#067647]">{formatPercent(target.simulated30dPct)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#667085]">Max drawdown</p>
                        <p className="mt-1 font-semibold text-[#b42318]">{formatPercent(target.maxDrawdownPct)}</p>
                        <Badge className="mt-2" variant="outline">{target.status}</Badge>
                      </div>
                      <ActionPreviewDialog
                        action="Queue copy simulation"
                        title="Track LP Wallet"
                        description="This queues a copy-LPing simulation only. It does not mirror trades or authorize transactions."
                        disabled
                        preview={[
                          { label: "Wallet", value: shortenAddress(target.walletAddress, 6) },
                          { label: "Mode", value: "Policy watchlist" },
                          { label: "Followers", value: target.copiedPositions.toLocaleString() },
                          { label: "Execution", value: "No automatic mirroring" },
                        ]}
                        trigger={<Button variant="secondary" className="w-full"><WalletCards className="h-4 w-4" />Track</Button>}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#067647]" />
                    <div>
                      <p className="font-semibold text-[#101828]">Watch first</p>
                      <p className="mt-1 text-sm leading-6 text-[#667085]">Observe LP moves before matching any range.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#006d77]" />
                    <div>
                      <p className="font-semibold text-[#101828]">Apply policy</p>
                      <p className="mt-1 text-sm leading-6 text-[#667085]">Filter by risk score, liquidity, slippage, and size.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#8a5a00]" />
                    <div>
                      <p className="font-semibold text-[#101828]">Delegate only with guards</p>
                      <p className="mt-1 text-sm leading-6 text-[#667085]">Future mirroring must route through guard program caps.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
