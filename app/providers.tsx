"use client";

import { type ReactNode } from "react";
import { base } from "wagmi/chains";
import { MiniKitProvider } from "@coinbase/onchainkit/minikit";
import { farcasterFrame as miniAppConnector } from '@farcaster/frame-wagmi-connector';
import { http, createConfig, WagmiProvider } from 'wagmi';
import { FrameProvider } from './farcaster-provider';

const config = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [
    miniAppConnector()
  ]
});

export function Providers(props: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <MiniKitProvider
        apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY}
        chain={base}
        config={{
          appearance: {
            mode: "auto",
            theme: "mini-app-theme",
            name: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
            logo: process.env.NEXT_PUBLIC_ICON_URL,
          },
        }}
      >
        <FrameProvider>
          {props.children}
        </FrameProvider>
      </MiniKitProvider>
    </WagmiProvider>
  );
}
