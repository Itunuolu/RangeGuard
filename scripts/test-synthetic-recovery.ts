import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";

import type { KeeperExecutionReceipt } from "@/lib/types";

const RETRY_ACTION_ID = "synthetic-recovery-rebalance";
const NO_TOKEN_ACTION_ID = "synthetic-recovery-no-token-details";
const OWNER_WALLET = "AVW2xuuKRP1GqMbhH2xnUQ5YPzjHC2EoAPLEkqigsJz3";
const KEEPER_AUTHORITY = "5VCWSCF9JSGqS17z5yNEGzFAQnHJ5NEzMVqiJ9a6rHA3";
const RISK_AUTHORITY = "6w641c1MMFv8iQViZ4RMrWMmhNokKM2aeeC6EComX63P";
const GUARD_PROGRAM_ID = "GTEGpV9Gr9uMr4CvkKHQUskrVJ8cZQRD7ewPcoRrrVps";
const POLICY_ADDRESS = "AdRwsZ531T31D3DYqPUpHjfrn3tPeAkLShEqx3B8fm11";
const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_X_MINT = "3cpyQsguaEZZV4CNFmoDzSrsMkTs6B1icDgZ7zWkppaH";
const TOKEN_Y_MINT = "28Ps41RTe7p8qwACqZVLxQ74WXXQaPdGZrBbWhbK1oBp";
const KEEPER_TOKEN_X_ACCOUNT = "BndfY5ZezbgyKYoesaio7ULJNhJksDKLkTc5M2sJ9FM4";
const KEEPER_TOKEN_Y_ACCOUNT = "BxzwGtKPxQdQQQKWSBFmk2cDznSHfkeCxHuq5DdgBH87";

type JsonResponse<T = unknown> = {
  json: T;
  status: number;
  text: string;
};

function syntheticTokenMetadata(now: string): KeeperExecutionReceipt["tokenMetadata"] {
  return {
    source: "MeteoraDLMM",
    tokenXMint: TOKEN_X_MINT,
    tokenYMint: TOKEN_Y_MINT,
    keeperTokenXAccount: KEEPER_TOKEN_X_ACCOUNT,
    keeperTokenYAccount: KEEPER_TOKEN_Y_ACCOUNT,
    tokenXProgramId: TOKEN_PROGRAM_ID,
    tokenYProgramId: TOKEN_PROGRAM_ID,
    amountX: "1099745",
    amountY: "900273",
    capturedAt: now,
    transfers: [
      {
        side: "X",
        mint: TOKEN_X_MINT,
        amount: "1099745",
        keeperTokenAccount: KEEPER_TOKEN_X_ACCOUNT,
        tokenProgramId: TOKEN_PROGRAM_ID,
      },
      {
        side: "Y",
        mint: TOKEN_Y_MINT,
        amount: "900273",
        keeperTokenAccount: KEEPER_TOKEN_Y_ACCOUNT,
        tokenProgramId: TOKEN_PROGRAM_ID,
      },
    ],
  };
}

