'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { ENB_MINI_APP_ABI, ENB_MINI_APP_ADDRESS, ENB_TOKEN_ABI, ENB_TOKEN_ADDRESS } from '../constants/enbMiniAppAbi';
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
import { useFrame } from '../farcaster-provider'

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

interface TipStep {
  id: string;
  title: string;
  description: string;
  targetElementId: string;
  highlightText: string;
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
  const [enbBalance, setEnbBalance] = useState<number>(0);
  const [enbBalanceLoading, setEnbBalanceLoading] = useState(false);
  const [inviteClaimLoading, setInviteClaimLoading] = useState(false);
const { context } = useFrame()  
  // Countdown state
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  }>({ hours: 0, minutes: 0, seconds: 0 });
  const [canClaim, setCanClaim] = useState(false);

  // Tips state
  const [showTipsModal, setShowTipsModal] = useState(false);
  const [currentTipStep, setCurrentTipStep] = useState(0);
  const [hasSeenTips, setHasSeenTips] = useState(false);

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

  // Define the tip steps
  const tipSteps: TipStep[] = [
    {
      id: 'daily-claim',
      title: 'Claim ENB Daily',
      description: 'Claim your daily ENB rewards here. The amount depends on your membership level: Based (10 ENB), Super Based (15 ENB), or Legendary (20 ENB). Come back every 24 hours to claim!',
      targetElementId: 'daily-claim-section',
      highlightText: 'Daily Claim'
    },
    {
      id: 'share-invitation',
      title: 'Share Your Invitation Code',
      description: 'Share your unique invitation code with friends to help them join the platform. Every person who uses your code helps grow the community!',
      targetElementId: 'basic-info-section',
      highlightText: 'Share Invitation Code'
    },
    {
      id: 'claim-invites',
      title: 'Claim Extra ENB For Invites',
      description: 'Earn bonus ENB tokens for each person who joins using your invitation code. Check your invitation statistics to see how many people you\'ve invited!',
      targetElementId: 'invitation-stats-section',
      highlightText: 'Claim $ENB for your invites'
    },
    {
      id: 'upgrade-level',
      title: 'Upgrade To A Higher Level',
      description: 'Upgrade your membership level to earn more daily ENB. You need consecutive daily claims and ENB tokens in your wallet. Higher levels = higher daily rewards!',
      targetElementId: 'upgrade-section',
      highlightText: 'Upgrade Mining Level'
    }
  ];

  // Add this function to check if user has seen tips (you can use localStorage or a user preference)
  const checkIfUserHasSeenTips = () => {
    try {
      const seen = localStorage.getItem('enb-tips-seen');
      return seen === 'true';
    } catch {
      return false;
    }
  };

  const markTipsAsSeen = () => {
    try {
      localStorage.setItem('enb-tips-seen', 'true');
    } catch {
      // Ignore localStorage errors
    }
  };

  // Function to scroll to specific elements
  const scrollToElement = (elementId: string) => {
    setTimeout(() => {
      const element = document.getElementById(elementId);
      if (element) {
        element.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'center'
        });
      }
    }, 100);
  };

  // Functions to handle the tips modal
  const handleNextTip = () => {
    if (currentTipStep < tipSteps.length - 1) {
      setCurrentTipStep(currentTipStep + 1);
      scrollToElement(tipSteps[currentTipStep + 1].targetElementId);
    }
  };

  const handlePreviousTip = () => {
    if (currentTipStep > 0) {
      setCurrentTipStep(currentTipStep - 1);
      scrollToElement(tipSteps[currentTipStep - 1].targetElementId);
    }
  };

  const handleFinishTips = () => {
    setShowTipsModal(false);
    setCurrentTipStep(0);
    markTipsAsSeen();
    setHasSeenTips(true);
  };

  const handleSkipTips = () => {
    setShowTipsModal(false);
    setCurrentTipStep(0);
    markTipsAsSeen();
    setHasSeenTips(true);
  };

  // Add a function to restart tips (optional - you can add a button for this)
  const handleRestartTips = () => {
    setCurrentTipStep(0);
    setShowTipsModal(true);
    scrollToElement(tipSteps[0].targetElementId);
  };

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

  const publicClient = useMemo(() => {
  return createPublicClient({ chain: base, transport: http() });
}, []);


