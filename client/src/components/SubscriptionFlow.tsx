import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { parseUnits } from "viem";
import { polygon } from "viem/chains";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import USDC_ABI from "@/contracts/USDC.json";
import SUBSCRIPTION_ABI from "@/contracts/SubscriptionManager.json";

// ─── Constants ───────────────────────────────────────────────────────────────

const USDC_ADDRESS = (
  (import.meta.env.VITE_USDC_ADDRESS as string | undefined) ||
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
) as `0x${string}`;

const SUBSCRIPTION_CONTRACT = (
  (import.meta.env.VITE_SUBSCRIPTION_CONTRACT as string | undefined) ||
  "0xE32b25a366ab56357c014A44bf1Dd1140761bEdc" // Polygon Mainnet SubscriptionManager
) as `0x${string}`;

// Debug: log contract addresses at module load so they're visible in browser console
console.log("[SubscriptionFlow] USDC:", USDC_ADDRESS);
console.log("[SubscriptionFlow] SubscriptionManager:", SUBSCRIPTION_CONTRACT);

const TIER_PRICES: Record<number, string> = { 1: "60", 2: "150", 3: "300" };
const TIER_NAMES: Record<number, string> = {
  1: "Basic",
  2: "Pro",
  3: "Premium",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "approve" | "subscribe" | "verify" | "complete" | "error";

interface SubscriptionFlowProps {
  tier: number;
  onComplete: () => void;
  onCancel: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SubscriptionFlow({
  tier,
  onComplete,
  onCancel,
}: SubscriptionFlowProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: polygon.id });

  const [step, setStep] = useState<Step>("approve");
  const [error, setError] = useState<string | null>(null);
  const [isSTSWarning, setIsSTSWarning] = useState(false);

  const price = TIER_PRICES[tier];
  const tierName = TIER_NAMES[tier];
  const priceUSDC = parseUnits(price, 6);

  const { balance, balanceRaw, isLoading: balanceLoading, symbol } = useUSDCBalance(address);

  // ── wagmi write hooks ──────────────────────────────────────────────────────

  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: approvePending,
    reset: resetApprove,
    error: approveError,
  } = useWriteContract();

  const {
    writeContract: writeSubscribe,
    data: subscribeHash,
    isPending: subscribePending,
    reset: resetSubscribe,
    error: subscribeError,
  } = useWriteContract();

  // ── Wait for confirmations ─────────────────────────────────────────────────

  const {
    isSuccess: approveConfirmed,
    isError: approveReceiptError,
    data: approveReceipt,
  } = useWaitForTransactionReceipt({
    hash: approveHash,
    confirmations: 1,
  });

  const {
    isSuccess: subscribeConfirmed,
    isError: subscribeReceiptError,
    data: subscribeReceipt,
  } = useWaitForTransactionReceipt({
    hash: subscribeHash,
    confirmations: 1,
  });

  // ── tRPC verify mutation ───────────────────────────────────────────────────

  const verifyMutation = trpc.subscription.verifyTransaction.useMutation();
  const verifyFired = useRef(false);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Catch approve write errors (includes STS relay errors)
  useEffect(() => {
    if (!approveError) return;
    const msg = (approveError as any).shortMessage ?? approveError.message ?? "";
    if (
      msg.includes("FAILED_UNKNOWN") ||
      msg.includes("Transaction relay error") ||
      msg.includes("Method not supported")
    ) {
      setIsSTSWarning(true);
      setError(
        "MetaMask's Smart Transactions feature is blocking this transaction on Polygon. " +
          "Please disable it in MetaMask → Settings → Advanced → Smart Transactions → OFF, then try again."
      );
    } else if ((approveError as any).code === 4001) {
      setError("Transaction rejected. Click 'Try Again' to retry.");
    } else {
      setError(msg || "Failed to approve USDC.");
    }
    setStep("error");
  }, [approveError]);

  // Catch subscribe write errors
  useEffect(() => {
    if (!subscribeError) return;
    const msg = (subscribeError as any).shortMessage ?? subscribeError.message ?? "";
    if (
      msg.includes("FAILED_UNKNOWN") ||
      msg.includes("Transaction relay error") ||
      msg.includes("Method not supported")
    ) {
      setIsSTSWarning(true);
      setError(
        "MetaMask's Smart Transactions feature is blocking this transaction on Polygon. " +
          "Please disable it in MetaMask → Settings → Advanced → Smart Transactions → OFF, then try again."
      );
    } else if ((subscribeError as any).code === 4001) {
      setError("Transaction rejected. Click 'Try Again' to retry.");
    } else {
      setError(msg || "Failed to submit subscription.");
    }
    setStep("error");
  }, [subscribeError]);

  // Approve confirmed → advance to subscribe step
  useEffect(() => {
    if (!approveConfirmed || step !== "approve") return;
    // Verify the receipt status (0 = reverted, 1 = success)
    if (approveReceipt && approveReceipt.status === "reverted") {
      setError("Approve transaction was reverted on-chain. This usually means the USDC contract rejected the call.");
      setStep("error");
      return;
    }
    setStep("subscribe");
  }, [approveConfirmed, approveReceipt, step]);

  // Approve receipt error
  useEffect(() => {
    if (!approveReceiptError || step !== "approve") return;
    setError("Failed to confirm approve transaction. Please check Polygonscan and try again.");
    setStep("error");
  }, [approveReceiptError, step]);

  // Subscribe confirmed → trigger verify
  useEffect(() => {
    if (!subscribeConfirmed || step !== "subscribe" || verifyFired.current || !subscribeHash) return;
    // Verify the receipt status
    if (subscribeReceipt && subscribeReceipt.status === "reverted") {
      setError(
        "Subscribe transaction was reverted on-chain. " +
          "This can happen if the contract is paused, the allowance was insufficient, or there is a contract configuration issue. " +
          `Check tx ${subscribeHash} on Polygonscan.`
      );
      setStep("error");
      return;
    }
    verifyFired.current = true;
    // 1-second buffer for server RPC propagation
    setTimeout(() => runVerify(subscribeHash), 1000);
  }, [subscribeConfirmed, subscribeReceipt, step, subscribeHash]);

  // Subscribe receipt error
  useEffect(() => {
    if (!subscribeReceiptError || step !== "subscribe") return;
    setError("Failed to confirm subscription transaction. Please check Polygonscan and try again.");
    setStep("error");
  }, [subscribeReceiptError, step]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = () => {
    setError(null);
    setIsSTSWarning(false);

    if (balanceLoading) {
      setError("Still loading your USDC balance. Please wait a moment.");
      return;
    }
    if (balanceRaw === undefined) {
      setError("Could not read USDC balance. Try refreshing.");
      return;
    }
    if (balanceRaw < priceUSDC) {
      setError(
        `Insufficient USDC. You need ${price} USDC but have ${parseFloat(balance).toFixed(2)} ${symbol}.`
      );
      return;
    }

    console.log("[SubscriptionFlow] approve() spender:", SUBSCRIPTION_CONTRACT, "amount:", priceUSDC.toString(), "(", price, "USDC)");
    writeApprove({
      address: USDC_ADDRESS,
      abi: USDC_ABI.abi,
      functionName: "approve",
      args: [SUBSCRIPTION_CONTRACT, priceUSDC],
    });
  };

  const handleSubscribe = () => {
    setError(null);
    setIsSTSWarning(false);

    // tier must be passed as a number (viem encodes it as uint8)
    // Contract enum: NONE=0, BASIC=1, PRO=2, PREMIUM=3
    const tierUint8 = Number(tier) as 0 | 1 | 2 | 3;
    console.log("[SubscriptionFlow] subscribe() tier:", tierUint8, "price:", price, "priceUSDC:", priceUSDC.toString());

    if (!tierUint8 || tierUint8 < 1 || tierUint8 > 3) {
      setError(`Invalid tier value: ${tier}. Expected 1 (Basic), 2 (Pro), or 3 (Premium).`);
      setStep("error");
      return;
    }

    writeSubscribe({
      address: SUBSCRIPTION_CONTRACT,
      abi: SUBSCRIPTION_ABI.abi,
      functionName: "subscribe",
      args: [tierUint8],
    });
  };

  const runVerify = async (hash: `0x${string}`) => {
    setStep("verify");
    try {
      if (!address) throw new Error("Wallet not connected");

      // Double-check receipt status via publicClient before calling server
      if (publicClient) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash });
          if (receipt && receipt.status === "reverted") {
            setError(
              `Subscribe transaction was reverted on-chain. ` +
                `Check tx ${hash} on Polygonscan for the revert reason.`
            );
            setStep("error");
            return;
          }
        } catch {
          // If we can't get the receipt here, let the server try
        }
      }

      await verifyMutation.mutateAsync({
        walletAddress: address,
        txHash: hash,
      });

      setStep("complete");
      setTimeout(onComplete, 2000);
    } catch (err: any) {
      setError(err.message ?? "Failed to verify transaction");
      setStep("error");
    }
  };

  const handleRetry = () => {
    resetApprove();
    resetSubscribe();
    verifyFired.current = false;
    setError(null);
    setIsSTSWarning(false);
    setStep("approve");
  };

  // ── UI helpers ─────────────────────────────────────────────────────────────

  const getStepStatus = (s: Step) => {
    const order: Step[] = ["approve", "subscribe", "verify", "complete"];
    const cur = order.indexOf(step);
    const idx = order.indexOf(s);
    if (idx < cur) return "complete";
    if (idx === cur) return "active";
    return "pending";
  };

  const isWrongNetwork = chainId !== 137 && chainId !== 80002;

  const approveInFlight = approvePending || (!!approveHash && !approveConfirmed && !approveReceiptError);
  const subscribeInFlight = subscribePending || (!!subscribeHash && !subscribeConfirmed && !subscribeReceiptError);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="bg-[#18181b] border-[#27272a] text-white max-w-[30vw] w-full ring-4 ring-blue-500/30 shadow-lg shadow-blue-500/30">
        <DialogHeader>
          <DialogTitle>Subscribe to {tierName} Plan</DialogTitle>
          <DialogDescription className="text-gray-400">
            Complete the following steps to activate your subscription
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isWrongNetwork && (
            <Alert className="bg-yellow-500/10 border-yellow-500/50">
              <AlertCircle className="h-4 w-4 text-yellow-400" />
              <AlertDescription className="text-yellow-300">
                Please switch to <strong>Polygon Mainnet</strong> in MetaMask to subscribe.
              </AlertDescription>
            </Alert>
          )}

          {/* Step 1 */}
          <div className="flex items-start gap-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                getStepStatus("approve") === "complete"
                  ? "bg-green-500"
                  : getStepStatus("approve") === "active"
                  ? "bg-blue-500"
                  : "bg-gray-700"
              }`}
            >
              {getStepStatus("approve") === "complete" ? (
                <Check className="h-4 w-4" />
              ) : approveInFlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "1"
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Approve USDC</h4>
              <p className="text-sm text-gray-400">
                {approvePending
                  ? "Confirm in MetaMask..."
                  : approveHash && !approveConfirmed
                  ? "Waiting for 2 block confirmations..."
                  : `Allow the contract to spend ${price} USDC`}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                getStepStatus("subscribe") === "complete"
                  ? "bg-green-500"
                  : getStepStatus("subscribe") === "active"
                  ? "bg-blue-500"
                  : "bg-gray-700"
              }`}
            >
              {getStepStatus("subscribe") === "complete" ? (
                <Check className="h-4 w-4" />
              ) : subscribeInFlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "2"
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Confirm Subscription</h4>
              <p className="text-sm text-gray-400">
                {subscribePending
                  ? "Confirm in MetaMask..."
                  : subscribeHash && !subscribeConfirmed
                  ? "Waiting for 2 block confirmations..."
                  : "Sign the transaction to activate your plan"}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                getStepStatus("verify") === "complete"
                  ? "bg-green-500"
                  : step === "verify"
                  ? "bg-blue-500"
                  : "bg-gray-700"
              }`}
            >
              {getStepStatus("verify") === "complete" ? (
                <Check className="h-4 w-4" />
              ) : step === "verify" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "3"
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Verify Payment</h4>
              <p className="text-sm text-gray-400">
                {step === "verify"
                  ? "Confirming on-chain — this may take up to 60 seconds..."
                  : "Confirming your subscription on-chain"}
              </p>
            </div>
          </div>

          {/* Error / STS warning */}
          {error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>{error}</p>
                {isSTSWarning && (
                  <a
                    href="https://support.metamask.io/transactions-and-gas/transactions/smart-transactions/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-400 underline text-xs mt-1"
                  >
                    How to disable Smart Transactions
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Balance summary */}
          <div className="bg-[#27272a] rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-400">Your USDC Balance:</span>
              <span className="font-medium">
                {balanceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  `${parseFloat(balance).toFixed(2)} ${symbol}`
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Subscription Cost:</span>
              <span className="font-medium">{price} USDC</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Network:</span>
              <span className="text-gray-500">
                {chainId === 137
                  ? "Polygon Mainnet"
                  : chainId === 80002
                  ? "Polygon Amoy"
                  : `Chain ${chainId}`}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          {step === "approve" && (
            <>
              <Button variant="outline" onClick={onCancel} disabled={approveInFlight}>
                Cancel
              </Button>
              <Button
                onClick={handleApprove}
                disabled={approveInFlight || balanceLoading || isWrongNetwork}
              >
                {approvePending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirm in MetaMask...
                  </>
                ) : approveHash && !approveConfirmed ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  "Approve USDC"
                )}
              </Button>
            </>
          )}

          {step === "subscribe" && (
            <>
              <Button variant="outline" onClick={onCancel} disabled={subscribeInFlight}>
                Cancel
              </Button>
              <Button
                onClick={handleSubscribe}
                disabled={subscribeInFlight || isWrongNetwork}
              >
                {subscribePending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirm in MetaMask...
                  </>
                ) : subscribeHash && !subscribeConfirmed ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  "Confirm Subscription"
                )}
              </Button>
            </>
          )}

          {step === "verify" && (
            <Button disabled className="w-full">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying payment...
            </Button>
          )}

          {step === "complete" && (
            <Button
              onClick={onComplete}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <Check className="mr-2 h-4 w-4" />
              Subscription Active!
            </Button>
          )}

          {step === "error" && (
            <>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={handleRetry}>Try Again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}