function syntheticReceipt({
  actionId = RETRY_ACTION_ID,
  includeTokenDetails = true,
}: {
  actionId?: string;
  includeTokenDetails?: boolean;
} = {}): KeeperExecutionReceipt {
  const now = new Date().toISOString();
  const tokenMetadata = includeTokenDetails ? syntheticTokenMetadata(now) : null;
  const tokenTransfers = tokenMetadata?.transfers || [];

  return {
    persistedAt: now,
    source: "rangeguard-autonomy",
    requestType: "MeteoraFullRebalance",
    actionId,
    policyId: "synthetic-recovery-policy",
    poolAddress: "GMRujHfDduHFiTbn8gQojnDzQkMEVguTLihy8d7UfBnW",
    oldPositionAddress: "3mfGMYChtRnr4rjjtUuaDVKM5uwbfpVywkZagHS1yFos",
    newPositionAddress: null,
    notionalUsd: 42,
    estimatedSlippageBps: 25,
    proposedLowerBin: -9,
    proposedUpperBin: 7,
    startedAt: now,
    completedAt: now,
    status: "RecoveryRequired",
    estimatedDepositXAmount: "1099745",
    estimatedDepositYAmount: "900273",
    expectedNewLowerBin: -9,
    expectedNewUpperBin: 7,
    tokenMetadata,
    phaseResults: [
      {
        phaseId: "remove-old-position",
        status: "Submitted",
        signature: "syntheticPhase1Signature111111111111111111111111111111",
        targetInstructionDigest: "a".repeat(64),
        targetProgramIds: [DLMM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID],
        instructionCount: 6,
        unitsConsumed: 120_000,
      },
    ],
    recovery: {
      required: true,
      state: "RecoveryRequired",
      reason: "Synthetic partial receipt: phase 1 submitted, phase 2 intentionally missing.",
      sourceReceiptActionId: actionId,
      retryAddLiquidity: {
        status: "Available",
        reason: "Reuse the original range with a fresh new-position signer.",
        expectedLowerBin: -9,
        expectedUpperBin: 7,
        freshNewPositionAddress: null,
      },
      withdrawToOwner: {
        status: includeTokenDetails ? "Available" : "Blocked",
        reason: includeTokenDetails
          ? "Synthetic receipt includes token metadata captured from the phase 1 result."
          : "Synthetic test intentionally omits token details so the endpoint must block withdraw.",
        ownerAddress: OWNER_WALLET,
        tokenTransfers,
      },
    },
    error: "Recovery required: phase 1 was submitted, but the add-liquidity phase did not complete.",
  };
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function nextCliPath() {
  return resolve("node_modules/next/dist/bin/next");
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function getFreePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolvePort(address.port);
        else reject(new Error("Failed to allocate a local port."));
      });
    });
  });
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }

  throw new Error(`${label} did not become ready.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`);
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function ensureBuild() {
  if (existsSync(resolve(".next/BUILD_ID"))) return;

  console.log("[RangeGuard Synthetic Recovery] .next build missing; running pnpm build.");
  runCommand(pnpmCommand(), ["build"]);
}

function startKeeperStub(port: number) {
  const posts: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      writeJson(response, 200, {
        ok: true,
        dryRun: true,
        keeper: KEEPER_AUTHORITY,
        riskAuthority: RISK_AUTHORITY,
        detail: "synthetic keeper ready",
      });
      return;
    }

    if (request.method === "POST") {
      const body = JSON.parse(await readRequestBody(request)) as unknown;
      posts.push(body);
      const mode = (body as { recovery?: { mode?: string } }).recovery?.mode;

      writeJson(response, 202, {
        ok: true,
        dryRun: true,
        submitted: false,
        status: mode === "RetryAddLiquidity" ? "RetrySimulated" : "WithdrawSimulated",
        detail: `Synthetic keeper dry-run accepted ${mode}.`,
      });
      return;
    }

    writeJson(response, 405, { ok: false, detail: "method not allowed" });
  });

  return new Promise<{ close: () => Promise<void>; posts: unknown[] }>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolveServer({
        posts,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.closeAllConnections();
            const timer = setTimeout(() => resolveClose(), 2_000);

            server.close((error) => {
              clearTimeout(timer);
              return error ? rejectClose(error) : resolveClose();
            });
          }),
      });
    });
  });
}

function startApp(port: number, receiptPath: string, keeperUrl: string) {
  const app = spawn(process.execPath, [nextCliPath(), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOCK_MODE: "false",
      NEXT_PUBLIC_MOCK_MODE: "false",
      SOLANA_CLUSTER: "devnet",
      SOLANA_RPC_URL: "https://api.devnet.solana.com",
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
      AUTONOMY_EXECUTION_ENABLED: "true",
      AUTONOMY_GUARD_PROGRAM_ID: GUARD_PROGRAM_ID,
      AUTONOMY_POLICY_ADDRESS: POLICY_ADDRESS,
      AUTONOMY_KEEPER_AUTHORITY: KEEPER_AUTHORITY,
      AUTONOMY_RISK_AUTHORITY: RISK_AUTHORITY,
      AUTONOMY_KEEPER_SIGNER_URL: keeperUrl,
      AUTONOMY_ALLOWED_PROGRAM_IDS: [
        DLMM_PROGRAM_ID,
        JUPITER_PROGRAM_ID,
        COMPUTE_BUDGET_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
      ].join(","),
      RANGEGUARD_KEEPER_RECEIPT_PATH: receiptPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";

  app.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  app.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  app.once("error", (error) => {
    logs += `\n[spawn error] ${error.message}`;
  });
  app.once("exit", (code, signal) => {
    logs += `\n[app exit] code=${code ?? "null"} signal=${signal ?? "null"}`;
  });

  return { app, logs: () => logs };
}

function stopProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: JSON.parse(text) as T,
  };
}

