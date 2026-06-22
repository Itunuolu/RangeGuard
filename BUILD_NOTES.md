# RangeGuard Build Notes

## Current Direction

- Fresh Next.js App Router MVP in `C:\Users\Admin\Documents\Web3\RangeGuard`.
- Mock-first, read-heavy, manual-confirmation-first implementation.
- Real integration points are isolated behind adapters and guarded by `MOCK_MODE=false`.

## Product Guardrails

- No custody.
- No backend private keys.
- Automatic rebalance, claim, swap, withdraw, or deposit execution is blocked unless the protocol guard lane is fully configured.
- Suggested actions must include explicit reasons.
- Transaction actions open previews and require wallet confirmation.
- True autonomy is treated as a protocol feature: policy, guardrails, dry-run planning, and execution readiness are explicit.
- Live autonomous submission is gated behind `AUTONOMY_EXECUTION_ENABLED`, `AUTONOMY_GUARD_PROGRAM_ID`, `AUTONOMY_POLICY_ADDRESS`, `AUTONOMY_KEEPER_AUTHORITY`, `AUTONOMY_RISK_AUTHORITY`, `AUTONOMY_KEEPER_SIGNER_URL`, and `AUTONOMY_ALLOWED_PROGRAM_IDS`.
- The backend never holds a private key. It can only submit a guarded action payload to a remote keeper signer.
- Target programs must be allowlisted, the risk authority must be independent from the keeper delegate, and the scaffolded on-chain guard inspects the transaction instructions sysvar before approving a delegated action.
- Devnet live full rebalance is additionally gated by `RANGEGUARD_KEEPER_DRY_RUN=false`, `AUTONOMY_DEVNET_LIVE_REBALANCE=true`, and a devnet RPC/`SOLANA_CLUSTER=devnet`; the keeper generates the new-position signer internally and refuses client-supplied live signer secrets.

## Autonomy Module

- `src/lib/autonomy/policy.ts`: guardrail evaluation and protocol readiness checks.
- `src/lib/autonomy/planner.ts`: converts positions into policy-checked bot actions.
- `src/lib/autonomy/guardProgram.ts`: builds action hashes and guard instruction previews.
- `src/lib/autonomy/meteoraTransactionBuilder.ts`: builds real Meteora DLMM claim-fees and rebalance remove/claim/close target instructions when the delegated keeper is the actual required signer.
- `src/lib/autonomy/executor.ts`: execution preview plus remote keeper submission.
- `src/lib/autonomy/receiptStore.ts`: keeper receipt reader/writer, Prisma sync helper, and activity-event projection for live rebalance receipts.
- `programs/rangeguard_guard`: Anchor guard program scaffold for policy account enforcement outside the UI/API.
- `scripts/test-autonomy-safety.ts`: local autonomy safety tests.
- `scripts/verify-autonomy-release.ts`: release gate that checks real RPC accounts, keeper health, policy readiness, and action readiness.
- `scripts/deploy-guard.ps1`: guarded deployment helper that refuses mainnet unless explicitly unlocked.
- `scripts/init-guard-policy.ts`: initializes or updates the on-chain guard policy PDA and optionally arms it.
- `scripts/devnet-keeper.ts`: local/devnet keeper skeleton with health checks, keeper/risk signer verification, guarded transaction simulation, dry-run default, and a devnet-only full rebalance live lane with persisted execution receipts.
- `scripts/worker-autonomy.ts`: dry-run autonomy worker.
- `/api/bot`: control plane data for UI.
- `/api/bot/actions/[actionId]/execute`: live guarded submit endpoint, returns 409 unless every protocol prerequisite passes.
- `/app/bot`: Autonomy Bot and Copy LPing protocol surface.

## Local Guard Proof

