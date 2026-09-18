import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { Wallet } from "lucide-react";
import { shortHex } from "../lib/contract";
import { useI18n } from "../i18n";

export default function WalletBar() {
  const { t } = useI18n();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected || !address) {
    const connector = connectors[0];
    return (
      <button className="btn" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
        <Wallet size={14} /> <span className="btn-text">{isPending ? t("header.connecting") : t("header.connect")}</span>
      </button>
    );
  }

  return (
    <div className="wallet">
      {chainId !== baseSepolia.id && (
        <button className="btn warn" disabled={switching} onClick={() => switchChain({ chainId: baseSepolia.id })}>
          {t("header.switch")}
        </button>
      )}
      <span className="pill ok" title={address}>
        {shortHex(address, 4)}
      </span>
      <button className="btn ghost" onClick={() => disconnect()}>
        {t("header.disconnect")}
      </button>
    </div>
  );
}
