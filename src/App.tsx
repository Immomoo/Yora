import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUploadBlobs } from "@shelby-protocol/react";
import {
  Archive,
  ArrowDownToLine,
  BarChart3,
  CalendarClock,
  Check,
  Clock3,
  Copy,
  CornerDownLeft,
  CornerUpRight,
  FileLock2,
  Fingerprint,
  Gauge,
  History,
  KeyRound,
  Layers3,
  LogOut,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CapsuleDraft, CapsuleManifest, ShelbyNetworkId } from "./types";
import { formatAddress, formatBytes } from "./lib/bytes";
import { encryptDraft, decryptPayload } from "./lib/crypto";
import {
  buildKeyEscrowMessage,
  buildKeyReleaseMessage,
  escrowKey,
  isRemoteKeyReleaseEnabled,
  keyReleaseModeLabel,
  releaseKey,
} from "./lib/keyRelease";
import { readBlob } from "./lib/storage";
import { createShelbyClient, shelbyBlobUrl, SHELBY_NETWORKS } from "./lib/shelby";
import { capsuleBlobName, discoverShelbyCapsules, encodeCapsuleEnvelope } from "./lib/shelbyCapsules";
import { comparableAddress, sameAddress } from "./lib/address";
import {
  buildMarkReleasedTransaction,
  buildRegisterCapsuleTransaction,
  isAptosRegistryEnabled,
  registryModeLabel,
  registryStatusClass,
  registryStatusLabel,
  verifyCapsuleRegistry,
} from "./lib/aptosRegistry";

const DEFAULT_UNLOCK = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const SHELBY_EXPLORER_BASE_URL = "https://explorer.shelby.xyz";
const RUNTIME_VERSION = "shelby-index-v3";
const OPENED_CAPSULES_KEY = "yora:opened-capsules:v1";
const CAPSULE_RECEIPTS_KEY = "yora:capsule-receipts:v1";

type Page = "landing" | "dashboard" | "create" | "capsules" | "transactions" | "profile";
type SealStep = "idle" | "encrypting" | "approving" | "uploading" | "registry" | "escrow" | "sealed" | "error";
type CapsuleFilter = "all" | "received" | "sent" | "unlockable" | "locked" | "released" | "message" | "file";

interface CapsuleReceipt {
  capsuleId: string;
  registryTxHash?: string;
  releaseTxHash?: string;
}

interface SealReceipt {
  capsule: CapsuleManifest;
  registryStatus: "recorded" | "optional" | "skipped";
}

interface AppProps {
  selectedNetwork: ShelbyNetworkId;
  onNetworkChange: (network: ShelbyNetworkId) => void;
}

function normalizedAddress(address?: unknown): string {
  if (!address) return "";
  return String(address);
}

function bytesToBlobPart(bytes: Uint8Array): BlobPart {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatCapsuleStorage(capsule: CapsuleManifest): string {
  return capsule.shelbyNetwork ? SHELBY_NETWORKS[capsule.shelbyNetwork].shortLabel : "Shelby";
}

function capsuleCountLabel(count: number): string {
  return `${count} ${count === 1 ? "capsule" : "capsules"}`;
}

function shelbyExplorerBlobUrl(capsule: CapsuleManifest): string {
  const network = capsule.shelbyNetwork ?? "testnet";
  return `${SHELBY_EXPLORER_BASE_URL}/${network}/blobs/${capsule.creator}?blobName=${encodeURIComponent(capsule.blobName)}`;
}

function aptosExplorerTxUrl(hash: string, network: ShelbyNetworkId): string {
  return `https://explorer.aptoslabs.com/txn/${hash}?network=${network === "shelbynet" ? "shelbynet" : "testnet"}`;
}

function isWalletOnSelectedNetwork(walletNetworkName: string, selectedNetwork: ShelbyNetworkId): boolean {
  const normalized = walletNetworkName.toLowerCase();
  if (!normalized) return true;
  if (selectedNetwork === "shelbynet") {
    return normalized.includes("shelby") || normalized.includes("custom");
  }
  return normalized.includes("testnet");
}

function shortDigest(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function storageReceiptId(capsule: CapsuleManifest): string {
  const route = (capsule.shelbyNetwork ?? "testnet").toUpperCase();
  const digest = capsule.ciphertextDigest;
  const suffix = digest.length > 12 ? `${digest.slice(0, 6)}-${digest.slice(-6)}` : digest;
  return `YORA-${route}-${suffix.toUpperCase()}`;
}

function formatShortDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function shortRegistryStatus(capsule: CapsuleManifest): string {
  const status = capsule.registryVerification?.status;
  if (status === "released") return "Released";
  if (status === "verified") return "Verified";
  if (status === "mismatch") return "Mismatch";
  if (status === "missing") return "Missing";
  if (status === "unavailable") return "Unavailable";
  if (capsule.registryTxHash) return "Tx recorded";
  return isAptosRegistryEnabled(capsule.shelbyNetwork ?? "testnet") ? "Checking" : "Not enabled";
}

function registryDisplayClass(capsule: CapsuleManifest): "ready" | "locked" | "warning" | "shelby" {
  if (!capsule.registryVerification && isAptosRegistryEnabled(capsule.shelbyNetwork ?? "testnet")) return "locked";
  return registryStatusClass(capsule.registryVerification);
}

function registryDisplayTitle(capsule: CapsuleManifest): string {
  if (capsule.registryVerification) return capsule.registryVerification.message;
  if (isAptosRegistryEnabled(capsule.shelbyNetwork ?? "testnet")) {
    return "Yora is checking this capsule against the Aptos registry.";
  }
  return "Aptos registry is not configured for this route.";
}

function registryTxLabel(capsule: CapsuleManifest): string {
  if (capsule.registryTxHash) return shortDigest(capsule.registryTxHash);
  if (!isAptosRegistryEnabled(capsule.shelbyNetwork ?? "testnet")) return "Not enabled";
  if (capsule.registryVerification?.status === "verified" || capsule.registryVerification?.status === "released") {
    return "No local tx receipt";
  }
  return shortRegistryStatus(capsule);
}

function milestoneState(done: boolean, active = false): "done" | "active" | "pending" {
  if (done) return "done";
  return active ? "active" : "pending";
}

function isPreviewableImage(mimeType?: string, fileName?: string): boolean {
  if (mimeType?.startsWith("image/")) return true;
  return Boolean(fileName && /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(fileName));
}

async function attachRegistryVerifications(
  capsules: CapsuleManifest[],
  network: ShelbyNetworkId,
): Promise<CapsuleManifest[]> {
  if (!isAptosRegistryEnabled(network)) return capsules;

  return Promise.all(
    capsules.map(async (capsule) => ({
      ...capsule,
      registryVerification: await verifyCapsuleRegistry(capsule, network),
    })),
  );
}

function readOpenedCapsuleIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPENED_CAPSULES_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeOpenedCapsuleIds(ids: string[]): void {
  localStorage.setItem(OPENED_CAPSULES_KEY, JSON.stringify(ids));
}

function readCapsuleReceipts(): CapsuleReceipt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAPSULE_RECEIPTS_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CapsuleReceipt => {
      return Boolean(item && typeof item === "object" && typeof (item as CapsuleReceipt).capsuleId === "string");
    }) : [];
  } catch {
    return [];
  }
}

function writeCapsuleReceipts(receipts: CapsuleReceipt[]): void {
  localStorage.setItem(CAPSULE_RECEIPTS_KEY, JSON.stringify(receipts));
}

function getTransactionHash(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const value = response as Record<string, unknown>;
  const candidates = [
    value.hash,
    value.transactionHash,
    value.txHash,
    value.transaction_hash,
    value.pendingTransaction && typeof value.pendingTransaction === "object"
      ? (value.pendingTransaction as Record<string, unknown>).hash
      : undefined,
  ];
  const found = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return typeof found === "string" ? found : undefined;
}

function YoraMotionMark() {
  // Shelby Protocol logo — verified from official brand mark.
  // 3 identical pieces, each a wide chevron with:
  //   • outer edge following a large arc (R≈196, center 256,256)
  //   • inner concave notch on the left (pointing toward hub)
  //   • two straight angled sides connecting inner notch to outer arc endpoints
  // One piece in "right" orientation; rotate(120) and rotate(240) give the other two.
  //
  // Outer arc: from (256+196·cos(−55°), 256+196·sin(−55°)) to same angle +110°
  //   cos/sin here use standard SVG coords (y-axis down)
  //   −55°: (256+196·cos55°, 256−196·sin55°) = (256+112, 256−161) = (368, 95)  [top-right]
  //   +55°: (256+196·cos55°, 256+196·sin55°) = (368, 417)                      [bot-right]
  //   rightmost (0°): (256+196, 256) = (452, 256)
  //
  // Inner notch tip: (256−80, 256) = (176, 256) — sharp V toward center
  // Inner arc endpoints (shoulders):
  //   top shoulder: (176+90·cos(−40°), 256+90·sin(−40°)) ≈ (245, 198)
  //   bot shoulder: (245, 314)
  const blade =
    "M 176,256" +               // inner tip (V-point toward center)
    " L 250,190" +              // upper shoulder
    " L 368,95" +               // outer arc start (upper)
    " A 196,196 0 0,1 452,256" +// outer arc: top → right peak
    " A 196,196 0 0,1 368,417" +// outer arc: right peak → bottom
    " L 250,322" +              // lower shoulder
    " Z";
  return (
    <div className="yora-motion" aria-label="Yora">
      <svg viewBox="0 0 272 220" role="img">
        <title>Yora</title>
        <g className="yora-motion-mark">
          <rect className="yora-motion-frame" x="66" y="26" width="140" height="168" rx="28" />
          <path className="yora-motion-glyph" d="M94 42h18l24 55 24-55h18l-34 76v44h-16v-44L94 42Z" />
          <circle className="yora-motion-dot" cx="178" cy="49" r="9" />
        </g>
      </svg>
      <span className="yora-ring one" />
      <span className="yora-ring two" />
    </div>
  );
}

