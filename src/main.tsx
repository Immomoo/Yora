import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { DEFAULT_SHELBY_NETWORK, SHELBY_NETWORKS } from "./lib/shelby";
import type { ShelbyNetworkId } from "./types";
import "./styles.css";

const queryClient = new QueryClient();

function YoraRoot() {
  const [network, setNetwork] = React.useState<ShelbyNetworkId>(DEFAULT_SHELBY_NETWORK);
  const networkConfig = SHELBY_NETWORKS[network];
  const aptosApiKeys = {
    testnet: import.meta.env.VITE_APTOS_API_KEY,
    shelbynet: import.meta.env.VITE_SHELBYNET_APTOS_API_KEY ?? import.meta.env.VITE_APTOS_API_KEY,
  };

  return (
    <AptosWalletAdapterProvider
      key={network}
      autoConnect
      dappConfig={{
        network: networkConfig.aptosNetwork,
        aptosApiKeys,
      }}
      onError={(error) => console.error("Wallet adapter error", error)}
    >
      <App selectedNetwork={network} onNetworkChange={setNetwork} />
    </AptosWalletAdapterProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <YoraRoot />
    </QueryClientProvider>
  </React.StrictMode>,
);