- Solana CLI and Anchor CLI are installed in WSL; Anchor 0.31.1 is used for the guard program.
- Local validator proof is running on `http://127.0.0.1:8899`.
- Local dry-run keeper is running on `http://127.0.0.1:8787/rangeguard/submit`.
- Guard program deployed locally: `GTEGpV9Gr9uMr4CvkKHQUskrVJ8cZQRD7ewPcoRrrVps`.
- Armed local policy PDA: `Cdq6fQixg6i1i8gh2Uk7mwbKo3UWEd96pfSD5FcS4rxy`.
- Local keeper delegate: `FaUvNvb3nJ1mAHVWGp6wxApYVnc4AYgMT3muAL2xsLR8`.
- Local risk authority: `CPLDQKWk8jad5sg4v5t9ovs4V5kME3CMcUtKChtJFzLS`.
- Dev keypairs live under `.rangeguard/localnet/`, which is ignored by git.
- `pnpm autonomy:release-check` passes with `MOCK_MODE=false` against the local validator/keeper.
- `pnpm worker:autonomy` posts guarded payloads to the keeper and returns `AcceptedDryRun`; no transaction is broadcast because reviewed DLMM/Jupiter target instruction builders are still TODO.

## Devnet Guard Proof

- Deploy wallet: `DMBHBaWJyd2buXmornaMYtZPwWEUezXhDLcKcw3kXNqy`.
- Public RPC airdrop attempts for `2`, `1`, `0.5`, `0.2`, and `0.001` SOL returned faucet rate-limit / HTTP 429 responses.
- `devnet-pow v0.1.4` is installed in WSL.
- Funded PoW faucets found:
  - Difficulty 3, reward `0.02 SOL`: `6yvwhesLJeE8fNWviosRoUtBP3VFUXE7SEhSP9fFRJ3Z`
  - Difficulty 4, reward `0.02 SOL`: `2pekXzx7WRPtdj4Gvtif1mzmHfc21zpNx2AvW9r4g7bo`
- PoW mining was run with `--no-infer` after the deploy wallet was seeded with `1 SOL`.
- Devnet guard program deployed: `GTEGpV9Gr9uMr4CvkKHQUskrVJ8cZQRD7ewPcoRrrVps`.
- Devnet deploy signature: `5ZTYcGyW7yYvSwrwqXoLhTinNA7T5E3oz2Xm2wunyv6o5RwUreaetsjw1Kj5iVg9cHpeUzfd67eqndxAziCQ4MSC`.
- Armed devnet policy PDA: `AdRwsZ531T31D3DYqPUpHjfrn3tPeAkLShEqx3B8fm11`.
- Devnet policy initialize signature: `2UooeokuF7DGgq66pnRcf4AjcYaGBGTJAQg8SrbDdTxhN48ACnUkoh7KYWcHjDTP7471Gz8QxRzpxaanSm1n2AQV`.
- Devnet policy owner: `AVW2xuuKRP1GqMbhH2xnUQ5YPzjHC2EoAPLEkqigsJz3`.
- Devnet keeper delegate: `5VCWSCF9JSGqS17z5yNEGzFAQnHJ5NEzMVqiJ9a6rHA3`.
- Devnet risk authority: `6w641c1MMFv8iQViZ4RMrWMmhNokKM2aeeC6EComX63P`.
- Devnet dry-run keeper is running on `http://127.0.0.1:8788/rangeguard/submit`.
- Devnet keeper was returned to dry-run mode after the live full rebalance proof.
- `pnpm autonomy:release-check` passes with `MOCK_MODE=false` against devnet.
- `pnpm worker:autonomy` posts guarded payloads to the devnet keeper and returns `AcceptedDryRun`.
- Devnet policy was updated for the real Meteora proof lane to allow DLMM, Jupiter, Compute Budget, and Associated Token top-level programs, and to lower the devnet-only liquidity floor to `0`.
- Devnet policy update signature: `2j8UJ15M4K7ncjti33nzo2H7cbwQW3CCRx8CFtJ6tTsGRG8jf79VuiXK774Wxn2hunaJzNCKuY7huEPkaVtnpKzM`.

## Meteora Builder Proof