async function requestText(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

async function pageScriptText(baseUrl: string, pathname: string) {
  const html = await requestText(`${baseUrl}${pathname}`);
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const scripts: string[] = [];

  for (const src of srcs.filter((candidate) => candidate.startsWith("/_next/static/"))) {
    scripts.push(await requestText(`${baseUrl}${src}`));
  }

  return [html, ...scripts].join("\n");
}

function assertIncludes(text: string, expected: string, label: string) {
  assert.ok(text.includes(expected), `${label} should include "${expected}".`);
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("[RangeGuard Synthetic Recovery] timed out inside test script.");
    process.exit(1);
  }, 120_000);

  ensureBuild();

  const tempDir = mkdtempSync(join(tmpdir(), "rangeguard-recovery-"));
  const receiptPath = join(tempDir, "synthetic-recovery.jsonl");
  const receipt = syntheticReceipt();
  const noTokenReceipt = syntheticReceipt({ actionId: NO_TOKEN_ACTION_ID, includeTokenDetails: false });
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n${JSON.stringify(noTokenReceipt)}\n`, "utf8");

  const keeperPort = await getFreePort();
  const keeper = await startKeeperStub(keeperPort);
  const appPort = await getFreePort();
  const appBaseUrl = `http://127.0.0.1:${appPort}`;
  const keeperUrl = `http://127.0.0.1:${keeperPort}/rangeguard/submit`;
  const { app, logs } = startApp(appPort, receiptPath, keeperUrl);

  try {
    console.log("[RangeGuard Synthetic Recovery] waiting for isolated app server...");
    await waitFor("Next app", async () => {
      const response = await fetch(`${appBaseUrl}/api/bot`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
      return response?.ok ? response : null;
    });

    console.log("[RangeGuard Synthetic Recovery] checking bot recovery data and client bundle...");
    const bot = await requestJson<{
      executionReceipts: KeeperExecutionReceipt[];
    }>(`${appBaseUrl}/api/bot`);
    const botReceipt = bot.json.executionReceipts.find((candidate) => candidate.actionId === RETRY_ACTION_ID);
    assert.equal(bot.status, 200);
    assert.ok(botReceipt);
    assert.equal(botReceipt?.status, "RecoveryRequired");
    assert.equal(botReceipt.tokenMetadata?.transfers.length, 2);

    const botScriptText = await pageScriptText(appBaseUrl, "/app/bot");
    assertIncludes(botScriptText, "Retry add-liquidity", "/app/bot client bundle");
    assertIncludes(botScriptText, "Withdraw to owner", "/app/bot client bundle");

    console.log("[RangeGuard Synthetic Recovery] checking retry endpoint dry-run handoff...");
    const retry = await requestJson<{
      result: { status: string; submitted: boolean; reasons: string[] };
    }>(`${appBaseUrl}/api/bot/recovery/retry-add-liquidity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: RETRY_ACTION_ID, startedAt: receipt.startedAt }),
    });
    assert.equal(retry.status, 202);
    assert.equal(retry.json.result.status, "RetrySimulated");
    assert.equal(keeper.posts.length, 1);
    assert.equal((keeper.posts[0] as { requestType?: string }).requestType, "MeteoraRebalanceRecovery");
    assert.equal(
      (keeper.posts[0] as { recovery?: { mode?: string } }).recovery?.mode,
      "RetryAddLiquidity",
    );

    console.log("[RangeGuard Synthetic Recovery] checking metadata-backed withdraw dry-run handoff...");
    const withdraw = await requestJson<{
      result: { status: string; submitted: boolean; reasons: string[] };
    }>(`${appBaseUrl}/api/bot/recovery/withdraw-to-owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: RETRY_ACTION_ID,
        startedAt: receipt.startedAt,
        ownerAddress: OWNER_WALLET,
        tokenTransfers: [],
      }),
    });
    assert.equal(withdraw.status, 202);
    assert.equal(withdraw.json.result.status, "WithdrawSimulated");
    assert.equal(keeper.posts.length, 2);
    assert.equal(
      (keeper.posts[1] as { recovery?: { tokenTransfers?: unknown[] } }).recovery?.tokenTransfers?.length,
      2,
      "withdraw should use token metadata from the receipt",
    );

    console.log("[RangeGuard Synthetic Recovery] checking withdraw preflight block without token details...");
    const blockedWithdraw = await requestJson<{
      result: { status: string; submitted: boolean; reasons: string[] };
    }>(`${appBaseUrl}/api/bot/recovery/withdraw-to-owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: NO_TOKEN_ACTION_ID,
        startedAt: noTokenReceipt.startedAt,
        ownerAddress: OWNER_WALLET,
        tokenTransfers: [],
      }),
    });
    assert.equal(blockedWithdraw.status, 409);
    assert.equal(blockedWithdraw.json.result.status, "Blocked");
    assert.ok(blockedWithdraw.json.result.reasons.join(" ").includes("token mint and amount"));
    assert.equal(keeper.posts.length, 2, "withdraw without token details must not reach keeper");

    console.log("[RangeGuard Synthetic Recovery] checking activity and positions recovery state...");
    const activity = await requestJson<{
      events: Array<{ eventType: string; metadata: Record<string, unknown>; message: string }>;
    }>(`${appBaseUrl}/api/activity`);
    assert.equal(activity.status, 200);
    assert.ok(
      activity.json.events.some((event) => event.eventType === "Error" && event.metadata.recoveryRequired === true),
      "/app/activity backing API should expose recovery error state",
    );

    const positions = await requestJson<{
      positions: Array<{ recoveryStatus?: string | null; healthStatus: string; suggestedAction: string }>;
    }>(`${appBaseUrl}/api/positions`);
    assert.equal(positions.status, 200);
    assert.ok(
      positions.json.positions.some(
        (position) =>
          position.recoveryStatus === "RecoveryRequired" &&
          position.healthStatus === "Closed" &&
          position.suggestedAction === "Rebalance",
      ),
      "/app/positions backing API should expose RecoveryRequired position state",
    );

    await requestText(`${appBaseUrl}/app/activity`);
    await requestText(`${appBaseUrl}/app/positions`);

    console.log("[RangeGuard Synthetic Recovery] PASS bot page has recovery action labels.");
    console.log("[RangeGuard Synthetic Recovery] PASS retry endpoint reached keeper dry-run.");
    console.log("[RangeGuard Synthetic Recovery] PASS metadata-backed withdraw reached keeper dry-run.");
    console.log("[RangeGuard Synthetic Recovery] PASS withdraw endpoint blocks without token details.");
    console.log("[RangeGuard Synthetic Recovery] PASS activity and positions expose recovery state.");
  } catch (error) {
    console.error("[RangeGuard Synthetic Recovery] app logs:");
    console.error(logs() || "(no app logs captured)");
    throw error;
  } finally {
    stopProcess(app);
    await keeper.close().catch(() => undefined);

    if (process.env.RANGEGUARD_RECOVERY_TEST_KEEP !== "true") {
      rmSync(tempDir, { recursive: true, force: true });
    } else {
      console.log(`[RangeGuard Synthetic Recovery] kept temp receipts at ${tempDir}`);
      console.log(readFileSync(receiptPath, "utf8"));
    }

    clearTimeout(watchdog);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[RangeGuard Synthetic Recovery] failed");
    console.error(error);
    process.exit(1);
  });
