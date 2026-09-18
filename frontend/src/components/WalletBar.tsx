import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { shortHex } from "../lib/contract";

export default function WalletBar() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected || !address) {
    const connector = connectors[0];
    return (
      <button className="btn" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div className="wallet">
      {chainId !== baseSepolia.id && (
        <button className="btn warn" disabled={switching} onClick={() => switchChain({ chainId: baseSepolia.id })}>
          Switch to Base Sepolia
        </button>
      )}
      <span className="mono" title={address}>
        {shortHex(address)}
      </span>
      <button className="btn ghost" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
