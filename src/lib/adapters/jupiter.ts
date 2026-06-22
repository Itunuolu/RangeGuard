import { serverConfig } from "@/lib/config";
import type { JupiterAdapter, JupiterQuote, JupiterQuoteRequest } from "@/lib/adapters/types";

const mockQuote: JupiterQuote = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000",
  outAmount: "146250000",
  priceImpactPct: 0.18,
  routePlan: ["Jupiter quote preview", "Wallet signature required", "No execution by RangeGuard"],
  warning: "Mock quote only. Real swaps must be reviewed and signed in the connected wallet.",
};

const mockJupiterAdapter: JupiterAdapter = {
  async getQuote(request) {
    return {
      ...mockQuote,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inAmount: request.amount,
    };
  },
};

const realJupiterAdapter: JupiterAdapter = {
  async getQuote(request: JupiterQuoteRequest) {
    if (!serverConfig.jupiterApiKey) {
      return {
        ...mockQuote,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmount: request.amount,
        warning: "Jupiter API key is not configured. Showing a disabled preview only.",
      };
    }

    const params = new URLSearchParams({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amount,
      slippageBps: String(request.slippageBps),
    });

    if (request.taker) params.set("taker", request.taker);

    // TODO: Confirm final production request body against the live Jupiter Swap API version in use.
    // Current docs describe the v2 quote/order flow at api.jup.ag/swap/v2 with API-key headers.
    const response = await fetch(`https://api.jup.ag/swap/v2/quote?${params.toString()}`, {
      headers: {
        "x-api-key": serverConfig.jupiterApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Jupiter quote failed with ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    return {
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inAmount: String(body.inAmount || request.amount),
      outAmount: String(body.outAmount || body.outputAmount || "0"),
      priceImpactPct: Number(body.priceImpactPct || 0),
      routePlan: Array.isArray(body.routePlan) ? body.routePlan.map((route) => JSON.stringify(route)).slice(0, 3) : ["Jupiter route returned"],
      warning: "Quote only. RangeGuard will not execute swaps without wallet confirmation.",
    };
  },
};

export function getJupiterAdapter(): JupiterAdapter {
  return serverConfig.mockMode ? mockJupiterAdapter : realJupiterAdapter;
}