export default function App({ selectedNetwork, onNetworkChange }: AppProps) {
  const wallet = useWallet();
  const [activePage, setActivePage] = useState<Page>("landing");
  const [capsules, setCapsules] = useState<CapsuleManifest[]>([]);
  const [draft, setDraft] = useState<CapsuleDraft>({
    title: "For the morning after launch",
    recipient: "",
    unlockAt: new Date(DEFAULT_UNLOCK).getTime(),
    message: "Write a private note that should only be opened after the unlock time.",
    file: null,
  });
  const [mode, setMode] = useState<"message" | "file">("message");
  const [activity, setActivity] = useState("Ready to seal an encrypted capsule.");
  const [opened, setOpened] = useState<{
    title: string;
    text?: string;
    url?: string;
    mimeType?: string;
    fileName?: string;
    payloadKind: "message" | "file";
    releaseMarkerStatus?: "pending" | "recorded" | "skipped";
    releaseTxHash?: string;
  } | null>(null);
  const [unsealIssue, setUnsealIssue] = useState<{ title: string; message: string } | null>(null);
  const [selectedCapsule, setSelectedCapsule] = useState<CapsuleManifest | null>(null);
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null);
  const [sealStep, setSealStep] = useState<SealStep>("idle");
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [openingCapsuleId, setOpeningCapsuleId] = useState<string | null>(null);
  const [openedCapsuleIds, setOpenedCapsuleIds] = useState<string[]>(() => readOpenedCapsuleIds());
  const [capsuleReceipts, setCapsuleReceipts] = useState<CapsuleReceipt[]>(() => readCapsuleReceipts());
  const [lastSealReceipt, setLastSealReceipt] = useState<SealReceipt | null>(null);
  const [isIndexLoading, setIsIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [capsuleScope, setCapsuleScope] = useState("");
  const [indexStatus, setIndexStatus] = useState("Shelby capsule index ready.");
  const [capsuleFilter, setCapsuleFilter] = useState<CapsuleFilter>("all");
  const [capsuleSearch, setCapsuleSearch] = useState("");
  const [draftFilePreviewUrl, setDraftFilePreviewUrl] = useState("");

  const connectedAddress = normalizedAddress(wallet.account?.address);
  const currentScope = `${selectedNetwork}:${comparableAddress(connectedAddress)}`;
  const scopedCapsules = capsuleScope === currentScope ? capsules : [];
  const visibleCapsules = useMemo(
    () =>
      connectedAddress
        ? scopedCapsules.filter(
            (capsule) =>
              capsule.shelbyNetwork === selectedNetwork &&
              (sameAddress(capsule.creator, connectedAddress) ||
                sameAddress(capsule.recipient, connectedAddress)),
          )
        : [],
    [scopedCapsules, connectedAddress, selectedNetwork],
  );
  const receivedCapsules = useMemo(
    () => visibleCapsules.filter((capsule) => sameAddress(capsule.recipient, connectedAddress)),
    [visibleCapsules, connectedAddress],
  );
  const transactionCapsules = useMemo(
    () => visibleCapsules.filter((capsule) => sameAddress(capsule.creator, connectedAddress)),
    [visibleCapsules, connectedAddress],
  );
  const receivedCount = receivedCapsules.length;
  const sentCount = transactionCapsules.length;
  const sealedCount = visibleCapsules.length;
  const totalBytes = visibleCapsules.reduce((sum, capsule) => sum + capsule.sizeBytes, 0);
  const openedCapsuleSet = useMemo(() => new Set(openedCapsuleIds), [openedCapsuleIds]);
  const openedCount = visibleCapsules.filter(
    (capsule) => capsule.status === "opened" || openedCapsuleSet.has(capsule.id),
  ).length;
  const lockedCount = visibleCapsules.filter((capsule) => Date.now() < capsule.unlockAt).length;
  const receivedInbox = [...receivedCapsules].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const networkConfig = SHELBY_NETWORKS[selectedNetwork];
  const shelbyClient = useMemo(() => createShelbyClient(selectedNetwork), [selectedNetwork]);
  const detectedWallets = wallet.wallets;
  const suggestedWallets = wallet.notDetectedWallets.slice(0, 5);
  const walletNetworkName = wallet.network?.name ? String(wallet.network.name) : "";
  const networkMismatch =
    wallet.connected &&
    Boolean(walletNetworkName) &&
    !isWalletOnSelectedNetwork(walletNetworkName, selectedNetwork);
  const capsuleReceiptMap = useMemo(() => new Map(capsuleReceipts.map((receipt) => [receipt.capsuleId, receipt])), [capsuleReceipts]);
  const hydratedVisibleCapsules = useMemo(
    () => visibleCapsules.map((capsule) => withLocalReceipt(capsule)),
    [visibleCapsules, capsuleReceiptMap],
  );
  const capsuleFilterOptions = useMemo(() => {
    const now = Date.now();
    const isReleased = (capsule: CapsuleManifest) =>
      capsule.registryVerification?.status === "released" ||
      Boolean(capsule.releaseTxHash) ||
      capsule.status === "opened" ||
      openedCapsuleSet.has(capsule.id);

    return [
      ["all", "All", hydratedVisibleCapsules.length],
      ["received", "Received", hydratedVisibleCapsules.filter((capsule) => sameAddress(capsule.recipient, connectedAddress)).length],
      ["sent", "Sent", hydratedVisibleCapsules.filter((capsule) => sameAddress(capsule.creator, connectedAddress)).length],
      ["unlockable", "Unlockable", hydratedVisibleCapsules.filter((capsule) => sameAddress(capsule.recipient, connectedAddress) && now >= capsule.unlockAt).length],
      ["locked", "Locked", hydratedVisibleCapsules.filter((capsule) => now < capsule.unlockAt).length],
      ["released", "Released", hydratedVisibleCapsules.filter(isReleased).length],
      ["message", "Message", hydratedVisibleCapsules.filter((capsule) => capsule.payloadKind === "message").length],
      ["file", "File", hydratedVisibleCapsules.filter((capsule) => capsule.payloadKind === "file").length],
    ] as Array<[CapsuleFilter, string, number]>;
  }, [hydratedVisibleCapsules, connectedAddress, openedCapsuleSet]);
  const filteredCapsules = useMemo(() => {
    const now = Date.now();
    const query = capsuleSearch.trim().toLowerCase();

    return hydratedVisibleCapsules.filter((capsule) => {
      const isRecipient = sameAddress(capsule.recipient, connectedAddress);
      const isCreator = sameAddress(capsule.creator, connectedAddress);
      const isReleased =
        capsule.registryVerification?.status === "released" ||
        Boolean(capsule.releaseTxHash) ||
        capsule.status === "opened" ||
        openedCapsuleSet.has(capsule.id);
      const matchesFilter =
        capsuleFilter === "all" ||
        (capsuleFilter === "received" && isRecipient) ||
        (capsuleFilter === "sent" && isCreator) ||
        (capsuleFilter === "unlockable" && isRecipient && now >= capsule.unlockAt) ||
        (capsuleFilter === "locked" && now < capsule.unlockAt) ||
        (capsuleFilter === "released" && isReleased) ||
        (capsuleFilter === "message" && capsule.payloadKind === "message") ||
        (capsuleFilter === "file" && capsule.payloadKind === "file");

      if (!matchesFilter) return false;
      if (!query) return true;

      const searchText = [
        capsule.title,
        capsule.id,
        capsule.creator,
        capsule.recipient,
        capsule.blobName,
        capsule.ciphertextDigest,
        capsule.registryTxHash,
        capsule.releaseTxHash,
        storageReceiptId(capsule),
        formatCapsuleStorage(capsule),
        shortRegistryStatus(capsule),
        capsule.payloadKind,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchText.includes(query);
    });
  }, [hydratedVisibleCapsules, capsuleFilter, capsuleSearch, connectedAddress, openedCapsuleSet]);

  const uploadBlobs = useUploadBlobs({
    client: shelbyClient,
    onError: (error) => setActivity(`Shelby rejected the storage write: ${error.message}`),
  });
  const isBusy =
    uploadBlobs.isPending ||
    sealStep === "encrypting" ||
    sealStep === "approving" ||
    sealStep === "uploading" ||
    sealStep === "registry" ||
    sealStep === "escrow";

  function markCapsuleOpened(capsuleId: string): void {
    setOpenedCapsuleIds((current) => {
      if (current.includes(capsuleId)) return current;
      const next = [capsuleId, ...current].slice(0, 500);
      writeOpenedCapsuleIds(next);
      return next;
    });
  }

  function rememberCapsuleReceipt(receipt: CapsuleReceipt): void {
    setCapsuleReceipts((current) => {
      const existing = current.find((item) => item.capsuleId === receipt.capsuleId);
      const merged = {
        ...existing,
        ...receipt,
      };
      const next = [merged, ...current.filter((item) => item.capsuleId !== receipt.capsuleId)].slice(0, 500);
      writeCapsuleReceipts(next);
      return next;
    });
  }

  function withLocalReceipt(capsule: CapsuleManifest): CapsuleManifest {
    const receipt = capsuleReceiptMap.get(capsule.id);
    return receipt ? { ...capsule, ...receipt } : capsule;
  }

  function copyToClipboard(value: string): void {
    void navigator.clipboard?.writeText(value);
  }

  useEffect(() => {
    localStorage.removeItem("yora:capsules:v1");
    localStorage.removeItem("nora:capsules:v1");
  }, []);

  useEffect(() => {
    const normalizedNetwork = walletNetworkName.toLowerCase();
    if (!wallet.connected || !normalizedNetwork) return;

    if ((normalizedNetwork.includes("shelby") || normalizedNetwork.includes("custom")) && selectedNetwork !== "shelbynet") {
      onNetworkChange("shelbynet");
      setActivity("Yora matched the connected wallet to Shelbynet.");
      return;
    }

    if (normalizedNetwork.includes("testnet") && !normalizedNetwork.includes("shelby") && selectedNetwork !== "testnet") {
      onNetworkChange("testnet");
      setActivity("Yora matched the connected wallet to Shelby Testnet.");
    }
  }, [wallet.connected, walletNetworkName, selectedNetwork, onNetworkChange]);

  useEffect(() => {
    let cancelled = false;

    async function loadFromShelby() {
      if (!connectedAddress) {
        setCapsules([]);
        setCapsuleScope(currentScope);
        setIndexError(null);
        setIndexStatus("Connect a wallet to load capsules from Shelby.");
        return;
      }

      setIsIndexLoading(true);
      setCapsules([]);
      setCapsuleScope(currentScope);
      setIndexError(null);
      setIndexStatus(`Loading Shelby capsules for ${formatAddress(connectedAddress)} on ${SHELBY_NETWORKS[selectedNetwork].shortLabel}...`);
      try {
        const indexedCapsules = await discoverShelbyCapsules({
          client: shelbyClient,
          account: connectedAddress,
          network: selectedNetwork,
        });
        const hydratedCapsules = indexedCapsules.map((capsule) => {
          const receipt = readCapsuleReceipts().find((item) => item.capsuleId === capsule.id);
          return receipt ? { ...capsule, ...receipt } : capsule;
        });
        const verifiedCapsules = await attachRegistryVerifications(hydratedCapsules, selectedNetwork);
        if (!cancelled) {
          setCapsuleScope(currentScope);
          setCapsules(verifiedCapsules);
          setIndexStatus(`Loaded ${capsuleCountLabel(verifiedCapsules.length)} from Shelby for ${formatAddress(connectedAddress)}.`);
          setActivity(`Loaded ${capsuleCountLabel(verifiedCapsules.length)} from Shelby and checked Aptos registry status.`);
        }
      } catch (error) {
        if (!cancelled) {
          setCapsules([]);
          setCapsuleScope(currentScope);
          setIndexError(error instanceof Error ? error.message : "Yora could not load capsules from Shelby.");
          setIndexStatus("Could not load Shelby capsules.");
        }
      } finally {
        if (!cancelled) setIsIndexLoading(false);
      }
    }

    void loadFromShelby();

    return () => {
      cancelled = true;
    };
  }, [connectedAddress, selectedNetwork, shelbyClient, currentScope]);

  const readyCount = useMemo(
    () =>
      receivedCapsules.filter(
        (capsule) =>
          sameAddress(capsule.recipient, connectedAddress) &&
          Date.now() >= capsule.unlockAt,
      ).length,
    [receivedCapsules, connectedAddress],
  );
  const draftPayloadBytes = useMemo(() => {
    if (mode === "file") return draft.file?.size ?? 0;
    return new TextEncoder().encode(draft.message.trim()).byteLength;
  }, [mode, draft.file, draft.message]);
  const draftPayloadLabel = mode === "file"
    ? draft.file
      ? `${draft.file.name} / ${formatBytes(draft.file.size)}`
      : "No file selected"
    : `${formatBytes(draftPayloadBytes)} message`;
  const unlockInFuture = draft.unlockAt > Date.now();
  const draftReadyChecks = [
    ["Wallet", Boolean(connectedAddress) && !networkMismatch ? "Ready" : "Connect matching wallet"],
    ["Recipient", draft.recipient.trim() ? "Address set" : "Add recipient address"],
    ["Payload", draftPayloadBytes > 0 ? draftPayloadLabel : "Add message or file"],
    ["Unlock", unlockInFuture ? formatShortDateTime(draft.unlockAt) : "Choose a future time"],
  ];
  const recentActivity = useMemo(
    () =>
      [...hydratedVisibleCapsules]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 4)
        .map((capsule) => {
          const isRecipient = sameAddress(capsule.recipient, connectedAddress);
          const released = capsule.registryVerification?.status === "released" || Boolean(capsule.releaseTxHash) || openedCapsuleSet.has(capsule.id);
          return {
            capsule,
            tone: released ? "ready" : isRecipient ? "received" : "sent",
            label: released ? "Released" : isRecipient ? "Received" : "Sent",
            detail: `${formatCapsuleStorage(capsule)} / ${capsule.payloadKind} / ${formatShortDateTime(capsule.createdAt)}`,
          };
        }),
    [hydratedVisibleCapsules, connectedAddress, openedCapsuleSet],
  );
  const selectedCapsuleView = selectedCapsule ? withLocalReceipt(selectedCapsule) : null;
  const selectedCapsuleLocked = selectedCapsuleView ? Date.now() < selectedCapsuleView.unlockAt : false;
  const selectedCapsuleIsRecipient = selectedCapsuleView ? sameAddress(selectedCapsuleView.recipient, connectedAddress) : false;
  const selectedCapsuleIsSender = selectedCapsuleView ? sameAddress(selectedCapsuleView.creator, connectedAddress) : false;
  const selectedCapsuleReleased = selectedCapsuleView
    ? selectedCapsuleView.registryVerification?.status === "released" ||
      Boolean(selectedCapsuleView.releaseTxHash) ||
      openedCapsuleSet.has(selectedCapsuleView.id)
    : false;
  const selectedCapsuleCanUnseal = Boolean(
    selectedCapsuleView &&
      selectedCapsuleIsRecipient &&
      !selectedCapsuleLocked &&
      openingCapsuleId !== selectedCapsuleView.id,
  );
  const selectedCapsuleDirection = selectedCapsuleIsRecipient ? "Received capsule" : selectedCapsuleIsSender ? "Sent capsule" : "Shared capsule";

  useEffect(() => {
    if (!draft.file || !isPreviewableImage(draft.file.type, draft.file.name)) {
      setDraftFilePreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(draft.file);
    setDraftFilePreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [draft.file]);

  async function sealCapsule() {
    setLastError(null);
    if (!connectedAddress || !wallet.signAndSubmitTransaction) {
      setActivity("Connect an Aptos wallet before sealing.");
      setLastError("Connect a wallet so Yora can approve the Shelby storage write.");
      setSealStep("error");
      return;
    }
    if (networkMismatch) {
      setActivity(`Switch your wallet to ${networkConfig.shortLabel} before sealing.`);
      setLastError(`Your wallet is on ${walletNetworkName}. Switch it to ${networkConfig.shortLabel}, or choose the matching Yora route.`);
      setSealStep("error");
      return;
    }
    if (!draft.recipient || !draft.title || (mode === "message" ? !draft.message.trim() : !draft.file)) {
      setActivity("Complete the capsule details before sealing.");
      setLastError(
        mode === "file"
          ? "Choose a file before sealing this capsule."
          : "Add a title, recipient address, unlock time, and message before sealing.",
      );
      setSealStep("error");
      return;
    }
    if (draft.unlockAt <= Date.now()) {
      setActivity("Choose a future unlock time.");
      setLastError("The unlock time must be later than the current time.");
      setSealStep("error");
      return;
    }
    if (isRemoteKeyReleaseEnabled() && !wallet.signMessage) {
      setActivity("This wallet cannot approve the remote key escrow request.");
      setLastError("Choose a wallet that supports message signing, then seal the capsule again.");
      setSealStep("error");
      return;
    }

    setSealStep("encrypting");
    setActivity("Encrypting the payload locally...");
    const encrypted = await encryptDraft({ ...draft, file: mode === "file" ? draft.file : null });
    const id = crypto.randomUUID();
    const normalizedRecipient = comparableAddress(draft.recipient);
    const blobName = capsuleBlobName({ recipient: normalizedRecipient, id });
    const keyId = `key_${id}`;
    const blobUrl = shelbyBlobUrl(connectedAddress, blobName, selectedNetwork);
    const manifest: CapsuleManifest = {
      id,
      title: draft.title,
      creator: connectedAddress,
      recipient: normalizedRecipient,
      unlockAt: draft.unlockAt,
      createdAt: Date.now(),
      payloadKind: encrypted.payloadKind,
      blobName,
      blobUrl,
      storage: "shelby",
      sizeBytes: encrypted.sizeBytes,
      mimeType: encrypted.mimeType,
      fileName: mode === "file" ? draft.file?.name : undefined,
      iv: Array.from(encrypted.iv).join(","),
      keyId,
      ciphertextDigest: encrypted.digest,
      status: "sealed",
      shelbyNetwork: selectedNetwork,
    };

    try {
      setSealStep("approving");
      setActivity("Approve the Shelby storage write in your wallet...");
      await uploadBlobs.mutateAsync({
        signer: { account: connectedAddress, signAndSubmitTransaction: wallet.signAndSubmitTransaction },
        blobs: [{ blobName, blobData: encodeCapsuleEnvelope(manifest, encrypted) }],
        expirationMicros: draft.unlockAt * 1000 + 90 * 24 * 60 * 60 * 1000 * 1000,
      });
      setSealStep("uploading");
      setActivity("Shelby accepted the encrypted blob.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shelby did not accept the encrypted capsule. No capsule was created.";
      setSealStep("error");
      setLastError(message);
      setActivity(`Shelby storage failed: ${message}`);
      return;
    }

    let registryTxHash: string | undefined;
    if (isAptosRegistryEnabled(selectedNetwork)) {
      try {
        setSealStep("registry");
        setActivity("Approve the Aptos registry transaction...");
        const registryResponse = await wallet.signAndSubmitTransaction(buildRegisterCapsuleTransaction(manifest, selectedNetwork) as never);
        registryTxHash = getTransactionHash(registryResponse);
        setActivity("Aptos registry recorded the capsule metadata.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Aptos registry did not accept the capsule metadata.";
        setSealStep("error");
        setLastError(message);
        setActivity(`Aptos registry failed: ${message}`);
        return;
      }
    }

    setSealStep("escrow");
    let creatorMessage: string | undefined;
    let creatorSignature: unknown;
    if (isRemoteKeyReleaseEnabled()) {
      setActivity("Approve key escrow so the recipient can unseal later...");
      creatorMessage = buildKeyEscrowMessage(manifest);
      creatorSignature = await wallet.signMessage({
        message: creatorMessage,
        nonce: crypto.randomUUID(),
        address: true,
        application: true,
        chainId: true,
      });
    }

    try {
      await escrowKey({
        keyId,
        recipient: draft.recipient,
        unlockAt: draft.unlockAt,
        keyBytes: encrypted.keyBytes,
        capsule: manifest,
        creatorMessage,
        creatorSignature,
        creatorPublicKey: wallet.account?.publicKey?.toString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remote key escrow did not complete.";
      setSealStep("error");
      setLastError(message);
      setActivity(`Key escrow failed: ${message}`);
      return;
    }
    const finalManifest: CapsuleManifest = registryTxHash
      ? {
          ...manifest,
          registryTxHash,
          registryVerification: {
            status: "verified",
            checkedAt: Date.now(),
            released: false,
            message: "Registry transaction submitted on Aptos.",
          },
        }
      : manifest;
    if (registryTxHash) {
      rememberCapsuleReceipt({ capsuleId: finalManifest.id, registryTxHash });
    }
    setCapsuleScope(currentScope);
    setCapsules((current) => [finalManifest, ...current.filter((capsule) => capsule.id !== finalManifest.id)]);
    setActivePage("capsules");
    setSelectedCapsule(finalManifest);
    setLastSealReceipt({
      capsule: finalManifest,
      registryStatus: isAptosRegistryEnabled(selectedNetwork) ? "recorded" : "optional",
    });
    setSealStep("sealed");
    setActivity("Capsule sealed. Shelby storage and access rules are ready.");
  }

  async function unsealCapsule(capsule: CapsuleManifest) {
    if (!connectedAddress) {
      setActivity("Connect the recipient wallet to unseal this capsule.");
      setLastError("Only the recipient wallet can approve and decrypt this capsule.");
      setUnsealIssue({
        title: "Recipient wallet required",
        message: "Connect the wallet that matches this capsule recipient before unsealing.",
      });
      return;
    }
    try {
      setLastError(null);
      setUnsealIssue(null);
      setOpeningCapsuleId(capsule.id);
      setActivity("Requesting recipient wallet approval...");
      const releaseTimestamp = Date.now();
      const recipientMessage = isRemoteKeyReleaseEnabled()
        ? buildKeyReleaseMessage(capsule, releaseTimestamp)
        : `Unseal Yora capsule: ${capsule.title}\nCapsule ID: ${capsule.id}\nDigest: ${capsule.ciphertextDigest}`;
      const recipientSignature = await wallet.signMessage({
        message: recipientMessage,
        nonce: crypto.randomUUID(),
        address: true,
        application: true,
        chainId: true,
      });
      setActivity("Checking recipient, unlock time, and Shelby blob...");
      const key = await releaseKey({
        keyId: capsule.keyId,
        recipient: connectedAddress,
        capsule,
        recipientMessage,
        recipientSignature,
        recipientPublicKey: wallet.account?.publicKey?.toString(),
        timestamp: releaseTimestamp,
      });
      const ciphertext = await readBlob(capsule);
      const plaintext = await decryptPayload(ciphertext, key, new Uint8Array(capsule.iv.split(",").map(Number)));

      if (capsule.payloadKind === "message") {
        setOpened({
          title: capsule.title,
          text: new TextDecoder().decode(plaintext),
          mimeType: capsule.mimeType,
          payloadKind: "message",
          releaseMarkerStatus: isAptosRegistryEnabled(selectedNetwork) ? "pending" : "skipped",
        });
      } else {
        const blob = new Blob([bytesToBlobPart(plaintext)], { type: capsule.mimeType });
        setOpened({
          title: capsule.title,
          url: URL.createObjectURL(blob),
          mimeType: capsule.mimeType,
          fileName: capsule.fileName,
          payloadKind: "file",
          releaseMarkerStatus: isAptosRegistryEnabled(selectedNetwork) ? "pending" : "skipped",
        });
      }
      setSelectedCapsule(null);
      markCapsuleOpened(capsule.id);
      setCapsules((current) =>
        current.map((item) => (item.id === capsule.id ? { ...item, status: "opened" } : item)),
      );
      if (isAptosRegistryEnabled(selectedNetwork) && wallet.signAndSubmitTransaction) {
        try {
          setActivity("Recording the release marker on Aptos...");
          const releaseResponse = await wallet.signAndSubmitTransaction(buildMarkReleasedTransaction(capsule, selectedNetwork) as never);
          const releaseTxHash = getTransactionHash(releaseResponse);
          if (releaseTxHash) {
            rememberCapsuleReceipt({ capsuleId: capsule.id, releaseTxHash });
            setCapsules((current) =>
              current.map((item) =>
                item.id === capsule.id
                  ? {
                      ...item,
                      releaseTxHash,
                      status: "opened",
                      registryVerification: {
                        status: "released",
                        checkedAt: Date.now(),
                        released: true,
                        releasedAt: Date.now(),
                        message: "Registry record is marked released on Aptos.",
                      },
                    }
                  : item,
              ),
            );
          }
          setOpened((current) =>
            current
              ? {
                  ...current,
                  releaseMarkerStatus: "recorded",
                  releaseTxHash,
                }
              : current,
          );
          setActivity("Capsule unsealed and release marker recorded.");
        } catch {
          setOpened((current) =>
            current
              ? {
                  ...current,
                  releaseMarkerStatus: "skipped",
                }
              : current,
          );
          setActivity("Capsule unsealed. Aptos release marker was not recorded.");
        }
      } else {
        setActivity("Capsule unsealed after recipient approval.");
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "This capsule is not ready to unseal.";
      const message =
        rawMessage === "Capsule key escrow was not found."
          ? "Yora found the Shelby capsule, but not its remote release key. It was likely sealed before remote key release was enabled, or the sender's key escrow step failed. Ask the sender to seal a new capsule."
          : rawMessage;
      setLastError(message);
      setActivity(message);
      setUnsealIssue({
        title: "Unseal did not complete",
        message,
      });
    } finally {
      setOpeningCapsuleId(null);
    }
  }

  const appNavItems: Array<[Page, LucideIcon, string]> = [
    ["dashboard", BarChart3, "Dashboard"],
    ["create", Plus, "Create"],
    ["capsules", Archive, "Capsules"],
    ["transactions", History, "Transactions"],
    ["profile", UserRound, "Profile"],
  ];

  const healthItems = [
    { label: "Aptos", value: networkConfig.shortLabel, tone: wallet.connected ? "good" : "idle" },
    { label: "Shelby", value: uploadBlobs.isPending ? "Uploading" : networkConfig.shortLabel, tone: uploadBlobs.isPending ? "busy" : "good" },
    { label: "Blobs", value: "Shelby only", tone: "good" },
    { label: "Keys", value: isRemoteKeyReleaseEnabled() ? "Remote" : "Browser only", tone: isRemoteKeyReleaseEnabled() ? "good" : "idle" },
    {
      label: "Registry",
      value: isAptosRegistryEnabled(selectedNetwork) ? "Aptos" : "Optional",
      tone: isAptosRegistryEnabled(selectedNetwork) ? "good" : "idle",
    },
  ];

  const sealSteps: Array<[SealStep, string]> = [
    ["encrypting", "Encrypt"],
    ["approving", "Wallet approval"],
    ["uploading", "Shelby storage"],
    ["registry", "Aptos registry"],
    ["escrow", "Release key"],
    ["sealed", "Capsule sealed"],
  ];
  const activeSealIndex = sealSteps.findIndex(([step]) => step === sealStep);

  const openWalletPicker = () => {
    if (!detectedWallets.length && !suggestedWallets.length) {
      setActivity("Install or enable an Aptos wallet, then connect again.");
      return;
    }
    setWalletPickerOpen(true);
  };

  const refreshShelbyIndex = () => {
    if (!connectedAddress) {
      openWalletPicker();
      return;
    }

    setCapsules([]);
    setCapsuleScope(currentScope);
    setIndexError(null);
    setIsIndexLoading(true);
    setIndexStatus(`Loading Shelby capsules for ${formatAddress(connectedAddress)} on ${networkConfig.shortLabel}...`);
    void discoverShelbyCapsules({
      client: shelbyClient,
      account: connectedAddress,
      network: selectedNetwork,
    })
      .then((indexedCapsules) => {
        const hydratedCapsules = indexedCapsules.map((capsule) => {
          const receipt = readCapsuleReceipts().find((item) => item.capsuleId === capsule.id);
          return receipt ? { ...capsule, ...receipt } : capsule;
        });
        return attachRegistryVerifications(hydratedCapsules, selectedNetwork);
      })
      .then((verifiedCapsules) => {
        setCapsuleScope(currentScope);
        setCapsules(verifiedCapsules);
        setIndexStatus(`Loaded ${capsuleCountLabel(verifiedCapsules.length)} from Shelby for ${formatAddress(connectedAddress)}.`);
        setActivity(`Loaded ${capsuleCountLabel(verifiedCapsules.length)} from Shelby and checked Aptos registry status.`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Yora could not load capsules from Shelby.";
        setIndexError(message);
        setIndexStatus("Could not load Shelby capsules.");
        setActivity(message);
      })
      .finally(() => setIsIndexLoading(false));
  };

  const connectWallet = (walletName: string) => {
    try {
      wallet.connect(walletName);
      setWalletPickerOpen(false);
      setActivity(`Connecting ${walletName}...`);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Yora could not connect to that wallet.");
    }
  };

  const switchNetwork = (network: ShelbyNetworkId) => {
    if (network === selectedNetwork) return;
    onNetworkChange(network);
    setActivity(`Switched to ${SHELBY_NETWORKS[network].label}. Reconnect if your wallet asks for confirmation.`);
    setSealStep("idle");
  };

  const walletControl = (
    <div className="wallet-chip">
      <Wallet size={15} />
      <span>{formatAddress(connectedAddress)}</span>
      {wallet.connected ? (
        <button className="icon-button" onClick={() => wallet.disconnect()} aria-label="Disconnect wallet">
          <LogOut size={15} />
        </button>
      ) : (
        <button className="small-button" onClick={openWalletPicker}>
          Connect wallet
        </button>
      )}
    </div>
  );

  const networkToggle = (
    <div className="network-toggle" role="group" aria-label="Shelby network">
      {(["shelbynet", "testnet"] as ShelbyNetworkId[]).map((network) => (
        <button
          key={network}
          type="button"
          className={network === selectedNetwork ? "active" : ""}
          onClick={() => switchNetwork(network)}
        >
          <span>{SHELBY_NETWORKS[network].shortLabel}</span>
        </button>
      ))}
    </div>
  );

  const logo = (
    <div className="logo-lockup">
      <div className="yora-logo" aria-hidden="true">
        <span />
      </div>
      <div>
        <strong>Yora</strong>
        <small>Time-locked capsules</small>
      </div>
    </div>
  );

  const walletPicker = walletPickerOpen ? (
    <section className="modal-backdrop" onClick={() => setWalletPickerOpen(false)}>
      <aside className="wallet-modal" aria-label="Select wallet" onClick={(event) => event.stopPropagation()}>
        <button className="drawer-close" onClick={() => setWalletPickerOpen(false)} aria-label="Close wallet selector">
          <X size={17} />
        </button>
        <div className="section-heading">
          <Wallet size={22} />
          <div>
            <h2>Connect wallet</h2>
            <p>Select an Aptos wallet available on this device.</p>
          </div>
        </div>

        <div className="wallet-list">
          <div className="wallet-group">
            <p>Available wallets</p>
            {detectedWallets.map((availableWallet) => (
              <button
                className="wallet-option"
                key={availableWallet.name}
                onClick={() => connectWallet(availableWallet.name)}
              >
                <img src={availableWallet.icon} alt="" />
                <span>
                  <strong>{availableWallet.name}</strong>
                  <small>{wallet.wallet?.name === availableWallet.name ? "Connected" : "Ready to connect"}</small>
                </span>
                <Check size={16} />
              </button>
            ))}
          </div>

          {!!suggestedWallets.length && (
            <div className="wallet-group">
              <p>Install a wallet</p>
              {suggestedWallets.map((availableWallet) => (
                <a className="wallet-option muted" key={availableWallet.name} href={availableWallet.url} target="_blank" rel="noreferrer">
                  <img src={availableWallet.icon} alt="" />
                  <span>
                    <strong>{availableWallet.name}</strong>
                    <small>Install or open</small>
                  </span>
                  <ArrowDownToLine size={16} />
                </a>
              ))}
            </div>
          )}
        </div>

        {!detectedWallets.length && (
          <p className="wallet-help">No Aptos wallet is available on this device. Install or enable one, refresh the page, then connect again.</p>
        )}
      </aside>
    </section>
  ) : null;

  if (activePage === "landing") {
    return (
      <main className="landing-shell">
        <header className="landing-nav">
          {logo}
          <div className="landing-actions">
            {networkToggle}
            <button className="ghost-button" onClick={() => setActivePage("dashboard")}>
              Open app
            </button>
            {walletControl}
          </div>
        </header>

        <section className="landing-hero">
          <YoraMotionMark />
          <p className="hero-badge">
            <span className="hero-dot" aria-hidden="true" />
            {networkConfig.label} / encrypted Shelby storage
          </p>
          <h1>Private capsules for a specific moment.</h1>
          <p className="hero-sub">
            Yora encrypts messages and files locally, writes encrypted blobs to Shelby, and lets the
            recipient wallet unseal only after the unlock time.
          </p>
          <div className="cta-row">
            <button className="primary" onClick={() => setActivePage("create")}>
              <Plus size={18} />
              Create capsule
            </button>
            <button className="ghost-button" onClick={() => setActivePage("dashboard")}>
              <BarChart3 size={16} />
              View dashboard
            </button>
          </div>
        </section>

        <section className="flow-panel landing-flow">
          <div>
            <h3>Seal once. Open only when the rules match.</h3>
            <p>
              Yora keeps every step explicit, from local encryption to recipient unseal.
            </p>
          </div>
          <ol>
            <li>
              <strong>Encrypt</strong>
              <span>The payload is encrypted locally before anything touches storage.</span>
            </li>
            <li>
              <strong>Store</strong>
              <span>{networkConfig.shortLabel} stores encrypted blobs. If Shelby rejects the write, Yora creates no capsule.</span>
            </li>
            <li>
              <strong>Gate</strong>
              <span>The recipient wallet and unlock timestamp control access.</span>
            </li>
            <li>
              <strong>Unseal</strong>
              <span>The capsule opens only after wallet approval and unlock checks pass.</span>
            </li>
          </ol>
        </section>

        <section className="landing-proof" aria-label="Yora guarantees">
          <article>
            <span>01</span>
            <strong>Private by default</strong>
            <p>Readable content is encrypted before it leaves the device.</p>
          </article>
          <article>
            <span>02</span>
            <strong>Recipient gated</strong>
            <p>Only the selected recipient wallet can request the release key.</p>
          </article>
          <article>
            <span>03</span>
            <strong>Time locked</strong>
            <p>Capsules stay sealed until the unlock time.</p>
          </article>
        </section>
        {walletPicker}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <button className="brand-button" onClick={() => setActivePage("landing")} aria-label="Back to landing page">
          {logo}
        </button>
        <div className="topbar-cluster">
          {networkToggle}
          <div className="health-strip" aria-label="Network and storage health">
            {healthItems.map((item) => (
              <span className={`health-pill ${item.tone}`} key={item.label}>
                <small>{item.label}</small>
                {item.value}
              </span>
            ))}
          </div>
          {walletControl}
        </div>
      </header>

      <aside className="sidebar">
        <p className="nav-label">App</p>
        <nav className="nav-stack" aria-label="Yora pages">
          {appNavItems.map(([page, Icon, label]) => (
            <button
              key={page}
              className={activePage === page ? "nav-item active" : "nav-item"}
              onClick={() => setActivePage(page)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={13} />
          <span>Shelby encrypted</span>
        </div>
      </aside>

      <section className="main-stage">
        {activePage === "dashboard" && (
          <section className="page-grid dashboard-page">
            {!wallet.connected && (
              <section className="wallet-state">
                <Wallet size={20} />
                <div>
                  <strong>Connect a wallet to access your vault.</strong>
                  <p>Yora shows capsules created by, or addressed to, the active account.</p>
                </div>
                <button className="small-button" onClick={openWalletPicker}>
                  Connect wallet
                </button>
              </section>
            )}
            {wallet.connected && (isIndexLoading || indexError) && (
              <section className={`wallet-state ${isIndexLoading ? "loading-state" : ""}`}>
                {isIndexLoading ? <RefreshCw className="loading-icon" size={20} /> : <Server size={20} />}
                <div>
                  <strong>{isIndexLoading ? "Loading Shelby capsules..." : "Shelby capsules are unavailable."}</strong>
                  <p>
                    {isIndexLoading
                      ? "Yora is reading sent and received capsules from Shelby."
                      : indexError}
                  </p>
                </div>
                <button
                  className="small-button"
                  onClick={refreshShelbyIndex}
                >
                  Retry Shelby index
                </button>
              </section>
            )}

            <section className="dashboard-overview">
              <article className="hero-panel dashboard-hero-panel">
                <div>
                  <p className="eyebrow">Vault overview</p>
                  <h2>Private capsules, ready when time allows.</h2>
                  <p>
                    Track received capsules, unlock windows, and Shelby-backed encrypted storage from one focused wallet view.
                  </p>
                  <div className="dashboard-actions">
                    <button className="primary" onClick={() => setActivePage("create")}>
                      <Plus size={16} />
                      Create capsule
                    </button>
                    <button className="ghost-button" onClick={() => setActivePage("capsules")}>
                      <Archive size={16} />
                      Open vault
                    </button>
                  </div>
                </div>
              </article>

              <aside className="dashboard-status-card">
                <div className="timepiece compact dashboard-timepiece" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="dial">
                    <KeyRound size={28} />
                    <span>{readyCount}</span>
                    <small>unlockable</small>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Route</dt>
                    <dd>{networkConfig.shortLabel}</dd>
                  </div>
                  <div>
                    <dt>Key release</dt>
                    <dd>{keyReleaseModeLabel()}</dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{registryModeLabel(selectedNetwork)}</dd>
                  </div>
                </dl>
              </aside>
            </section>

            <div className="metrics-grid dashboard-metrics">
              <article className="metric-card">
                <Gauge size={19} />
                <span>{receivedCount}</span>
                <p>Received</p>
              </article>
              <article className="metric-card">
                <ArrowDownToLine size={19} />
                <span>{formatBytes(totalBytes)}</span>
                <p>Encrypted payload</p>
              </article>
              <article className="metric-card">
                <Sparkles size={19} />
                <span>{readyCount}</span>
                <p>Ready to unseal</p>
              </article>
              <article className="metric-card">
                <Clock3 size={19} />
                <span>{lockedCount}</span>
                <p>Time locked</p>
              </article>
            </div>

            <section className="dashboard-workbench">
              <article className="panel quick-actions-panel">
                <div className="section-heading">
                  <Sparkles size={21} />
                  <div>
                    <h2>Quick actions</h2>
                    <p>Jump into the flows used most often.</p>
                  </div>
                </div>
                <div className="quick-action-grid">
                  <button onClick={() => setActivePage("create")}>
                    <Plus size={16} />
                    <span>Seal new capsule</span>
                  </button>
                  <button onClick={() => setActivePage("capsules")}>
                    <Archive size={16} />
                    <span>Review vault</span>
                  </button>
                  <button onClick={() => setActivePage("transactions")}>
                    <History size={16} />
                    <span>Audit receipts</span>
                  </button>
                  <button onClick={() => setActivePage("profile")}>
                    <ShieldCheck size={16} />
                    <span>Check runtime</span>
                  </button>
                </div>
              </article>

              <article className="panel activity-panel">
                <div className="section-heading">
                  <History size={21} />
                  <div>
                    <h2>Recent activity</h2>
                    <p>{recentActivity.length ? "Latest Shelby capsule events" : "No activity for this wallet yet"}</p>
                  </div>
                </div>
                <div className="activity-list">
                  {recentActivity.length ? (
                    recentActivity.map(({ capsule, label, detail, tone }) => (
                      <button key={capsule.id} className={`activity-item ${tone}`} onClick={() => setSelectedCapsule(capsule)}>
                        <span>{label}</span>
                        <strong>{capsule.title}</strong>
                        <small>{detail}</small>
                      </button>
                    ))
                  ) : (
                    <p>Yora will show sent, received, and released capsule events here once Shelby returns capsules for this wallet.</p>
                  )}
                </div>
              </article>
            </section>

            <section className="panel recent-panel dashboard-inbox-panel">
              <div className="section-heading">
                <History size={22} />
                <div>
                  <h2>Received inbox</h2>
                  <p>{receivedInbox.length ? "Capsules addressed to this wallet" : "No received capsules found"}</p>
                </div>
              </div>
              <div className="dashboard-inbox-list">
                {isIndexLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <article className="inbox-card inbox-skeleton" aria-hidden="true" key={`inbox-skeleton-${index}`}>
                      <div className="skeleton-pill" />
                      <div className="inbox-copy">
                        <span className="skeleton-line wide" />
                        <span className="skeleton-line medium" />
                      </div>
                      <div className="skeleton-stack">
                        <span className="skeleton-line short" />
                        <span className="skeleton-line medium" />
                      </div>
                      <div className="skeleton-actions">
                        <span />
                        <span />
                      </div>
                    </article>
                  ))
                ) : receivedInbox.length ? (
                  receivedInbox.map((capsule) => {
                    const locked = Date.now() < capsule.unlockAt;
                    const opening = openingCapsuleId === capsule.id;
                    return (
                      <article className={`inbox-card ${locked ? "locked" : "ready"}`} key={capsule.id}>
                        <div className="inbox-status">
                          {locked ? <Clock3 size={15} /> : <Sparkles size={15} />}
                          <span>{locked ? "Locked" : "Ready"}</span>
                        </div>
                        <div className="inbox-copy">
                          <h3>{capsule.title}</h3>
                          <p>
                            From {formatAddress(capsule.creator)} on {formatCapsuleStorage(capsule)}
                          </p>
                        </div>
                        <dl className="inbox-facts">
                          <div>
                            <dt>Unlock</dt>
                            <dd>{formatShortDateTime(capsule.unlockAt)}</dd>
                          </div>
                          <div>
                            <dt>Payload</dt>
                            <dd>{capsule.payloadKind} / {formatBytes(capsule.sizeBytes)}</dd>
                          </div>
                        </dl>
                        <div className="inbox-actions">
                          <button className="ghost-button" onClick={() => setSelectedCapsule(capsule)}>
                            <Layers3 size={15} />
                            Details
                          </button>
                          <button
                            className="secondary"
                            onClick={() => void unsealCapsule(capsule)}
                            disabled={locked || opening}
                            title={locked ? "This capsule has not reached its unlock time." : undefined}
                          >
                            <CalendarClock size={15} />
                            {opening ? "Approve" : "Unseal"}
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state slim">
                    <KeyRound size={24} />
                    <h3>No received capsules yet.</h3>
                    <p>Capsules sent to this wallet appear here after Shelby indexes the encrypted capsule.</p>
                  </div>
                )}
              </div>
            </section>
          </section>
        )}

        {activePage === "create" && (
          <section className="page-grid">
            <form
              className="composer panel"
              onSubmit={(event) => {
                event.preventDefault();
                void sealCapsule();
              }}
            >
              <div className="section-heading">
                <FileLock2 size={22} />
                <div>
                  <h2>Seal a capsule</h2>
                  <p>Encrypt locally. Store encrypted blobs on Shelby.</p>
                </div>
              </div>
              {networkMismatch && (
                <div className="network-warning" role="status">
                  <Server size={17} />
                  <span>Your wallet is on {walletNetworkName}. Yora is set to {networkConfig.shortLabel}.</span>
                </div>
              )}
              {isAptosRegistryEnabled(selectedNetwork) && (
                <div className="registry-note" role="status">
                  <ShieldCheck size={17} />
                  <span>
                    Aptos registry is active on {networkConfig.shortLabel}. After Shelby accepts the encrypted blob,
                    Yora will ask for one registry approval to record capsule metadata on Aptos.
                  </span>
                </div>
              )}

              <label>
                Capsule name
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Launch note, handoff, private archive"
                />
              </label>

              <label>
                Recipient address
                <input
                  value={draft.recipient}
                  onChange={(event) => setDraft({ ...draft, recipient: event.target.value })}
                  placeholder="0x..."
                />
              </label>

              <label>
                Unlock time
                <input
                  type="datetime-local"
                  value={toDateTimeLocal(draft.unlockAt)}
                  onChange={(event) => setDraft({ ...draft, unlockAt: new Date(event.target.value).getTime() })}
                />
              </label>

              <div className="segmented" role="tablist" aria-label="Payload type">
                <button
                  type="button"
                  className={mode === "message" ? "active" : ""}
                  onClick={() => {
                    setMode("message");
                    setDraft((current) => ({ ...current, file: null }));
                  }}
                >
                  Message
                </button>
                <button
                  type="button"
                  className={mode === "file" ? "active" : ""}
                  onClick={() => {
                    setMode("file");
                    setDraft((current) => ({ ...current, message: "" }));
                  }}
                >
                  File
                </button>
              </div>

              {mode === "message" ? (
                <label>
                  Message
                  <textarea
                    value={draft.message}
                    onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                    rows={7}
                  />
                </label>
              ) : (
                <label className="dropzone">
                  <Upload size={22} />
                  <span>{draft.file ? `${draft.file.name} / ${draft.file.type || "file"}` : "Choose a file to encrypt"}</span>
                  <input
                    type="file"
                    onChange={(event) => setDraft({ ...draft, file: event.target.files?.[0] ?? null })}
                  />
                </label>
              )}

              <button className="primary" disabled={isBusy}>
                <Send size={18} />
                {isBusy ? "Sealing capsule..." : "Seal capsule"}
              </button>
              <div className="seal-progress" aria-label="Seal progress">
                {sealSteps.map(([step, label], index) => (
                  <span
                    className={[
                      "seal-step",
                      activeSealIndex === index ? "active" : "",
                      activeSealIndex > index || sealStep === "sealed" ? "done" : "",
                    ].join(" ").trim()}
                    key={step}
                  >
                    <Check size={13} />
                    {label}
                  </span>
                ))}
              </div>
              <p className="activity">{activity}</p>
              {lastError && sealStep === "error" && (
                <div className="error-panel" role="alert">
                  <strong>Capsule was not sealed</strong>
                  <p>{lastError}</p>
                  <div>
                    <button className="ghost-button" type="button" onClick={() => void sealCapsule()}>
                      <RefreshCw size={15} />
                      Try again
                    </button>
                    <button className="ghost-button" type="button" onClick={() => switchNetwork(selectedNetwork === "shelbynet" ? "testnet" : "shelbynet")}>
                      Switch network
                    </button>
                    <button className="ghost-button" type="button" onClick={openWalletPicker}>
                      Reconnect wallet
                    </button>
                  </div>
                </div>
              )}
            </form>

            <aside className="panel create-aside">
              <ShieldCheck size={24} />
              <h2>Storage route</h2>
              <p>Yora encrypts the payload locally, then writes the encrypted capsule to the selected Shelby route. If Shelby rejects the write, no capsule is saved.</p>
              <dl>
                <div>
                  <dt>Network</dt>
                  <dd>{networkConfig.label}</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>{networkConfig.shortLabel} blob</dd>
                </div>
                <div>
                  <dt>Algorithm</dt>
                  <dd>AES-GCM 256</dd>
                </div>
              </dl>
              <div className="payload-preview">
                <p className="eyebrow">Payload preview</p>
                {mode === "file" && draftFilePreviewUrl ? (
                  <img src={draftFilePreviewUrl} alt={`Preview of ${draft.file?.name ?? "selected file"}`} />
                ) : (
                  <div className="payload-preview-box">
                    <strong>{mode === "file" ? "File capsule" : "Message capsule"}</strong>
                    <span>{draftPayloadLabel}</span>
                  </div>
                )}
              </div>
              <div className="readiness-list">
                <p className="eyebrow">Seal readiness</p>
                {draftReadyChecks.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        )}

        {activePage === "capsules" && (
          <section className="panel capsule-vault-page">
            <div className="vault-header">
              <div className="section-heading">
                <Archive size={22} />
                <div>
                  <h2>Capsule vault</h2>
                  <p>
                    {visibleCapsules.length
                      ? `${capsuleCountLabel(filteredCapsules.length)} shown from ${capsuleCountLabel(visibleCapsules.length)}`
                      : "No capsules for this wallet"}
                  </p>
                </div>
              </div>
              <button className="primary" onClick={() => setActivePage("create")}>
                <Plus size={16} />
                New capsule
              </button>
            </div>

            <div className="capsule-summary">
              <article>
                <span>Total</span>
                <strong>{sealedCount}</strong>
              </article>
              <article>
                <span>Received</span>
                <strong>{receivedCount}</strong>
              </article>
              <article>
                <span>Locked</span>
                <strong>{lockedCount}</strong>
              </article>
              <article>
                <span>Unlockable</span>
                <strong>{readyCount}</strong>
              </article>
            </div>

            {lastSealReceipt && (
              <section className="capsule-receipt-panel" aria-label="Latest capsule receipt">
                <div>
                  <p className="eyebrow">Capsule sealed</p>
                  <h3>{lastSealReceipt.capsule.title}</h3>
                  <p>
                    Encrypted payload stored on Shelby. Only the recipient wallet can unseal it after the unlock time.
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Recipient</dt>
                    <dd>{formatAddress(lastSealReceipt.capsule.recipient)}</dd>
                  </div>
                  <div>
                    <dt>Unlock</dt>
                    <dd>{formatShortDateTime(lastSealReceipt.capsule.unlockAt)}</dd>
                  </div>
                  <div>
                    <dt>Shelby receipt</dt>
                    <dd>{storageReceiptId(lastSealReceipt.capsule)}</dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{lastSealReceipt.registryStatus === "recorded" ? "Recorded on Aptos" : "Optional"}</dd>
                  </div>
                </dl>
                <div className="receipt-actions">
                  <a className="receipt-action" href={shelbyExplorerBlobUrl(lastSealReceipt.capsule)} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} />
                    Shelby blob
                  </a>
                  {lastSealReceipt.capsule.registryTxHash && (
                    <a
                      className="receipt-action"
                      href={aptosExplorerTxUrl(lastSealReceipt.capsule.registryTxHash, lastSealReceipt.capsule.shelbyNetwork ?? selectedNetwork)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={13} />
                      Registry tx
                    </a>
                  )}
                  <button className="copy-chip" onClick={() => copyToClipboard(lastSealReceipt.capsule.ciphertextDigest)}>
                    <Copy size={13} />
                    Copy digest
                  </button>
                  <button className="drawer-close" onClick={() => setLastSealReceipt(null)} aria-label="Dismiss receipt">
                    <X size={15} />
                  </button>
                </div>
              </section>
            )}

            <section className="capsule-controls" aria-label="Capsule search and filters">
              <label className="capsule-search">
                <Search size={17} />
                <input
                  value={capsuleSearch}
                  onChange={(event) => setCapsuleSearch(event.target.value)}
                  placeholder="Search title, address, digest, receipt..."
                  aria-label="Search capsules"
                />
              </label>
              <div className="capsule-filter-strip" aria-label="Filter capsules">
                {capsuleFilterOptions.map(([filter, label, count]) => (
                  <button
                    type="button"
                    className={capsuleFilter === filter ? "active" : ""}
                    onClick={() => setCapsuleFilter(filter)}
                    key={filter}
                  >
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </button>
                ))}
              </div>
              {(capsuleFilter !== "all" || capsuleSearch.trim()) && (
                <button
                  className="ghost-button clear-filters"
                  type="button"
                  onClick={() => {
                    setCapsuleFilter("all");
                    setCapsuleSearch("");
                  }}
                >
                  Clear filters
                </button>
              )}
            </section>

            {!isIndexLoading && indexError && (
              <section className="empty-state slim state-warning" role="status">
                <Server size={24} />
                <h3>Shelby index needs another read.</h3>
                <p>{indexError}</p>
                <button className="ghost-button" type="button" onClick={refreshShelbyIndex}>
                  <RefreshCw size={15} />
                  Retry Shelby index
                </button>
              </section>
            )}

            <div className="cards">
              {isIndexLoading && !visibleCapsules.length && (
                Array.from({ length: 3 }).map((_, index) => (
                  <article className="capsule-card capsule-skeleton" aria-hidden="true" key={`capsule-skeleton-${index}`}>
                    <div className="card-top">
                      <span className="skeleton-pill" />
                      <span className="skeleton-pill muted" />
                    </div>
                    <span className="skeleton-line title" />
                    <span className="skeleton-line medium" />
                    <div className="skeleton-list">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="storage-receipt skeleton-receipt">
                      <div>
                        <span className="skeleton-line short" />
                        <span className="skeleton-line wide" />
                        <span className="skeleton-line medium" />
                      </div>
                      <span className="skeleton-button" />
                    </div>
                    <div className="capsule-actions skeleton-actions">
                      <span />
                      <span />
                    </div>
                  </article>
                ))
              )}
              {!isIndexLoading && !visibleCapsules.length && (
                <div className="capsule-empty-shell">
                  <div className="empty-state capsule-empty">
                    <div className="empty-orb">
                      <KeyRound size={30} />
                    </div>
                    <div>
                      <p className="eyebrow">Vault ready</p>
                      <h3>No capsules for this wallet yet.</h3>
                      <p>Create a capsule, or connect the recipient wallet another sender used.</p>
                    </div>
                    <button className="primary" onClick={() => setActivePage("create")}>
                      <Plus size={16} />
                      Create capsule
                    </button>
                  </div>
                </div>
              )}
              {!isIndexLoading && visibleCapsules.length > 0 && !filteredCapsules.length && (
                <div className="capsule-empty-shell">
                  <div className="empty-state capsule-empty">
                    <div className="empty-orb">
                      <Search size={28} />
                    </div>
                    <div>
                      <p className="eyebrow">No matches</p>
                      <h3>No capsules match this view.</h3>
                      <p>Adjust the filter or search term to view more capsules from this wallet.</p>
                    </div>
                    <button
                      className="primary"
                      onClick={() => {
                        setCapsuleFilter("all");
                        setCapsuleSearch("");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              )}
              {filteredCapsules.map((capsule) => {
                const isRecipient = sameAddress(capsule.recipient, connectedAddress);
                const isCreator = sameAddress(capsule.creator, connectedAddress);
                const locked = Date.now() < capsule.unlockAt;
                const direction = isRecipient ? "received" : isCreator ? "sent" : "external";
                return (
                  <article className={`capsule-card capsule-${direction}`} key={capsule.id}>
                    <div className="card-top">
                      <span className={`status ${locked ? "locked" : "ready"}`}>
                        {locked ? <Clock3 size={13} /> : <Check size={13} />}
                        {locked ? "Locked" : "Unlockable"}
                      </span>
                      <span className={`direction-badge ${direction}`}>
                        {isRecipient ? <CornerDownLeft size={13} /> : <CornerUpRight size={13} />}
                        {isRecipient ? "Received" : isCreator ? "Sent" : formatCapsuleStorage(capsule)}
                      </span>
                      <span
                        className={`status ${registryDisplayClass(capsule)}`}
                        title={registryDisplayTitle(capsule)}
                      >
                        <ShieldCheck size={13} />
                        {shortRegistryStatus(capsule)}
                      </span>
                    </div>
                    <h3>{capsule.title}</h3>
                    <p className="capsule-note">
                      {isRecipient
                        ? `Received from ${formatAddress(capsule.creator)} on ${new Date(capsule.createdAt).toLocaleDateString()}`
                        : `Sent to ${formatAddress(capsule.recipient)} on ${new Date(capsule.createdAt).toLocaleDateString()}`}
                    </p>
                    <dl>
                      <div>
                        <dt>{isRecipient ? "Sender" : "Recipient"}</dt>
                        <dd>{formatAddress(isRecipient ? capsule.creator : capsule.recipient)}</dd>
                      </div>
                      <div>
                        <dt>Direction</dt>
                        <dd>{isRecipient ? "Inbound" : "Outbound"}</dd>
                      </div>
                      <div>
                        <dt>Unlock time</dt>
                        <dd>{new Date(capsule.unlockAt).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Payload</dt>
                        <dd>{capsule.payloadKind} / {formatBytes(capsule.sizeBytes)}</dd>
                      </div>
                    </dl>
                    <div className="storage-receipt">
                      <div>
                        <span>Stored on Shelby</span>
                        <strong>{storageReceiptId(capsule)}</strong>
                        <small>{formatCapsuleStorage(capsule)} / {shortRegistryStatus(capsule)}</small>
                      </div>
                      <div className="receipt-link-stack">
                        <a className="receipt-action" href={shelbyExplorerBlobUrl(capsule)} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} />
                          Shelby
                        </a>
                        {capsule.registryTxHash && (
                          <a
                            className="receipt-action"
                            href={aptosExplorerTxUrl(capsule.registryTxHash, capsule.shelbyNetwork ?? selectedNetwork)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={13} />
                            Registry
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="capsule-actions">
                      <button className="ghost-button" onClick={() => setSelectedCapsule(capsule)}>
                        <Layers3 size={16} />
                        Details
                      </button>
                      <button
                        className="secondary"
                        onClick={() => void unsealCapsule(capsule)}
                        disabled={!isRecipient || locked || openingCapsuleId === capsule.id}
                        title={!isRecipient ? "Only the recipient wallet can unseal this capsule." : locked ? "This capsule has not reached its unlock time." : undefined}
                      >
                        <CalendarClock size={16} />
                        {isRecipient ? (openingCapsuleId === capsule.id ? "Approve unseal" : "Unseal") : "Sender view"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {activePage === "transactions" && (
          <section className="panel transactions-page">
            <div className="section-heading">
              <History size={22} />
              <div>
                <h2>Transaction history</h2>
                <p>Capsules created by this wallet, with Shelby and registry receipts</p>
              </div>
            </div>
            <div className="transaction-table">
              <div className="transaction-head">
                <span>Status</span>
                <span>Capsule</span>
                <span>Receipt</span>
                <span>Shelby</span>
                <span>Digest</span>
                <span>Registry</span>
                <span>Time</span>
              </div>
              {transactionCapsules.length ? (
                transactionCapsules.map((rawCapsule) => {
                  const capsule = withLocalReceipt(rawCapsule);
                  const isExpanded = expandedTransactionId === capsule.id;
                  const registryDone =
                    capsule.registryVerification?.status === "verified" ||
                    capsule.registryVerification?.status === "released" ||
                    Boolean(capsule.registryTxHash);
                  const released =
                    capsule.registryVerification?.status === "released" ||
                    Boolean(capsule.releaseTxHash) ||
                    openedCapsuleSet.has(capsule.id);
                  const registryEnabled = isAptosRegistryEnabled(capsule.shelbyNetwork ?? selectedNetwork);
                  const milestones = [
                    ["Encrypted", "done"],
                    ["Shelby stored", "done"],
                    ["Registry", registryEnabled ? milestoneState(registryDone, true) : "pending"],
                    ["Key escrow", isRemoteKeyReleaseEnabled() ? "done" : "pending"],
                    ["Unsealed", milestoneState(released)],
                    ["Release marker", milestoneState(Boolean(capsule.releaseTxHash), released && !capsule.releaseTxHash)],
                  ] as Array<[string, "done" | "active" | "pending"]>;
                  return (
                    <article key={capsule.id} className="transaction-row">
                      <button
                        className={`transaction-status-toggle ${isExpanded ? "active" : ""}`}
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedTransactionId(isExpanded ? null : capsule.id)}
                      >
                        <span className="status ready">
                          <Check size={13} />
                          Sealed
                        </span>
                        <small>{isExpanded ? "Hide lifecycle" : "View lifecycle"}</small>
                      </button>
                      <strong>{capsule.title}</strong>
                      <span className="receipt-cell">
                        <Server size={13} />
                        <span>
                          <strong>{storageReceiptId(capsule)}</strong>
                          <small>{formatCapsuleStorage(capsule)}</small>
                        </span>
                      </span>
                      <a className="explorer-link" href={shelbyExplorerBlobUrl(capsule)} target="_blank" rel="noreferrer">
                        <ExternalLink size={13} />
                        Shelby
                      </a>
                      <button className="copy-chip" onClick={() => copyToClipboard(capsule.ciphertextDigest)}>
                        {shortDigest(capsule.ciphertextDigest)}
                      </button>
                      {capsule.registryTxHash ? (
                        <a
                          className="explorer-link"
                          href={aptosExplorerTxUrl(capsule.registryTxHash, capsule.shelbyNetwork ?? selectedNetwork)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={13} />
                          {shortRegistryStatus(capsule)}
                        </a>
                      ) : (
                        <span className={`status ${registryDisplayClass(capsule)}`} title={registryDisplayTitle(capsule)}>
                          <ShieldCheck size={13} />
                          {shortRegistryStatus(capsule)}
                        </span>
                      )}
                      <time>{new Date(capsule.createdAt).toLocaleString()}</time>
                      {isExpanded && (
                        <div className="transaction-progress" aria-label={`Capsule lifecycle for ${capsule.title}`}>
                          {milestones.map(([label, state]) => (
                            <span className={state} key={label}>
                              {state === "done" ? <Check size={12} /> : <Clock3 size={12} />}
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })
              ) : (
                <div className="empty-state slim">
                  <History size={24} />
                  <h3>No created capsules yet.</h3>
                  <p>Seal a capsule from this wallet to create its first Shelby storage receipt.</p>
                  <button className="ghost-button" onClick={() => setActivePage("create")}>
                    Create capsule
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {activePage === "profile" && (
          <section className="profile-page">
            <div className="panel profile-card">
              <div className="profile-avatar">
                <Fingerprint size={40} />
              </div>
              <div className="profile-info">
                <h2>{wallet.connected ? "Wallet profile" : "No wallet connected"}</h2>
                <p>{connectedAddress || "Connect an Aptos wallet to manage sent, received, and unlockable capsules."}</p>
                <div className="profile-meta">
                  <span>{networkConfig.shortLabel}</span>
                  <span>{wallet.wallet?.name ?? "No wallet"}</span>
                  <span>{walletNetworkName || "No network"}</span>
                </div>
              </div>
              <div className="profile-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(connectedAddress);
                    setActivity("Wallet address copied to clipboard.");
                  }}
                  disabled={!connectedAddress}
                >
                  <Copy size={16} />
                  Copy address
                </button>
                {wallet.connected ? (
                  <button className="ghost-button" onClick={() => wallet.disconnect()}>
                    <LogOut size={16} />
                    Disconnect
                  </button>
                ) : (
                  <button className="ghost-button" onClick={openWalletPicker}>
                    <Wallet size={16} />
                    Connect wallet
                  </button>
                )}
              </div>
            </div>

            <div className="panel profile-stats">
              <article>
                <span>Received</span>
                <strong>{receivedCount}</strong>
                <p>Capsules addressed to this wallet</p>
              </article>
              <article>
                <span>Unlockable</span>
                <strong>{readyCount}</strong>
                <p>Received capsules past their unlock time</p>
              </article>
              <article>
                <span>Sent</span>
                <strong>{sentCount}</strong>
                <p>Capsules sealed by this wallet</p>
              </article>
              <article>
                <span>Opened</span>
                <strong>{openedCount}</strong>
                <p>Capsules unsealed from this browser</p>
              </article>
            </div>

            <div className="panel settings-panel">
              <div className="section-heading">
                <Settings size={22} />
                <div>
                  <h2>Vault summary</h2>
                  <p>Current wallet, route, and protocol state</p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Yora route</dt>
                  <dd>{networkConfig.label}</dd>
                </div>
                <div>
                  <dt>Wallet network</dt>
                  <dd>{walletNetworkName || "Not connected"}</dd>
                </div>
                <div>
                  <dt>Storage mode</dt>
                  <dd>Shelby encrypted blobs</dd>
                </div>
                <div>
                  <dt>Key release</dt>
                  <dd>{keyReleaseModeLabel()}</dd>
                </div>
                <div>
                  <dt>Registry</dt>
                  <dd>{registryModeLabel(selectedNetwork)}</dd>
                </div>
                <div>
                  <dt>Total payload</dt>
                  <dd>{formatBytes(totalBytes)}</dd>
                </div>
                <div>
                  <dt>Activity</dt>
                  <dd>{activity}</dd>
                </div>
              </dl>
            </div>

            <div className="panel security-panel">
              <div className="section-heading">
                <ShieldCheck size={22} />
                <div>
                  <h2>Security posture</h2>
                  <p>How this wallet is protected in the current route</p>
                </div>
              </div>
              <div className="security-checks">
                <article className="ready">
                  <Check size={15} />
                  <div>
                    <strong>Local encryption</strong>
                    <p>Payload bytes are encrypted before Shelby storage.</p>
                  </div>
                </article>
                <article className={isRemoteKeyReleaseEnabled() ? "ready" : "pending"}>
                  {isRemoteKeyReleaseEnabled() ? <Check size={15} /> : <Clock3 size={15} />}
                  <div>
                    <strong>Remote key release</strong>
                    <p>{isRemoteKeyReleaseEnabled() ? "Cross-browser unseal is available." : "Browser-only key vault is active."}</p>
                  </div>
                </article>
                <article className={isAptosRegistryEnabled(selectedNetwork) ? "ready" : "pending"}>
                  {isAptosRegistryEnabled(selectedNetwork) ? <Check size={15} /> : <Clock3 size={15} />}
                  <div>
                    <strong>Aptos registry</strong>
                    <p>{isAptosRegistryEnabled(selectedNetwork) ? "Capsule receipts can be recorded on Aptos." : "Registry receipts are optional for this route."}</p>
                  </div>
                </article>
              </div>
            </div>
          </section>
        )}

        <section className="assurance">
          <div>
            <ShieldCheck size={20} />
            <h2>Shelby storage boundary</h2>
          </div>
          <p>
            Yora encrypts payloads locally and writes each new capsule as an encrypted Shelby blob.
            If Shelby rejects the write, Yora does not create the capsule.
          </p>
          <span className="runtime-chip">{RUNTIME_VERSION} / {indexStatus}</span>
        </section>
      </section>

      {selectedCapsuleView && (
        <section className="drawer-backdrop" onClick={() => setSelectedCapsule(null)}>
          <aside
            className={`capsule-drawer ${selectedCapsuleIsRecipient ? "recipient-view" : "sender-view"}`}
            aria-label="Capsule details"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="drawer-close" onClick={() => setSelectedCapsule(null)} aria-label="Close capsule details">
              <X size={17} />
            </button>
            <div className="drawer-hero">
              <p className="eyebrow">{selectedCapsuleDirection}</p>
              <h2>{selectedCapsuleView.title}</h2>
              <p>
                {selectedCapsuleIsRecipient
                  ? `Received from ${formatAddress(selectedCapsuleView.creator)} on ${formatShortDateTime(selectedCapsuleView.createdAt)}.`
                  : `Sent to ${formatAddress(selectedCapsuleView.recipient)} on ${formatShortDateTime(selectedCapsuleView.createdAt)}.`}
              </p>
            </div>
            <div className="drawer-status">
              <span className={`status ${selectedCapsuleLocked ? "locked" : "ready"}`}>
                {selectedCapsuleLocked ? <Clock3 size={13} /> : <Check size={13} />}
                {selectedCapsuleLocked ? "Locked by time" : "Unlockable"}
              </span>
              <span className={`status ${selectedCapsuleIsRecipient ? "ready" : "warning"}`}>
                {selectedCapsuleIsRecipient ? <CornerDownLeft size={13} /> : <CornerUpRight size={13} />}
                {selectedCapsuleIsRecipient ? "Recipient view" : "Sender view"}
              </span>
              <span className="status shelby">
                <Server size={13} />
                {formatCapsuleStorage(selectedCapsuleView)}
              </span>
              <span
                className={`status ${registryDisplayClass(selectedCapsuleView)}`}
                title={registryDisplayTitle(selectedCapsuleView)}
              >
                <ShieldCheck size={13} />
                {shortRegistryStatus(selectedCapsuleView)}
              </span>
            </div>
            <div className="drawer-summary-grid">
              <article>
                <span>Recipient</span>
                <strong>{formatAddress(selectedCapsuleView.recipient)}</strong>
              </article>
              <article>
                <span>Unlock</span>
                <strong>{formatShortDateTime(selectedCapsuleView.unlockAt)}</strong>
              </article>
              <article>
                <span>Payload</span>
                <strong>{selectedCapsuleView.payloadKind} / {formatBytes(selectedCapsuleView.sizeBytes)}</strong>
              </article>
              <article>
                <span>Release</span>
                <strong>{selectedCapsuleReleased ? "Recorded" : "Pending"}</strong>
              </article>
            </div>
            <div className="storage-receipt drawer-receipt">
              <div>
                <span>Shelby storage receipt</span>
                <strong>{storageReceiptId(selectedCapsuleView)}</strong>
                <small>{formatCapsuleStorage(selectedCapsuleView)} / encrypted blob</small>
              </div>
              <a className="receipt-action" href={shelbyExplorerBlobUrl(selectedCapsuleView)} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />
                Open Shelby
              </a>
              {selectedCapsuleView.registryTxHash && (
                <a
                  className="receipt-action"
                  href={aptosExplorerTxUrl(selectedCapsuleView.registryTxHash ?? "", selectedCapsuleView.shelbyNetwork ?? selectedNetwork)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                  Registry tx
                </a>
              )}
            </div>
            <div className="drawer-rule-list">
              <article className={selectedCapsuleIsRecipient ? "ready" : "pending"}>
                {selectedCapsuleIsRecipient ? <Check size={15} /> : <Clock3 size={15} />}
                <div>
                  <strong>Wallet gate</strong>
                  <p>{selectedCapsuleIsRecipient ? "The active wallet matches the recipient address." : "Only the recipient wallet can unseal this capsule."}</p>
                </div>
              </article>
              <article className={!selectedCapsuleLocked ? "ready" : "pending"}>
                {!selectedCapsuleLocked ? <Check size={15} /> : <Clock3 size={15} />}
                <div>
                  <strong>Unlock window</strong>
                  <p>{!selectedCapsuleLocked ? "The unlock timestamp has passed." : `Available after ${formatShortDateTime(selectedCapsuleView.unlockAt)}.`}</p>
                </div>
              </article>
              <article className={selectedCapsuleReleased ? "ready" : "pending"}>
                {selectedCapsuleReleased ? <Check size={15} /> : <Clock3 size={15} />}
                <div>
                  <strong>Release marker</strong>
                  <p>{selectedCapsuleReleased ? "This capsule has already been opened or marked released." : "Yora will record release status after a successful unseal."}</p>
                </div>
              </article>
            </div>
            <div className="drawer-sections">
              <section>
                <h3>Access rules</h3>
                <dl>
                  <div>
                    <dt>Recipient</dt>
                    <dd>{selectedCapsuleView.recipient}</dd>
                  </div>
                  <div>
                    <dt>Sender</dt>
                    <dd>{formatAddress(selectedCapsuleView.creator)}</dd>
                  </div>
                  <div>
                    <dt>Unlock time</dt>
                    <dd>{new Date(selectedCapsuleView.unlockAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>Storage</h3>
                <dl>
                  <div>
                    <dt>Route</dt>
                    <dd>{formatCapsuleStorage(selectedCapsuleView)}</dd>
                  </div>
                  <div>
                    <dt>Blob name</dt>
                    <dd>{selectedCapsuleView.blobName}</dd>
                  </div>
                  <div>
                    <dt>Registry tx</dt>
                    <dd>{registryTxLabel(selectedCapsuleView)}</dd>
                  </div>
                  <div>
                    <dt>Registry status</dt>
                    <dd>{registryStatusLabel(selectedCapsuleView.registryVerification)}</dd>
                  </div>
                  <div>
                    <dt>Release tx</dt>
                    <dd>{selectedCapsuleView.releaseTxHash ? shortDigest(selectedCapsuleView.releaseTxHash ?? "") : "Not recorded"}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>Payload</h3>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedCapsuleView.payloadKind} / {formatBytes(selectedCapsuleView.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>Digest</dt>
                    <dd>{selectedCapsuleView.ciphertextDigest}</dd>
                  </div>
                </dl>
              </section>
            </div>
            <button
              className="primary"
              onClick={() => void unsealCapsule(selectedCapsuleView)}
              disabled={!selectedCapsuleCanUnseal}
            >
              <CalendarClock size={16} />
              {openingCapsuleId === selectedCapsuleView.id
                ? "Awaiting wallet approval..."
                : selectedCapsuleIsRecipient
                  ? "Unseal capsule"
                  : "Recipient wallet required"}
            </button>
          </aside>
        </section>
      )}

      {walletPicker}

      {opened && (
        <section className="opened-backdrop" aria-live="polite" onClick={() => setOpened(null)}>
          <div className="opened-modal" role="dialog" aria-modal="true" aria-label="Unsealed capsule" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setOpened(null)} aria-label="Close unsealed capsule">
              <X size={17} />
            </button>
            <p className="eyebrow">Unsealed capsule</p>
            <h2>{opened.title}</h2>
            {opened.payloadKind === "message" ? (
              <div className="opened-content">
                <p>{opened.text ?? ""}</p>
              </div>
            ) : (
              <div className="opened-content file-preview">
                {isPreviewableImage(opened.mimeType, opened.fileName) && opened.url ? (
                  <img src={opened.url} alt={`Unsealed file from ${opened.title}`} />
                ) : opened.mimeType === "application/pdf" && opened.url ? (
                  <iframe src={opened.url} title={`Unsealed PDF from ${opened.title}`} />
                ) : opened.mimeType?.startsWith("audio/") && opened.url ? (
                  <audio src={opened.url} controls />
                ) : opened.mimeType?.startsWith("video/") && opened.url ? (
                  <video src={opened.url} controls />
                ) : (
                  <p>Preview is not available for this file type. Download the decrypted file instead.</p>
                )}
                <a className="primary download-file" href={opened.url} download>
                  <ArrowDownToLine size={16} />
                  Download decrypted file
                </a>
              </div>
            )}
            <div className="unseal-receipt">
              <span className={`status ${opened.releaseMarkerStatus === "recorded" ? "ready" : "locked"}`}>
                {opened.releaseMarkerStatus === "recorded" ? <Check size={13} /> : <Clock3 size={13} />}
                {opened.releaseMarkerStatus === "pending"
                  ? "Recording release marker"
                  : opened.releaseMarkerStatus === "recorded"
                    ? "Release marker recorded"
                    : "Release marker not recorded"}
              </span>
              {opened.releaseTxHash && (
                <a className="receipt-action" href={aptosExplorerTxUrl(opened.releaseTxHash, selectedNetwork)} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                  Release tx
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {unsealIssue && (
        <section className="opened-backdrop" aria-live="polite" onClick={() => setUnsealIssue(null)}>
          <div className="opened-modal issue-modal" role="alertdialog" aria-modal="true" aria-label="Unseal issue" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setUnsealIssue(null)} aria-label="Close unseal issue">
              <X size={17} />
            </button>
            <p className="eyebrow">Unseal status</p>
            <h2>{unsealIssue.title}</h2>
            <div className="opened-content">
              <p>{unsealIssue.message}</p>
            </div>
            <div className="issue-actions">
              <button className="ghost-button" onClick={() => setUnsealIssue(null)}>
                Close
              </button>
              <button className="secondary" onClick={openWalletPicker}>
                <Wallet size={16} />
                Check wallet
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