- Added the first real DLMM transaction builder for `ClaimFees` and the remove/claim/close leg of `Rebalance`.
- The action hash now binds `targetInstructionDigest`, so a keeper payload is tied to the exact target instructions, not only the action metadata.
- The executor only attaches DLMM target instructions when every target signer is the delegated keeper authority. If the position owner is a user wallet, the action stops as `WalletRequired`.
- The devnet keeper now recomputes the target instruction digest, requires exact target program id matching, and rejects target instructions requiring any signer other than the keeper.
- Duplicate idempotent Associated Token Account create instructions are compacted before keeper submission to stay under Solana transaction size limits without changing account state semantics.
- Added a phase-split full rebalance dry-run builder:
  - Phase 1: remove liquidity, claim fees, and close the old position.
  - Phase 2: initialize a new DLMM position and add liquidity around the proposed range.
  - The new-position signer is explicit and ephemeral for dry-runs, and keeper-generated internally for devnet live execution.
  - The full rebalance add phase drops the SDK compute-budget prelude to stay under the legacy transaction size limit for dry-run simulation.
- Added devnet-only live full rebalance execution in the keeper:
  - Requires `RANGEGUARD_KEEPER_DRY_RUN=false`, `AUTONOMY_DEVNET_LIVE_REBALANCE=true`, and devnet cluster/RPC.
  - Rejects client-supplied live additional signers.
  - Builds the full Meteora plan inside the keeper using a keeper-generated new-position keypair.
  - Broadcasts phase 1 and phase 2 sequentially after simulation.
  - Verifies the old position closed, the new position owner is the keeper delegate, and the new lower/upper bins match the planned range.
  - Persists JSONL receipts to `.rangeguard/devnet/keeper-executions.jsonl`.
  - Attempts to sync receipts into Prisma when `DATABASE_URL` is configured; local verification currently reports `databaseConfigured=false`, so the app surfaces the receipt file as the source of truth.
- `/api/bot` now includes `executionReceipts` and `receiptPersistence`.
- `/api/activity` merges keeper live rebalance receipt events ahead of mock activity.
- `/api/positions` merges receipt-backed keeper positions ahead of mock/adapter positions.
- `/api/positions/[positionId]` resolves receipt-backed positions and their keeper activity events.
- `/app/bot` shows an executed keeper rebalance history panel with status, old/new positions, verified range, and phase transaction links.
- `/app/activity` labels receipt-derived events as `Keeper submitted` and links tx signatures to Solana Explorer devnet.
- `/app/positions` labels receipt-backed positions as `Keeper receipt`; the live proof old position appears closed and the new keeper-owned position appears open/in-range.
- Added `pnpm receipts:sync`, which replays `.rangeguard/devnet/keeper-executions.jsonl` into Prisma idempotently when `DATABASE_URL` is configured.
- Added recovery-state detection for receipts with a submitted phase 1 signature and no submitted add-liquidity signature. These now surface as `RecoveryRequired` in `/app/bot`, `/app/activity`, and `/app/positions`.
- Added a devnet-only keeper recovery request path for retrying add-liquidity with the original receipt range and a fresh keeper-generated new-position signer.
- Added a guarded withdraw-to-owner fallback builder that transfers explicit keeper token account balances back to the owner wallet through SPL Token instructions.
- Added `/api/bot/recovery/retry-add-liquidity` and `/api/bot/recovery/withdraw-to-owner`, which look up local keeper receipts, require `RecoveryRequired`, and submit `MeteoraRebalanceRecovery` payloads to the configured devnet keeper.
- `/app/bot` now shows preview-first recovery action buttons on `RecoveryRequired` receipts: retry add-liquidity and withdraw to owner. Withdraw remains blocked until explicit token mint/amount details are present.
- Added `pnpm test:recovery`, a synthetic recovery integration script that writes a temporary `RecoveryRequired` receipt, starts an isolated production Next app with a dry-run keeper stub, verifies `/app/bot` recovery action labels, proves retry reaches keeper dry-run, proves withdraw blocks without token details, and verifies activity/positions recovery state.
- Recovery receipts now carry Meteora token metadata: token X/Y mints, keeper token accounts, token programs, estimated token amounts, and normalized fallback transfer entries. The keeper uses this metadata to make withdraw-to-owner deterministic after a partial rebalance.
- Recovery receipts created by retry/withdraw flows now include `recoverySource`, linking back to the original partial-failure receipt action id, start time, and phase 1 signature.
- `/app/bot` invalidates bot, activity, and positions data after guarded execution or recovery requests, so receipt-backed recovery state refreshes after a dry-run or live submission.
- The synthetic recovery drill now covers both fallback cases: metadata-backed withdraw reaches the keeper dry-run, while a receipt without token details still blocks before keeper submission.
- Added `pnpm meteora:partial-failure-drill`, a devnet-only live drill that refuses to run unless `RANGEGUARD_PARTIAL_FAILURE_DRILL=true`, `AUTONOMY_DEVNET_LIVE_REBALANCE=true`, a live non-dry-run keeper, and no unresolved recovery receipt are present. It submits the phase 1 remove/claim/close leg, intentionally skips phase 2, persists a `RecoveryRequired` receipt, writes `.rangeguard/devnet/partial-failure-drill.json`, and syncs to Prisma when `DATABASE_URL` is configured.
- Real devnet partial-failure drill on May 26, 2026:
  - Old position intentionally closed: `B5zrgriUX82dGFw6jNhCP87FDVRtqYXx1uScU3xS48nG`
  - Recovery receipt action id: `devnet-partial-failure-drill-2026-05-26T06-41-42-837Z`
  - Phase 1 signature: `3NKaUC3bogp4jtSF8iJDBW588kaF9Ck7G8gNuzFjRn2dxBnXNjJDNcmH967UCezV2mMGf2rgoHqwy6ZWd7F91Dof`
  - Phase 2 was not submitted by design.
  - Receipt status: `RecoveryRequired`
  - Captured token metadata: token X amount `1099740`, token Y amount `900270`, with keeper token accounts `BndfY5ZezbgyKYoesaio7ULJNhJksDKLkTc5M2sJ9FM4` and `BxzwGtKPxQdQQQKWSBFmk2cDznSHfkeCxHuq5DdgBH87`.
  - `/app/bot` shows recovery buttons, `/api/activity` exposes recovery events, and `/api/positions` shows the closed receipt-backed position with `RecoveryRequired`.
  - The devnet keeper was returned to dry-run mode after the drill.
