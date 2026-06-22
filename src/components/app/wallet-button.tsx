"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LogOut, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { shortenAddress } from "@/lib/utils/format";

function isReadyStateConnectable(readyState?: string) {
  return readyState === "Installed" || readyState === "Loadable";
}

function readinessMessage(walletName: string, readyState?: string) {
  if (readyState === "Unsupported") {
    return `${walletName} is not supported in this browser.`;
  }

  return `${walletName} is not detected in this browser. Install or enable the wallet extension, then select it again.`;
}

export function RangeGuardWalletButton() {
  const { connected, connecting, publicKey, wallet, connect, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const mounted = useMounted();
  const [message, setMessage] = useState<string | null>(null);

  const readyState = mounted && wallet?.adapter.readyState ? String(wallet.adapter.readyState) : undefined;
  const canConnectSelectedWallet = Boolean(mounted && wallet && isReadyStateConnectable(readyState));

  async function handleClick() {
    setMessage(null);

    if (!mounted) return;

    if (connected) {
      await disconnect();
      return;
    }

    if (!wallet || !canConnectSelectedWallet) {
      if (wallet) {
        setMessage(readinessMessage(wallet.adapter.name, readyState));
      }
      setVisible(true);
      return;
    }

    try {
      await connect();
    } catch {
      setMessage(readinessMessage(wallet.adapter.name, readyState));
      setVisible(true);
    }
  }

  const label =
    mounted && connected && publicKey
      ? shortenAddress(publicKey.toBase58(), 5)
      : mounted && connecting
        ? "Connecting"
        : canConnectSelectedWallet
          ? `Connect ${wallet?.adapter.name}`
          : "Select Wallet";

  return (
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
      <Button onClick={handleClick} variant={connected ? "secondary" : "default"} className="w-full sm:w-auto">
        {connected ? <LogOut className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
        {label}
      </Button>
      {mounted && message ? (
        <p className="max-w-[320px] text-left text-xs leading-5 text-[#b42318] sm:text-right">
          {message}
        </p>
      ) : null}
    </div>
  );
}
