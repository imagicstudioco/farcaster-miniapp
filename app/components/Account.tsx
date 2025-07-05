'use client';

import { useState, useEffect, useCallback } from 'react';
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

const DIVVI_CONFIG = {
  consumer: '0xaF108Dd1aC530F1c4BdED13f43E336A9cec92B44',
  providers: [
    '0x0423189886d7966f0dd7e7d256898daeee625dca',
    '0xc95876688026be9d6fa7a7c33328bd013effa2bb'
  ]
};

interface UserProfile {
  walletAddress: string;
  membershipLevel: 'Based' | 'Super Based' | 'Legendary' | string;
  invitationCode: string | null;
  invitationUsage?: {
    totalUses: number;
    maxUses: number;
    remainingUses: number;
  } | null;
  enbBalance: number;
  lastDailyClaimTime?: string | null;
  consecutiveDays: number;
  totalEarned: number;
  joinDate?: string;
  isActivated: boolean;
}

interface AccountProps {
  setActiveTabAction: (tab: string) => void;
}

export const Account: React.FC<AccountProps> = ({ setActiveTabAction }) => {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [showDailyClaimModal, setShowDailyClaimModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showBoosterModal, setShowBoosterModal] = useState(false);
  const [showInformationModal, setInformationModal] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [dailyClaimLoading, setDailyClaimLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Countdown state
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  }>({ hours: 0, minutes: 0, seconds: 0 });
  const [canClaim, setCanClaim] = useState(false);

  const getMembershipLevelColor = (level: string) => {
    switch (level) {
      case 'Based': return 'text-blue-600';
      case 'Super Based': return 'text-purple-600';
      case 'Legendary': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  };

  const formatWalletAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Calculate time remaining until next daily claim
  const calculateTimeLeft = useCallback((lastDailyClaimTime: string | null) => {
    if (!lastDailyClaimTime) {
      setCanClaim(true);
      setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
      return;
    }

    const lastClaim = new Date(lastDailyClaimTime);
    const nextClaim = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000); // Add 24 hours
    const now = new Date();
    const timeDiff = nextClaim.getTime() - now.getTime();

    if (timeDiff <= 0) {
      setCanClaim(true);
      setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
    } else {
      setCanClaim(false);
      const hours = Math.floor(timeDiff / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
      setTimeLeft({ hours, minutes, seconds });
    }
  }, []);

  // Update countdown every second
  useEffect(() => {
    if (!profile?.lastDailyClaimTime) return;

    const interval = setInterval(() => {
      calculateTimeLeft(profile.lastDailyClaimTime || null);
    }, 1000);

    return () => clearInterval(interval);
  }, [profile?.lastDailyClaimTime, calculateTimeLeft]);

  const checkAccountStatus = useCallback(async () => {
    if (!address) {
      setError('No wallet connected');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(`${API_BASE_URL}/api/profile/${address}`);
      
      if (res.status === 404) {
        // Account doesn't exist, show create message
        setProfile(null);
        setError('not_created');
        setLoading(false);
        return;
      }
      
      if (!res.ok) {
        throw new Error('Failed to fetch profile');
      }

      const userProfile: UserProfile = await res.json();
      
      // Check if account is not activated
      if (!userProfile.isActivated) {
        // Account exists but not activated, show activation message
        setProfile(userProfile);
        setError('not_activated');
        setLoading(false);
        return;
      }

      // Account exists and is activated, show profile
      setProfile(userProfile);
      // Calculate initial countdown
      calculateTimeLeft(userProfile.lastDailyClaimTime || null);
    } catch (err) {
      console.error('Error checking account status:', err);
      setError('Failed to load account information');
    } finally {
      setLoading(false);
    }
  }, [address, calculateTimeLeft]);

  const refreshProfile = async () => {
    if (!address) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/profile/${address}`);
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
        calculateTimeLeft(updated.lastDailyClaimTime || null);
      }
    } catch (err) {
      console.error('Error refreshing profile:', err);
    }
  };

  const handleDailyClaim = async () => {
    if (!address || !canClaim) return;

    setDailyClaimLoading(true);
    try {
      const publicClient = createPublicClient({ chain: base, transport: http() });

      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'dailyClaim',
        args: [address]
      });

      let finalTxData = baseTxData;
      let referralTag = '';
      let walletClient = null;

      try {
        if (typeof window === 'undefined' || !window.ethereum) {
          throw new Error('Ethereum provider not found');
        }

        const ethereum = window.ethereum as EIP1193Provider;

        walletClient = createWalletClient({
          chain: base,
          transport: custom(ethereum)
        });

        referralTag = getReferralTag({
          user: address as `0x${string}`,
          consumer: DIVVI_CONFIG.consumer as `0x${string}`,
          providers: DIVVI_CONFIG.providers as `0x${string}`[]
        });

        finalTxData = (baseTxData + referralTag) as `0x${string}`;
        console.log('Divvi referral tag added to daily claim transaction');
      } catch (referralError) {
        console.warn('Referral setup failed for daily claim:', referralError);
      }

      let gasEstimate;
      try {
        gasEstimate = await publicClient.estimateGas({
          account: address,
          to: ENB_MINI_APP_ADDRESS,
          data: finalTxData
        });
      } catch {
        gasEstimate = BigInt(100000); // fallback
      }

      let txHash: `0x${string}`;

      if (window.ethereum) {
        const txParams = {
          from: address as `0x${string}`,
          to: ENB_MINI_APP_ADDRESS as `0x${string}`,
          data: finalTxData,
          gas: `0x${gasEstimate.toString(16)}` as `0x${string}`
        };

        txHash = await (window.ethereum as EIP1193Provider).request({
          method: 'eth_sendTransaction',
          params: [txParams]
        }) as `0x${string}`;
      } else {
        txHash = await writeContractAsync({
          address: ENB_MINI_APP_ADDRESS,
          abi: ENB_MINI_APP_ABI,
          functionName: 'dailyClaim',
          args: [address]
        }) as `0x${string}`;
      }

      if (walletClient && referralTag && txHash) {
        try {
          const chainId = await walletClient.getChainId();
          await submitReferral({ txHash, chainId });
          console.log('Divvi referral submitted for daily claim');
        } catch (referralError) {
          console.warn('Referral submission failed for daily claim:', referralError);
        }
      }

      // Then submit to the API endpoint with transaction hash
      const res = await fetch(`${API_BASE_URL}/api/daily-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          walletAddress: address,
          transactionHash: txHash 
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Daily claim failed');

      setShowDailyClaimModal(true);
      await refreshProfile();
    } catch (err) {
      console.error(err);
      alert('Daily claim failed. Please try again.');
    } finally {
      setDailyClaimLoading(false);
    }
  };

  const handleDailyClaimWarpcastShare = async () => {
    await sdk.actions.composeCast({
      text: `I just claimed my daily $ENB rewards! Join me and start earning now! ${profile?.invitationCode}`,
      embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
    });
  };

  const handleUpgradeWarpcastShare = async () => {
    await sdk.actions.composeCast({
      text: "I just upgraded my mining account to increase my daily earnings! Join me and start earning NOW!",
      embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
    });
  };


  const handleInvitationCode = async () => {
    await sdk.actions.composeCast({
      text: `Use my invitation code to start earning $ENB and start earning now! ${profile?.invitationCode}`,
      embeds: ["https://farcaster.xyz/~/mini-apps/launch?domain=enb-crushers.vercel.app"]
    });
  };

  const url= "https://farcaster.xyz/kokocodes/0xfb0d3293";

  const handleBuyENB = async () => {
    await sdk.actions.openUrl(url)
      };

  const handleBooster = async () => {
    setShowBoosterModal(true);   
  };

  const handleInformation = async () => {
    setInformationModal(true);   
  };

  const handleUpgrade = async () => {
    if (!address || !profile) return;

    // Check consecutive days requirement
    const requiredDays = profile.membershipLevel === 'Based' ? 14 : 28;
    if (profile.consecutiveDays < requiredDays) {
      setUpgradeError(`You need ${requiredDays} consecutive days of daily claims to upgrade. You currently have ${profile.consecutiveDays} days.`);
      return;
    }

    let targetLevel: number;
    switch (profile.membershipLevel) {
      case 'Based': targetLevel = 1; break; // SuperBased = 1
      case 'Super Based': targetLevel = 2; break; // Legendary = 2
      default:
        alert('You are already at the highest level!');
        return;
    }

    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const publicClient = createPublicClient({ chain: base, transport: http() });

      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'upgradeMembership',
        args: [address, targetLevel]
      });

      let finalTxData = baseTxData;
      let referralTag = '';
      let walletClient = null;

      try {
        if (typeof window === 'undefined' || !window.ethereum) {
          throw new Error('Ethereum provider not found');
        }

        const ethereum = window.ethereum as EIP1193Provider;

        walletClient = createWalletClient({
          chain: base,
          transport: custom(ethereum)
        });

        referralTag = getReferralTag({
          user: address as `0x${string}`,
          consumer: DIVVI_CONFIG.consumer as `0x${string}`,
          providers: DIVVI_CONFIG.providers as `0x${string}`[]
        });

        finalTxData = (baseTxData + referralTag) as `0x${string}`;
        console.log('Divvi referral tag added to upgrade transaction');
      } catch (referralError) {
        console.warn('Referral setup failed for upgrade:', referralError);
      }

      let gasEstimate;
      try {
        gasEstimate = await publicClient.estimateGas({
          account: address,
          to: ENB_MINI_APP_ADDRESS,
          data: finalTxData
        });
      } catch {
        gasEstimate = BigInt(100000); // fallback
      }

      let txHash: `0x${string}`;

      if (window.ethereum) {
        const txParams = {
          from: address as `0x${string}`,
          to: ENB_MINI_APP_ADDRESS as `0x${string}`,
          data: finalTxData,
          gas: `0x${gasEstimate.toString(16)}` as `0x${string}`
        };

        txHash = await (window.ethereum as EIP1193Provider).request({
          method: 'eth_sendTransaction',
          params: [txParams]
        }) as `0x${string}`;
      } else {
        txHash = await writeContractAsync({
          address: ENB_MINI_APP_ADDRESS,
          abi: ENB_MINI_APP_ABI,
          functionName: 'upgradeMembership',
          args: [address, targetLevel]
        }) as `0x${string}`;
      }

      if (walletClient && referralTag && txHash) {
        try {
          const chainId = await walletClient.getChainId();
          await submitReferral({ txHash, chainId });
          console.log('Divvi referral submitted for upgrade');
        } catch (referralError) {
          console.warn('Referral submission failed for upgrade:', referralError);
        }
      }

      const res = await fetch(`${API_BASE_URL}/api/update-membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          membershipLevel: targetLevel === 1 ? 'Super Based' : 'Legendary',
          transactionHash: txHash,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upgrade failed');

      setShowUpgradeModal(true);
      await refreshProfile();
    } catch (err) {
      console.error(err);
      
      // Handle specific error types
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
        setUpgradeError('Insufficient ETH balance to cover gas fees. Please add some ETH to your wallet and try again.');
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User rejected')) {
        setUpgradeError('Transaction was cancelled by user.');
      } else if (errorMessage.includes('execution reverted')) {
        setUpgradeError('Transaction failed. You may not have enough ENB tokens or the upgrade requirements are not met.');
      } else if (errorMessage.includes('InsufficientTokensForUpgrade')) {
        setUpgradeError('You do not have enough ENB tokens in your wallet to upgrade. You need 5,000 ENB for Super Based or 15,000 ENB for Legendary.');
      } else if (errorMessage.includes('InvalidMembershipLevel')) {
        setUpgradeError('Invalid upgrade request. You may already be at the highest level.');
      } else {
        setUpgradeError(`Upgrade failed: ${errorMessage}`);
      }
    } finally {
      setUpgradeLoading(false);
    }
  };

  // Check account status when component mounts or address changes
  useEffect(() => {
    checkAccountStatus();
  }, [checkAccountStatus]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking account status...</p>
        </div>
      </div>
    );
  }

  // Error/Special states
  if (error === 'not_created') {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center max-w-md">
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-6 py-4 rounded-lg mb-6">
            <h2 className="text-lg font-semibold mb-2">Account Not Found</h2>
            <p>Your account has not been created. Please create an account to get started.</p>
          </div>
          <button
            onClick={() => setActiveTabAction('create')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Create Account
          </button>
        </div>
      </div>
    );
  }

  if (error === 'not_activated') {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center max-w-md">
          <div className="bg-orange-100 border border-orange-400 text-orange-700 px-6 py-4 rounded-lg mb-6">
            <h2 className="text-lg font-semibold mb-2">Account Not Activated</h2>
            <p>This account has not been activated. Please activate your account to continue.</p>
          </div>
          <button
            onClick={() => setActiveTabAction('create')}
            className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
          >
            Activate Account
          </button>
        </div>
      </div>
    );
  }

  if (error && error !== 'not_created' && error !== 'not_activated') {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p>{error}</p>
          </div>
          <button
            onClick={checkAccountStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // This should not render if profile is null due to redirects above
  if (!profile) {
    return null;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-semibold mb-2 text-gray-800">Account Profile</h1>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Basic Info */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Basic Information</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-600">Wallet Address</label>
              <p className="text-gray-800 font-mono">{formatWalletAddress(profile.walletAddress)}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Mining Level</label>
              <p className={`font-semibold ${getMembershipLevelColor(profile.membershipLevel)}`}>
                {profile.membershipLevel}
              </p>
            </div>
            {profile.invitationCode && (
              <div>
                <label className="text-sm font-medium text-gray-600">Activation Code</label>
                <p className="text-gray-800 font-mono">{profile.invitationCode}</p>
              </div>
            )}
            {profile.invitationUsage && (
              <div>
                <label className="text-sm font-medium text-gray-600">Invitation Usage</label>
                <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Total Users Activated:</span>
                    <span className="font-semibold text-blue-600">{profile.invitationUsage.totalUses}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Remaining Uses:</span>
                    <span className="font-semibold text-green-600">{profile.invitationUsage.remainingUses}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Max Uses:</span>
                    <span className="font-semibold text-gray-800">{profile.invitationUsage.maxUses}</span>
                  </div>
                </div>
              </div>
            )}
            <div>
              <div className="space-y-3">
                <button
                  onClick={handleInvitationCode}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
                >
                  Share Invitation Code
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Status</label>
              <p className={`font-semibold ${profile.isActivated ? 'text-green-600' : 'text-orange-600'}`}>
                {profile.isActivated ? 'Activated' : 'Not Activated'}
              </p>
            </div>
          </div>
        </div>

        {/* Token Info */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Token Balance</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-600">Total Earned</label>
              <p className="text-lg font-semibold text-blue-600">
                {profile.totalEarned.toLocaleString()} ENB
              </p>
            </div>
            <div>
            <button
              onClick={handleInformation}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              How To Earn
            </button>
            </div>
          </div>
        </div>

        {/* Activity Info */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Mining Activity</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-600">Consecutive Days</label>
              <p className="text-lg font-semibold text-purple-600">
                {profile.consecutiveDays} days
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Last Daily Claim</label>
              <p className="text-gray-800">
                {profile.lastDailyClaimTime ? formatDate(profile.lastDailyClaimTime) : 'Never'}
              </p>
            </div>
            {profile.joinDate && (
              <div>
                <label className="text-sm font-medium text-gray-600">Join Date</label>
                <p className="text-gray-800">{formatDate(profile.joinDate)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Invitation Statistics */}
        {profile.invitationUsage && (
          <div className="bg-white p-6 rounded-lg shadow-md border">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Invitation Statistics</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{profile.invitationUsage.totalUses}</div>
                  <div className="text-sm text-gray-600">Total Users</div>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{profile.invitationUsage.remainingUses}</div>
                  <div className="text-sm text-gray-600">Remaining</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-gray-800">{profile.invitationUsage.maxUses}</div>
                  <div className="text-sm text-gray-600">Max Uses</div>
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Progress</div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(profile.invitationUsage.totalUses / profile.invitationUsage.maxUses) * 100}%` }}
                  ></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {profile.invitationUsage.totalUses} of {profile.invitationUsage.maxUses} uses
                </div>
              </div>
              <button
                disabled={true}
                className="w-full px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed disabled:opacity-60"
              >
                Claim $ENB for your invites
              </button>
            </div>
          </div>
        )}

        {/* Daily Claim Actions */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Daily Claim</h2>
          <div className="space-y-4">
            {/* Countdown Timer */}
            {!canClaim && (
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600 mb-2">Next claim available in:</div>
                <div className="text-2xl font-bold text-gray-800 font-mono">
                  {String(timeLeft.hours).padStart(2, '0')}:
                  {String(timeLeft.minutes).padStart(2, '0')}:
                  {String(timeLeft.seconds).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 mt-1">HH:MM:SS</div>
              </div>
            )}

            {/* Claim Available Message */}
            {canClaim && profile.lastDailyClaimTime && (
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-sm text-green-600 font-medium">
                  ✓ Daily claim is now available!
                </div>
              </div>
            )}

            {/* First Time Claim Message */}
            {canClaim && !profile.lastDailyClaimTime && (
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">
                  🎉 Ready for your first daily claim!
                </div>
              </div>
            )}

            <button
              disabled={dailyClaimLoading || !profile.isActivated || !canClaim}
              onClick={handleDailyClaim}
              className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                canClaim && profile.isActivated
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              } disabled:opacity-60`}
            >
              {dailyClaimLoading 
                ? 'Claiming...' 
                : canClaim 
                ? 'Claim Daily Rewards' 
                : 'Claim Unavailable'
              }
            </button>
          </div>
        </div>

        {/* Boosters*/}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Boosters</h2>
          <div className="space-y-3">
            <button
              onClick={handleBooster}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              Boosters
            </button>
          </div>
        </div>

        {/* Upgrade */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Upgrade</h2>
          <div className="space-y-3">
            {/* Helpful Note */}
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium">Upgrade Requirements</p>
                  <p className="text-sm mt-1">
                    • You need ETH in your wallet to pay for gas fees<br/>
                    • It will cost you ENB tokens to upgrade: 5,000 ENB for Super Based, 15,000 ENB for Legendary<br/>
                    • Based → Super Based: {profile.membershipLevel === 'Based' ? `${profile.consecutiveDays}/14` : '14/14'} consecutive days<br/>
                    • Super Based → Legendary: {profile.membershipLevel === 'Super Based' ? `${profile.consecutiveDays}/28` : '28/28'} consecutive days
                  </p>
                </div>
              </div>
            </div>
            
            {/* Upgrade Error Display */}
            {upgradeError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium">{upgradeError}</p>
                  </div>
                  <div className="ml-auto pl-3">
                    <button
                      onClick={() => setUpgradeError(null)}
                      className="inline-flex text-red-400 hover:text-red-600"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {(() => {
              const requiredDays = profile.membershipLevel === 'Based' ? 14 : profile.membershipLevel === 'Super Based' ? 28 : 0;
              const canUpgrade = profile.membershipLevel !== 'Legendary' && profile.consecutiveDays >= requiredDays;
              
              return (
                <button
                  disabled={upgradeLoading || !canUpgrade}
                  onClick={handleUpgrade}
                  className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                    canUpgrade && !upgradeLoading
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  } disabled:opacity-60`}
                >
                  {upgradeLoading 
                    ? 'Upgrading...' 
                    : !canUpgrade 
                    ? `Need ${requiredDays} consecutive days (${profile.consecutiveDays}/${requiredDays})`
                    : 'Upgrade Mining Level'
                  }
                </button>
              );
            })()}
          </div>
          <br />
          <div className="space-y-3">
            <button
              onClick={handleBuyENB}
              className="w-full px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-60"
            >
              Buy $ENB
            </button>
          </div>
        </div>
      </div>

      {/* Daily Claim Modal */}
      {showDailyClaimModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Daily Claim Successful
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                You have successfully claimed your daily rewards. Come back tomorrow to claim again!
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setShowDailyClaimModal(false)}>
                Dismiss
              </Button>
              <Button onClick={handleDailyClaimWarpcastShare} variant="outline">
                Share on Farcaster
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Account Upgrade Successful
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Your account has been upgraded successfully. Your daily claim yield has increased!
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setShowUpgradeModal(false)}>
                Dismiss
              </Button>
              <Button onClick={handleUpgradeWarpcastShare} variant="outline">
                Share on Farcaster
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Booster Modal */}
      {showBoosterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Get Boosters (Coming Soon)
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Boosters allow you to reduce the time between daily claims. Watch this space!
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setShowBoosterModal(false)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

{/* Level Information Modal */}
{showInformationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Icon name="check" size="lg" className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                How To Earn
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                On the Base Layer there are 3 levels to earn and each level has the daily earning
              </p>
		<ul className="text-left space-y-2 mt-3">
		  <li>• <strong>Based</strong> - On this level (the first level) you earn 5 $ENB a day</li>
		  <li>• <strong>Super Based</strong> - As a Super Based member you earn 10 $ENB. To upgrade to Super Based you need:
		    <ul className="ml-4 mt-1 space-y-1">
		      <li>- 5,000 $ENB in your wallet</li>
		      <li>- 14 consecutive days of daily claims</li>
		    </ul>
		  </li>
		  <li>• <strong>Legendary</strong> - The Legendary is the highest level allowing you to earn 15 $ENB everyday. To upgrade to Legendary you need:
		    <ul className="ml-4 mt-1 space-y-1">
		      <li>- 15,000 $ENB in your wallet</li>
		      <li>- 28 consecutive days of daily claims</li>
		    </ul>
		  </li>
		</ul>
            </div>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => setInformationModal(false)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};