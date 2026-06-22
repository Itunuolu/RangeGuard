# RangeGuard

Risk-first Solana liquidity management dashboard for manual LP monitoring.

RangeGuard is an MVP for discovering Meteora DLMM pools, simulating ranges, tracking manual positions, reviewing suggested actions, and testing guarded autonomy.

## Safety Posture

- No custody of user funds.
- No backend private key handling.
- No automatic swaps, claims, withdrawals, deposits, or rebalances unless the guarded autonomy lane is fully configured.
- Suggested actions explain why they were created.
- Manual transaction flows are previews and require connected wallet review.
- Autonomous execution never uses backend private keys. It requires an on-chain policy account, guard program, delegated keeper authority, independent risk authority, target program allowlist, and a remote signer endpoint.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- shadcn-style Radix UI primitives
- TanStack Query
- Zustand
- Recharts
- Solana wallet adapter
- `@solana/web3.js`, `@solana/spl-token`
- PostgreSQL and Prisma ORM
- Lightweight Node worker: `pnpm worker:scan`
- Protocol autonomy worker: `pnpm worker:autonomy`

## Run Locally

```bash
pnpm install
copy .env.example .env
pnpm dev
```

The app defaults to:

```bash
MOCK_MODE=true
NEXT_PUBLIC_MOCK_MODE=true
```

Mock mode uses realistic pools, charts, positions, health states, activity, and suggested actions.

## Real Integration Mode

Set:

```bash
MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
DATABASE_URL="postgresql://..."
SOLANA_RPC_URL="https://..."
NEXT_PUBLIC_SOLANA_RPC_URL="https://..."
JUPITER_API_KEY="..."
```

Real-mode integration points are intentionally isolated:

- `src/lib/adapters/meteoraDlmm.ts`
- `src/lib/adapters/jupiter.ts`
- `src/lib/adapters/solanaRpc.ts`

Direct Meteora and Jupiter writes remain disabled in the UI until integration review is complete. Guarded autonomy submissions can be enabled separately through the on-chain guard and keeper signer configuration below.

## Prisma

```bash
pnpm prisma:generate
pnpm db:push
```

The MVP API falls back to mock persistence if the database is unavailable.

## Worker

```bash
pnpm worker:scan
```

The worker scans positions, evaluates health, and logs/manual-creates suggested actions. It does not execute transactions.

For the protocol autonomy control plane:

```bash
pnpm worker:autonomy
```

This plans guarded bot actions against policy rails. Live autonomous submission remains gated by:

```bash
AUTONOMY_EXECUTION_ENABLED=true
AUTONOMY_GUARD_PROGRAM_ID="..."
AUTONOMY_POLICY_ADDRESS="..."
AUTONOMY_KEEPER_AUTHORITY="..."
AUTONOMY_RISK_AUTHORITY="..."
AUTONOMY_KEEPER_SIGNER_URL="https://keeper.example.com/rangeguard/submit"
AUTONOMY_ALLOWED_PROGRAM_IDS="LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo,JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
```

The scaffolded Anchor guard program lives in `programs/rangeguard_guard`. It enforces caps outside the frontend/backend by checking delegated authority, independent risk authority, pause status, notional limits, daily limits, slippage, risk, liquidity, pool type, allowed pool addresses, allowed target programs, and transaction instruction introspection.

Local safety checks:

```bash
pnpm test:autonomy
pnpm autonomy:release-check
```

Initialize or update a deployed guard policy:

```powershell
pnpm.cmd guard:policy:init
```

The policy script derives `AUTONOMY_POLICY_ADDRESS` as the PDA for `RANGEGUARD_POLICY_OWNER_KEYPAIR` and `AUTONOMY_GUARD_PROGRAM_ID`. It initializes when the policy account does not exist and updates when it does. It leaves the policy paused unless `RANGEGUARD_POLICY_ARM=true`.

Run the devnet keeper skeleton:

```powershell
pnpm.cmd keeper:devnet
```

The keeper listens on `http://127.0.0.1:8787/rangeguard/submit`, verifies RangeGuard action hashes, requires separate keeper and risk-authority keypairs, signs guarded transactions, simulates them, and submits only when `RANGEGUARD_KEEPER_DRY_RUN=false`. Without reviewed target instructions from DLMM/Jupiter builders it accepts dry-run payloads but refuses live submission.

Deployment helper:

```powershell
./scripts/deploy-guard.ps1 -Cluster devnet
```

Before production mainnet use, deploy and audit the guard program, wire reviewed Meteora DLMM/Jupiter instruction builders into the keeper, enable delegated authority revocation flows, and add operational monitoring.

## Main Routes

- `/` landing page
- `/app` dashboard
- `/app/pools` pool explorer
- `/app/pools/[poolAddress]` pool detail and LP simulator
- `/app/positions` position monitor
- `/app/positions/[positionId]` position detail
- `/app/bot` protocol-grade Guard Bot and Copy LPing control plane
- `/app/strategies/new` strategy builder
- `/app/activity` activity history
- `/app/settings` settings and safety preferences
