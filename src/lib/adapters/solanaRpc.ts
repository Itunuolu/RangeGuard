import { Connection, PublicKey } from "@solana/web3.js";

import { serverConfig } from "@/lib/config";
import type { SolanaRpcAdapter } from "@/lib/adapters/types";

const mockRpcAdapter: SolanaRpcAdapter = {
  async getWalletBalance() {
    return 18.42;
  },
  async getTokenAccountCount() {
    return 7;
  },
};

const realRpcAdapter: SolanaRpcAdapter = {
  async getWalletBalance(walletAddress) {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const lamports = await connection.getBalance(new PublicKey(walletAddress));
    return lamports / 1_000_000_000;
  },
  async getTokenAccountCount(walletAddress) {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(walletAddress), {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });
    return accounts.value.length;
  },
};

export function getSolanaRpcAdapter(): SolanaRpcAdapter {
  return serverConfig.mockMode ? mockRpcAdapter : realRpcAdapter;
}
