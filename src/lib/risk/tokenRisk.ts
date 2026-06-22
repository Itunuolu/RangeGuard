export type TokenRiskInput = {
  symbol: string;
  mint: string;
  ageDays?: number;
  isStable?: boolean;
  isBlueChip?: boolean;
  hasKnownMarket?: boolean;
};

export type TokenRiskResult = {
  score: number;
  label: "Low" | "Medium" | "High" | "Avoid";
  reasons: string[];
};

const BLUE_CHIP_SYMBOLS = new Set(["SOL", "USDC", "USDT", "JUP", "JITOSOL", "MSOL", "BSOL", "WBTC", "WETH"]);
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "PYUSD"]);

export function scoreTokenRisk(token: TokenRiskInput): TokenRiskResult {
  const reasons: string[] = [];
  let score = 15;
  const symbol = token.symbol.toUpperCase();

  if (token.isStable || STABLE_SYMBOLS.has(symbol)) {
    score -= 8;
    reasons.push(`${token.symbol} is treated as a major stable asset.`);
  }

  if (token.isBlueChip || BLUE_CHIP_SYMBOLS.has(symbol)) {
    score -= 5;
    reasons.push(`${token.symbol} has deeper Solana market coverage.`);
  }

  if (token.hasKnownMarket === false) {
    score += 22;
    reasons.push(`${token.symbol} has limited market metadata available.`);
  }

  if (typeof token.ageDays === "number") {
    if (token.ageDays < 14) {
      score += 25;
      reasons.push(`${token.symbol} is very new, so historical behavior is limited.`);
    } else if (token.ageDays < 60) {
      score += 12;
      reasons.push(`${token.symbol} has a short trading history.`);
    }
  } else if (!BLUE_CHIP_SYMBOLS.has(symbol) && !STABLE_SYMBOLS.has(symbol)) {
    score += 10;
    reasons.push(`${token.symbol} token age is unknown.`);
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: normalized,
    label: normalized <= 25 ? "Low" : normalized <= 50 ? "Medium" : normalized <= 75 ? "High" : "Avoid",
    reasons,
  };
}