const fetchEnbBalance = useCallback(async () => {
  if (!address) return;

  setEnbBalanceLoading(true);
  try {
    const balance = await publicClient.readContract({
      address: ENB_TOKEN_ADDRESS as `0x${string}`,
      abi: ENB_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`]
    });

    const balanceInEnb = Number(balance) / Math.pow(10, 18);
    setEnbBalance(balanceInEnb);
  } catch (err) {
    console.error('Error fetching ENB balance:', err);
    setEnbBalance(0);
  } finally {
    setEnbBalanceLoading(false);
  }
}, [address, publicClient]); // publicClient is now stable

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
      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'dailyClaim',
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

        console.log('Divvi referral submitted for daily claim');
      } catch (referralError) {
        console.warn('Referral setup failed for daily claim:', referralError);
        
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
          functionName: 'dailyClaim',
          args: [address]
        }) as `0x${string}`;
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
      await fetchEnbBalance(); // Refresh ENB balance after claim
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

  const handleClaimInvites = async () => {
    if (!address || !profile?.invitationUsage || profile.invitationUsage.totalUses < 5) return;

    setInviteClaimLoading(true);
    try {
      
      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'claimForInvite',
        args: [address, BigInt(25 * Math.pow(10, 18))] // 25 ENB in wei
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

        console.log('Divvi referral submitted for invite claim');
      } catch (referralError) {
        console.warn('Referral setup failed for invite claim:', referralError);
        
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
            functionName: 'claimForInvite',
            args: [address, BigInt(25 * Math.pow(10, 18))]
          }) as `0x${string}`;
        }
      }

      // Refresh profile and ENB balance after successful claim
      await refreshProfile();
      await fetchEnbBalance();
      
      // Show success message
      alert('Successfully claimed 25 ENB for your invites!');
    } catch (err) {
      console.error('Invite claim failed:', err);
      
      // Handle specific error types
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
        alert('Insufficient ETH balance to cover gas fees. Please add some ETH to your wallet and try again.');
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User rejected')) {
        alert('Transaction was cancelled by user.');
      } else if (errorMessage.includes('execution reverted')) {
        alert('Transaction failed. You may not be eligible to claim invites or the contract requirements are not met.');
      } else {
        alert(`Invite claim failed: ${errorMessage}`);
      }
    } finally {
      setInviteClaimLoading(false);
    }
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
      
      const baseTxData = encodeFunctionData({
        abi: ENB_MINI_APP_ABI,
        functionName: 'upgradeMembership',
        args: [address, targetLevel]
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

        console.log('Divvi referral submitted for upgrade');
      } catch (referralError) {
        console.warn('Referral setup failed for upgrade:', referralError);
        
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
          functionName: 'upgradeMembership',
          args: [address, targetLevel]
        }) as `0x${string}`;
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
      await fetchEnbBalance(); // Refresh ENB balance after upgrade
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

  // Fetch ENB balance when address changes
  useEffect(() => {
    if (address) {
      fetchEnbBalance();
    }
  }, [address, fetchEnbBalance]);

  // Add this useEffect to show tips on first load
  useEffect(() => {
    if (profile && profile.isActivated) {
      const hasSeenTipsBefore = checkIfUserHasSeenTips();
      if (!hasSeenTipsBefore) {
        setShowTipsModal(true);
        setHasSeenTips(false);
      } else {
        setHasSeenTips(true);
      }
    }
  }, [profile]);

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

  // Tips Modal Component
  const TipsModal = () => {
    const currentStep = tipSteps[currentTipStep];
    const isLastStep = currentTipStep === tipSteps.length - 1;
    const isFirstStep = currentTipStep === 0;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 relative">
          {/* Progress indicator */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Step {currentTipStep + 1} of {tipSteps.length}
              </span>
              <button
                onClick={handleSkipTips}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Skip Tour
              </button>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${((currentTipStep + 1) / tipSteps.length) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-4">
              <Icon name="check" size="lg" className="text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {currentStep.title}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              {currentStep.description}
            </p>
          </div>

          <div className="flex justify-between space-x-3">
            <button
              onClick={handlePreviousTip}
              disabled={isFirstStep}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isFirstStep 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Previous
            </button>
            
            {isLastStep ? (
              <button
                onClick={handleFinishTips}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Finish Tour
              </button>
            ) : (
              <button
                onClick={handleNextTip}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-semibold mb-2 text-gray-800">Account Profile</h1>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Basic Info */}
        <div id="basic-info-section" className="bg-white p-6 rounded-lg shadow-md border">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Basic Information</h2>
<div className="flex flex-row space-x-4 justify-start items-start">
        {context?.user ? (
          <>
            {context?.user?.pfpUrl && (
              <img
                src={context?.user?.pfpUrl}
                className="w-14 h-14 rounded-full"
                alt="User Profile"
                width={56}
                height={56}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-left">User context not available</p>
        )}
      </div>
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
              <label className="text-sm font-medium text-gray-600">ENB Balance</label>
              {enbBalanceLoading ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-gray-600">Loading...</span>
                </div>
              ) : (
              <p className="text-lg font-semibold text-blue-600">
                  {enbBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ENB
              </p>
              )}
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
          <div id="invitation-stats-section" className="bg-white p-6 rounded-lg shadow-md border">
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
                disabled={!profile.invitationUsage || profile.invitationUsage.totalUses < 5}
                onClick={handleClaimInvites}
                className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                  profile.invitationUsage && profile.invitationUsage.totalUses >= 5
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                } disabled:opacity-60`}
              >
                {inviteClaimLoading 
                  ? 'Claiming...' 
                  : profile.invitationUsage && profile.invitationUsage.totalUses >= 5
                  ? 'Claim 25 ENB for your invites'
                  : `Need ${5 - (profile.invitationUsage?.totalUses || 0)} more invites (${profile.invitationUsage?.totalUses || 0}/5)`
                }
              </button>
            </div>
          </div>
        )}

        {/* Daily Claim Actions */}
        <div id="daily-claim-section" className="bg-white p-6 rounded-lg shadow-md border">
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
        <div id="upgrade-section" className="bg-white p-6 rounded-lg shadow-md border">
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
                    • It will cost you ENB tokens to upgrade: 30,000 ENB for Super Based, 60,000 ENB for Legendary<br/>
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
		  <li>• <strong>Based</strong> - On this level (the first level) you earn 10 ENB a day</li>
		  <li>• <strong>Super Based</strong> - As a Super Based member you earn 15 ENB. To upgrade to Super Based you need:
		    <ul className="ml-4 mt-1 space-y-1">
		      <li>- 30,000 ENB in your wallet</li>
		      <li>- 14 consecutive days of daily claims</li>
		    </ul>
		  </li>
		  <li>• <strong>Legendary</strong> - The Legendary is the highest level allowing you to earn 20 ENB everyday. To upgrade to Legendary you need:
		    <ul className="ml-4 mt-1 space-y-1">
		      <li>- 60,000 ENB in your wallet</li>
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

      {/* Tips Modal */}
      {showTipsModal && <TipsModal />}

      {/* Help button to restart tips */}
      {hasSeenTips && (
        <button
          onClick={handleRestartTips}
          className="fixed bottom-4 right-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 z-40"
          title="Restart Tips Tour"
        >
          <Icon name="star" size="sm" />
        </button>
      )}

    </div>
  );
};