- Real devnet retry recovery on May 26, 2026:
  - Dry-run retry add-liquidity built and simulated successfully before live execution.
  - Live retry receipt action id: `devnet-partial-failure-drill-2026-05-26T06-41-42-837Z-RetryAddLiquidity-1779778523399`
  - New keeper-owned position: `878HYM5vQCjgkjAGsk1pT6R5QAQFFAH62q79FoeUSoL9`
  - Retry add-liquidity signature: `2hexuKfSB2owCHnzM8R3u9P73gX6GSS8fLPZzWMYMQMWwHqmB1AWwQN3DxEChCSGLSRLu6iSe49eNBTYpwKiU8EQ`
  - Postflight passed: old position closed, new owner is keeper delegate, new range `-9` to `7`, active bin `-1`.
  - Receipt projection now links the retry receipt back to the partial-failure receipt and marks the original as `Recovered`/`Resolved`, so `/app/bot`, `/app/activity`, and `/app/positions` no longer show an active recovery requirement.
  - The devnet keeper was returned to dry-run mode after live retry.
- Updated the devnet guard policy allowlist to include the SPL Token program for the withdraw-to-owner fallback.
- Devnet recovery policy update signature: `3DbRREXBEBxZ3giwUy1DZuWtARLzhMNpn7mtdzjadczyA5jRcKMAaPTXhdPY6WzVyZwfj3ReKxZd9v7zifvJdAgb`.
- Added Prisma indexes for receipt-backed lookup paths: unique `Position.positionAddress`, indexed `PositionEvent.txSignature`, and status/type indexes for suggested and bot actions.
- Added Prisma 7 config support via `prisma.config.ts`, removed the deprecated datasource URL from `schema.prisma`, added the Postgres Prisma adapter, and updated `getPrismaClient` to use `@prisma/adapter-pg`.
- Local Postgres on `127.0.0.1:5432` was configured with database `rangeguard`; `pnpm db:push` synced the schema, and `pnpm receipts:sync` persisted 1 keeper receipt into Prisma using `postgresql://postgres:postgres@127.0.0.1:5432/rangeguard?schema=public`.
- Added `scripts/meteora-devnet-position-proof.ts` and `pnpm meteora:devnet-proof`.
- Real devnet DLMM proof:
  - Pool: `GMRujHfDduHFiTbn8gQojnDzQkMEVguTLihy8d7UfBnW`
  - Token X: `3cpyQsguaEZZV4CNFmoDzSrsMkTs6B1icDgZ7zWkppaH`
  - Token Y: `28Ps41RTe7p8qwACqZVLxQ74WXXQaPdGZrBbWhbK1oBp`
  - Keeper-owned position: `3mfGMYChtRnr4rjjtUuaDVKM5uwbfpVywkZagHS1yFos`
  - Position owner: `5VCWSCF9JSGqS17z5yNEGzFAQnHJ5NEzMVqiJ9a6rHA3`
  - Pool creation signature: `2v9KzL1zGaHXqRLUfiLAE2zFLsiGVtL1i9GLCZ3HAHR8FTN845V5m7wgqoiDqfgWT37QJN7p2qupXsB3KhWTohS`
  - Position open signature: `SB9sfEm6SGnKfokCYFCb4SvHWP47mk85sP98mo8fhB83VNaDP2ZY2fFk2S8ECEFo6tToGqATXUjqruqwDqtCSMQ`
  - Fee-generating swap signature: `5Asy3JH1sVBuVCdvb2dexWigjSVJkrmeGsEZe65cAbLaVUw5onkjFb8T96PXxmQFskXVDCBateoFtkurKz9Ycm6E`
  - Claim builder: `Built`, `4` target instructions, dry-run keeper result `Simulated`
  - Rebalance builder: `Built`, `6` target instructions after ATA compaction, dry-run keeper result `Simulated`
  - Full rebalance dry-run builder: `Built`, phase 1 `6` target instructions, phase 2 `2` target instructions, both dry-run keeper results `Simulated`
  - Full rebalance dry-run new position: `2XFfMA7o95ceJg1vXuyVi6MLHS8uuzuvvkuZRLt5DzDg`
  - Full rebalance estimated redeposit amounts: token X `1099745`, token Y `900273`
  - Live devnet full rebalance status: `Executed`
  - Old position closed by live proof: `3mfGMYChtRnr4rjjtUuaDVKM5uwbfpVywkZagHS1yFos`
  - Current keeper-owned position after live proof: `B5zrgriUX82dGFw6jNhCP87FDVRtqYXx1uScU3xS48nG`
  - Live phase 1 signature: `5yWXiuxLQYwN8ySH5psj1zp3bZ7qiaJjRoH1k7MQTjigCyR2YmUVaJKaz7QCEjcFRBpVW8wdrsoJb2whfDxL2PAu`
  - Live phase 2 signature: `FTvJehnXbdwpkR1LFqx3VHzJnyLN9EyYrtSSAAXQtKA6E7Di866S34YMfLGFxfUfSJbefqKyeAV2NbDb8CEY3sk`
  - Live postflight: old position closed, new owner `5VCWSCF9JSGqS17z5yNEGzFAQnHJ5NEzMVqiJ9a6rHA3`, new range `-9` to `7`, active bin `-1`
  - Full JSON proof: `.rangeguard/devnet/meteora-proof.json`
- Verification completed on May 25, 2026: `pnpm typecheck`, `pnpm lint`, `pnpm test:autonomy`, `pnpm build`, `pnpm autonomy:release-check`, `pnpm worker:autonomy`, browser verification of `/app/bot` and `/app/activity`, and `pnpm meteora:devnet-proof` in both dry-run and devnet-live full rebalance mode.
- Receipt replay verification on May 25, 2026: `pnpm receipts:sync` found 1 receipt and skipped DB persistence because `DATABASE_URL` is not set; browser verification confirmed `/app/positions` shows the receipt-backed closed old position and open new position.

## Docs Checked

- Meteora DLMM TypeScript SDK state methods: pool discovery, active bin, bin ranges, user positions.
- Meteora DLMM overview: concentrated liquidity, dynamic fees, Token 2022 and PositionV2 context.
- Jupiter Swap API: current `https://api.jup.ag/swap/v2` API-key-based order/build/execute model.
- Solana wallet adapter React provider pattern.
