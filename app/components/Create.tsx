'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { ENB_MINI_APP_ABI, ENB_MINI_APP_ADDRESS } from '../constants/enbMiniAppAbi';
import { API_BASE_URL } from '../config';
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  custom,
  EIP1193Provider,
  Hash,
  WalletClient
} from 'viem';
import { base } from 'viem/chains';
import { getReferralTag, submitReferral } from '@divvi/referral-sdk';
import { Button } from "./Button";
import { Icon } from "./Icon";
import { sdk } from '@farcaster/frame-sdk';

// Updated Divvi configuration with proper typing for v2
const DIVVI_CONFIG = {
  consumer: '0xaF108Dd1aC530F1c4BdED13f43E336A9cec92B44' as `0x${string}`,
  providers: [
    '0x0423189886d7966f0dd7e7d256898daeee625dca' as `0x${string}`,
    '0xc95876688026be9d6fa7a7c33328bd013effa2bb' as `0x${string}`
  ]
} as const;

interface User {
  walletAddress: string;
  isActivated: boolean;
}

interface CreateProps {
  setActiveTabAction: (tab: string) => void;
}

interface DivviReferralData {
  referralTag: string;
  walletClient: WalletClient;
  chainId: number;
}

export const Create: React.FC<CreateProps> = ({ setActiveTabAction }) => {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [accountCreated, setAccountCreated] = useState(false);
  const [hasUnactivatedAccount, setHasUnactivatedAccount] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [isCheckingAccount, setIsCheckingAccount] = useState(true);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [showCreatedModal, setShowCreatedModal] = useState(false);
  const [showActivatedModal, setShowActivatedModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkExistingAccount = async () => {
      if (!address || !isConnected) {
        setIsCheckingAccount(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/users?limit=1000`);
        if (!response.ok) throw new Error('Failed to fetch users');

        const data = await response.json();
        const user = data.users.find((u: User) =>
          u.walletAddress.toLowerCase() === address.toLowerCase()
        );

        if (user) {
          if (user.isActivated) {
            setAccountCreated(true);
          } else {
            setHasUnactivatedAccount(true);
          }
        }
      } catch (error) {
        console.error('Error checking account:', error);
        setError('Failed to check account status');
      } finally {
        setIsCheckingAccount(false);
      }
    };

    checkExistingAccount();
  }, [address, isConnected]);

  // Updated setupDivviReferral for v2 - now requires user parameter
  const setupDivviReferral = async (): Promise<DivviReferralData | null> => {
    try {
      if (!address || typeof window === 'undefined' || !window.ethereum) {
        console.warn('Missing requirements for Divvi referral setup');
        return null;
      }

      const ethereum = window.ethereum as EIP1193Provider;
      
      const walletClient = createWalletClient({
        chain: base,
        transport: custom(ethereum)
      });

      const chainId = await walletClient.getChainId();

      // v2 Migration: getReferralTag now requires user parameter for proper attribution
      const referralTag = getReferralTag({
        user: address, // Required in v2 for proper referral attribution
        consumer: DIVVI_CONFIG.consumer,
        providers: DIVVI_CONFIG.providers
      });

      console.log('Divvi referral setup successful with v2 SDK');
      return { referralTag, walletClient, chainId };
    } catch (error) {
      console.warn('Divvi referral setup failed:', error);
      return null;
    }
  };

  const submitDivviReferral = async (
    divviData: DivviReferralData,
    txHash: Hash
  ) => {
    try {
      await submitReferral({ 
        txHash, 
        chainId: divviData.chainId 
      });
      console.log('Divvi referral submitted successfully');
    } catch (error) {
      console.warn('Divvi referral submission failed:', error);
    }
  };

  const handleCreateAccount = async () => {
    if (!address || !isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    setIsCreatingAccount(true);
    setError(null);

    try {
      const publicClient = createPublicClient({ 
        chain: base, 
        transport: http() 
      });

      // Setup Divvi referral with v2 SDK
      const divviData = await setupDivviReferral();

      // Prepare transaction data
      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'createAccount',
        args: [address]
      });

      // v2 Migration: referralTag is now properly formatted for dataSuffix
      const finalTxData = divviData 
        ? (baseTxData + divviData.referralTag.slice(2)) as `0x${string}` // Remove '0x' prefix to avoid duplication
        : baseTxData;

      // Estimate gas
      let gasEstimate: bigint;
      try {
        gasEstimate = await publicClient.estimateGas({
          account: address,
          to: ENB_MINI_APP_ADDRESS,
          data: finalTxData
        });
        // Add 20% buffer for gas estimation
        gasEstimate = gasEstimate + (gasEstimate * BigInt(20)) / BigInt(100);
      } catch (error) {
        console.warn('Gas estimation failed, using fallback:', error);
        gasEstimate = BigInt(150000); // Increased fallback
      }

      // Execute transaction
      let txHash: Hash;
      
      if (window.ethereum) {
        txHash = await (window.ethereum as EIP1193Provider).request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: ENB_MINI_APP_ADDRESS as `0x${string}`,
            data: finalTxData,
            gas: `0x${gasEstimate.toString(16)}` as `0x${string}`
          }]
        }) as Hash;
      } else {
        // Fallback to wagmi writeContract if no direct ethereum access
        txHash = await writeContractAsync({
          address: ENB_MINI_APP_ADDRESS,
          abi: ENB_MINI_APP_ABI,
          functionName: 'createAccount',
          args: [address],
          // Note: dataSuffix not directly supported in wagmi, would need custom implementation
        });
      }

      // Submit Divvi referral if setup was successful
      if (divviData && txHash) {
        await submitDivviReferral(divviData, txHash);
      }

      // Sync with backend
      const backendResponse = await fetch(`${API_BASE_URL}/api/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          walletAddress: address, 
          transactionHash: txHash 
        })
      });

      if (!backendResponse.ok) {
        const errorData = await backendResponse.json();
        throw new Error(errorData.error || 'Backend sync failed');
      }

      setShowCreatedModal(true);
      setAccountCreated(true);
      setHasUnactivatedAccount(true);
    } catch (error) {
      console.error('Account creation failed:', error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to create account';
      setError(errorMessage);
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleCreatedWarpcastShare = async () => {
    try {
      await sdk.actions.composeCast({
        text: "I just created my $ENB mining account. I am looking for an account activation code",
        embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
      });
    } catch (error) {
      console.error('Failed to share on Farcaster:', error);
    }
  };

  const handleActivatedWarpcastShare = async () => {
    try {
      await sdk.actions.composeCast({
        text: "I Just Activated My Base Layer Account. I am now earning $ENB everyday! Join me",
        embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
      });
    } catch (error) {
      console.error('Failed to share on Farcaster:', error);
    }
  };

  const handleActivateAccount = async (e: FormEvent) => {
    e.preventDefault();

    if (!address || !activationCode.trim()) {
      setError('Please enter a valid invitation code');
      return;
    }

    setIsActivating(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/activate-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          invitationCode: activationCode.trim()
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Activation failed');
      }

      setShowActivatedModal(true);
      setAccountCreated(true);
      setHasUnactivatedAccount(false);
      setActivationCode('');
    } catch (error) {
      console.error('Activation failed:', error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Activation failed';
      setError(errorMessage);
    } finally {
      setIsActivating(false);
    }
  };

  if (isCheckingAccount) {
    return (
      <div className="space-y-6 text-center animate-fade-in">
        <h1 className="text-xl font-bold">Welcome To ENB Mini App</h1>
        <p className="text-gray-600">Checking your account status...</p>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="space-y-6 text-center animate-fade-in">
        <h1 className="text-xl font-bold">Welcome To ENB Mini App</h1>
        <p className="text-gray-600">Please connect your wallet to continue</p>
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800">
            Connect your wallet to create a mining account and start earning ENB.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold">Welcome To ENB Mini App</h1>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {!accountCreated && !hasUnactivatedAccount && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-medium text-blue-900 mb-2">Create Mining Account</h3>
            <p className="text-blue-800">
              Create your mining account to start earning ENB. This will:
            </p>
            <ul className="mt-2 text-blue-800 text-sm space-y-1">
              <li>• Register your wallet with the ENB protocol</li>
           
              <li>• Require activation with an invitation code</li>
            </ul>
          </div>
          
          <button
            onClick={handleCreateAccount}
            disabled={isCreatingAccount}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCreatingAccount ? 'Creating Account...' : 'Create Mining Account'}
          </button>
        </div>
      )}

      {hasUnactivatedAccount && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h3 className="font-medium text-amber-900 mb-2">Account Activation Required</h3>
            <p className="text-amber-800">
              Your account has been created but needs activation. Enter your invitation code below.
            </p>
          </div>
          
          <form onSubmit={handleActivateAccount} className="space-y-4">
            <input
              type="text"
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              placeholder="Enter invitation code"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isActivating}
            />
            <button
              type="submit"
              disabled={isActivating || !activationCode.trim()}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isActivating ? 'Activating...' : 'Activate Account'}
            </button>
          </form>
        </div>
      )}

      {accountCreated && !hasUnactivatedAccount && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-medium text-green-900 mb-2">Account Active</h3>
          <p className="text-green-800">
            Your mining account is active and earning ENB!
          </p>
        </div>
      )}

      {/* Created Modal */}
      {showCreatedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Account Created Successfully
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Your mining account has been created.
                You&apos;ll need an activation code to start earning.
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setShowCreatedModal(false)}>
                Continue
              </Button>
              <Button onClick={handleCreatedWarpcastShare} variant="outline">
                Share on Farcaster
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Activated Modal */}
      {showActivatedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Account Activated Successfully!
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Your account is now active and earning ENB.
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => {
                setShowActivatedModal(false);
                setActiveTabAction("account");
              }}>
                Continue to Account
              </Button>
              <Button onClick={handleActivatedWarpcastShare} variant="outline">
                Share on Farcaster
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};