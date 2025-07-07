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
  EIP1193Provider
} from 'viem';
import { base } from 'viem/chains';
import { getReferralTag, submitReferral } from '@divvi/referral-sdk';
import { Button } from "./Button";
import { Icon } from "./Icon";
import { sdk } from '@farcaster/frame-sdk'

interface User {
  walletAddress: string;
  isActivated: boolean;
}

interface CreateProps {
  setActiveTabAction: (tab: string) => void;
}

export const Create: React.FC<CreateProps> = ({ setActiveTabAction }) => {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [accountCreated, setAccountCreated] = useState(false);
  const [hasUnactivatedAccount, setHasUnactivatedAccount] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [isCheckingAccount, setIsCheckingAccount] = useState(true);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [showCreatedModal, setShowCreatedModal] = useState(false);
  const [showActivatedModal, setShowActivatedModal] = useState(false);

  useEffect(() => {
    const checkExistingAccount = async () => {
      if (!address) {
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
      } finally {
        setIsCheckingAccount(false);
      }
    };

    checkExistingAccount();
  }, [address]);

  const handleCreateAccount = async () => {
    if (!address) {
      alert('Please connect your wallet');
      return;
    }

    setIsCreatingAccount(true);

    try {

      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'createAccount',
        args: [address]
      });

      let txHash: `0x${string}`;

      try {
        if (typeof window === 'undefined' || !window.ethereum) {
          throw new Error('Ethereum provider not found');
        }

        // Step 1: Create a wallet client and get the account
        const walletClient = createWalletClient({
          chain: base,
          transport: custom(window.ethereum),
        });
        const [account] = await walletClient.getAddresses();

        // Step 2: Generate a referral tag for the user
        const referralTag = getReferralTag({
          user: account, // The user address making the transaction
          consumer: '0xaF108Dd1aC530F1c4BdED13f43E336A9cec92B44', // Your Divvi Identifier
        });

        // Step 3: Send the transaction with referral tag
        txHash = await walletClient.sendTransaction({
          account,
          to: ENB_MINI_APP_ADDRESS as `0x${string}`,
          data: (baseTxData + referralTag) as `0x${string}`,
        });

        // Step 4: Get the chain ID of the chain that the transaction was sent to
        const chainId = await walletClient.getChainId();

        // Step 5: Report the transaction to Divvi
        await submitReferral({
          txHash,
          chainId,
        });

        console.log('Divvi referral submitted for account creation');
      } catch (referralError) {
        console.warn('Referral setup failed:', referralError);
        
        // Fallback to regular transaction without referral
        if (window.ethereum) {
          const txParams = {
            from: address as `0x${string}`,
            to: ENB_MINI_APP_ADDRESS as `0x${string}`,
            data: baseTxData,
            gas: `0x${BigInt(100000).toString(16)}` as `0x${string}`
          };

          txHash = await (window.ethereum as EIP1193Provider).request({
            method: 'eth_sendTransaction',
            params: [txParams]
          }) as `0x${string}`;
        } else {
          txHash = await writeContractAsync({
            address: ENB_MINI_APP_ADDRESS,
            abi: ENB_MINI_APP_ABI,
            functionName: 'createAccount',
            args: [address]
          }) as `0x${string}`;
        }
      }

      const backendResponse = await fetch(`${API_BASE_URL}/api/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, transactionHash: txHash })
      });

      if (!backendResponse.ok) throw new Error('Backend sync failed');

      setShowCreatedModal(true);
      setAccountCreated(true);
      setHasUnactivatedAccount(true);
    } catch (error) {
      console.error('Account creation failed:', error);
      alert('Failed to create account');
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleCreatedWarpcastShare = async () => {
    await sdk.actions.composeCast({
      text: "I just created my $ENB mining account. I am looking for an account activation code",
      embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
    });
  };

  const handleActivatedWarpcastShare = async () => {
    await sdk.actions.composeCast({
      text: "I Just Activated My Base Layer Account. I am now earning $ENB everyday! Join me",
      embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
    });
  };

  const handleActivateAccount = async (e: FormEvent) => {
    e.preventDefault();

    if (!address || !activationCode.trim()) {
      alert('Enter a valid invitation code');
      return;
    }

    setIsActivating(true);
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
      if (!response.ok) throw new Error(data.error || 'Activation failed');

      setShowActivatedModal(true);
      setAccountCreated(true);
      setHasUnactivatedAccount(false);
    } catch (error) {
      console.error('Activation failed:', error);
      alert(error instanceof Error ? error.message : 'Activation failed');
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

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold">Welcome To ENB Mini App</h1>

      {!accountCreated && !hasUnactivatedAccount && (
        <div className="space-y-4">
          <p>Create your mining account to start earning ENB.</p>
          <button
            onClick={handleCreateAccount}
            disabled={isCreatingAccount}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {isCreatingAccount ? 'Creating Account...' : 'Create Mining Account'}
          </button>
        </div>
      )}

      {hasUnactivatedAccount && (
        <div className="space-y-4">
          <p>Activate your account using an invitation code.</p>
          <form onSubmit={handleActivateAccount} className="space-y-4">
            <input
              type="text"
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              placeholder="Enter invitation code"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isActivating}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {isActivating ? 'Activating...' : 'Activate Account'}
            </button>
          </form>
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
                Your mining account has been created successfully.
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setShowCreatedModal(false)}>
                Dismiss
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
                Account has been activated!
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Your account has been activated successfully.
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => {
                setShowActivatedModal(false);
                setActiveTabAction("account");
              }}>
                Continue
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
}
