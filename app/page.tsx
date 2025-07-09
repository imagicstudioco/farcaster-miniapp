'use client';

import { useEffect, useMemo, useState, useCallback } from "react";
import { Button } from "./components/Button";
import { Icon } from "./components/Icon";
import { Account } from "./components/Account";
import { Create } from "./components/Create";
import { Maintenance } from "./components/Maintenance";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from '@farcaster/frame-wagmi-connector';
import Image from "next/image";
import { sdk } from "@farcaster/miniapp-sdk";

export default function App() {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const [activeTab, setActiveTabAction] = useState("maintenance");
  const [miniAppAdded, setMiniAppAdded] = useState(false);
  const frameConnector = useMemo(() => farcasterFrame(), []);

  // Auto-connect wallet if not connected
  useEffect(() => {
    const autoConnect = async () => {
      if (!isConnected) {
        try {
          await connect({ connector: frameConnector });
        } catch (err: unknown) {
          if (err instanceof Error) {
            console.error("Auto-connect failed:", err.message);
          } else {
            console.error("Auto-connect failed with unknown error:", err);
          }
        }
      }
    };

    autoConnect();
  }, [isConnected, connect, frameConnector]);

  // Notify Warpcast that the app is ready
  useEffect(() => {
    try {
      sdk.actions.ready();
    } catch (err) {
      console.error("Failed to signal Mini App readiness:", err);
    }
  }, []);

  const handleAddMiniApp = useCallback(async () => {
    try {
      await sdk.actions.addMiniApp();
      setMiniAppAdded(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === "RejectedByUser") {
          console.warn("User rejected adding the Mini App");
        } else if (err.name === "InvalidDomainManifestJson") {
          console.error("Manifest JSON is invalid");
        } else {
          console.error("Unknown error adding Mini App:", err.message);
        }
      } else {
        console.error("Non-standard error occurred while adding Mini App:", err);
      }
    }
  }, []);

  const addButton = useMemo(() => {
    if (miniAppAdded) {
      return (
        <div className="flex items-center space-x-1 text-sm font-medium text-[#0052FF] animate-fade-out">
          <Icon name="check" size="sm" className="text-[#0052FF]" />
          <span>Added</span>
        </div>
      );
    }

    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleAddMiniApp}
        className="text-[var(--app-accent)] p-4"
        icon={<Icon name="plus" size="sm" />}
      >
        Add Mini App
      </Button>
    );
  }, [miniAppAdded, handleAddMiniApp]);

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="flex flex-col min-h-screen font-sans text-[var(--app-foreground)] mini-app-theme from-[var(--app-background)] to-[var(--app-gray)]">
      <header className="fixed top-0 left-0 right-0 bg-[var(--app-background)] border-b border-[var(--app-gray)] z-50">
        <div className="w-full max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Image
              src="/header-logo.png"
              alt="ENB Mini App Logo"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <h1 className="text-xl font-bold">ENB MINI APP</h1>
          </div>

          <div className="flex items-center space-x-2">{addButton}</div>

          {address && (
            <div className="flex items-center space-x-2">
              <div className="px-3 py-1.5 bg-[var(--app-gray)] rounded-full text-sm font-medium">
                {truncateAddress(address)}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="w-full max-w-md mx-auto px-4 py-3 pt-20">
        <main className="flex-1">
          {activeTab === "account" && <Account setActiveTabAction={setActiveTabAction} />}
          {activeTab === "create" && <Create setActiveTabAction={setActiveTabAction} />}
          {activeTab === "maintenance" && <Maintenance />}
        </main>

        <footer className="mt-2 pt-4 flex justify-center">ENB Mini App</footer>
      </div>
    </div>
  );
}
