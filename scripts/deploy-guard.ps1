param(
  [ValidateSet("localnet", "devnet", "mainnet-beta")]
  [string]$Cluster = "devnet",
  [string]$Wallet = "",
  [switch]$AllowMainnet
)

$ErrorActionPreference = "Stop"

if ($Cluster -eq "mainnet-beta" -and -not $AllowMainnet) {
  throw "Refusing mainnet deployment without -AllowMainnet. Run release checks and audit review first."
}

$anchor = Get-Command anchor -ErrorAction SilentlyContinue
$solana = Get-Command solana -ErrorAction SilentlyContinue

if (-not $anchor) {
  throw "Anchor CLI is not installed. Install Anchor/AVM before deploying the guard program."
}

if (-not $solana) {
  throw "Solana CLI is not installed. Install the Solana tool suite before deploying the guard program."
}

if ($Wallet) {
  solana config set --keypair $Wallet | Out-Host
}

solana config set --url $Cluster | Out-Host
solana address | Out-Host
anchor build | Out-Host
anchor deploy --provider.cluster $Cluster | Out-Host

Write-Host "Guard deployment command completed for $Cluster."
Write-Host "Next: initialize the policy account, set AUTONOMY_GUARD_PROGRAM_ID/AUTONOMY_POLICY_ADDRESS, then run pnpm autonomy:release-check."
