import { Request, Response } from "express";
import * as QRCode from "qrcode";
import * as crypto from "crypto";
import { BN } from "bn.js";
import {
  DataPacketRequestDetails,
  DataPacketRequestOrdinalVDXFObject,
  DataDescriptor,
  CompactAddressObject,
  CompactIAddressObject,
  VerifiableSignatureData,
  URLRef,
  VdxfUniValue,
  CrossChainDataRefKey,
  CrossChainDataRef,
  AuthenticationRequestDetails,
  AuthenticationRequestOrdinalVDXFObject,
  RecipientConstraint,
  MMRDescriptor,
  SignatureData,
  SignatureDataKey,
  MMRDescriptorKey,
  DataDescriptorKey
} from "verus-typescript-primitives";
import { primitives, VerusIdInterface } from "verusid-ts-client";
import {
  ValidationError,
  RedirectInput,
  requireString,
  parseJsonField,
  parseAddress,
  buildGenericRequestFromDetails,
  signRequest,
  getRpcConfig,
  SYSTEM_ID_TESTNET
} from "../utils";

// ── Types ─────────────────────────────────────────────────────────────

type MmrDataEntry = {
  flags?: number;
  label: string;
  mimetype?: string;
  message: string;
};

type CreateAttestationTabPayload = {
  signingId: string;
  encryptToAddress: string;
  attestationLabel: string;
  mmrdata: MmrDataEntry[];
};

type SignAttestationPacketPayload = {
  signingId?: string;
  signableObjects?: unknown;
  requestId?: string;
  downloadUrl?: string;
  dataHash?: string;
  recipientIdentity?: string;
};

type GenerateAttestationQrPayload = {
  signingId?: string;
  signableObjects?: unknown;
  requestId?: string;
  redirects?: unknown;
  downloadUrl?: string;
  dataHash?: string;
  signature?: unknown;
  recipientIdentity?: string;
};

// ── Helpers (shared with dataPacket.ts) ──────────────────────────────

function buildUrlDataDescriptor(url: string, dataHash?: string): DataDescriptor {
  const dataHashBuffer = validateDataHash(dataHash);
  const urlRefParams: Record<string, unknown> = { version: URLRef.LAST_VERSION, url: url };
  if (dataHashBuffer) {
    urlRefParams.flags = URLRef.FLAG_HAS_HASH;
    urlRefParams.data_hash = dataHashBuffer;
  }
  const urlRef = new URLRef(urlRefParams as any);
  const ccdref = new CrossChainDataRef(urlRef);
  const urlRefMap: Array<{[key: string]: any}> = [];
  urlRefMap.push({ [CrossChainDataRefKey.vdxfid]: ccdref });
  const urlRefUniValue = new VdxfUniValue({ values: urlRefMap });
  const urlDescriptor = DataDescriptor.fromJson({
    version: 1,
    objectdata: urlRefUniValue.toBuffer().toString('hex')
  });
  return urlDescriptor;
}

function validateDataHash(dataHash: string | undefined): Buffer | undefined {
  if (!dataHash) return undefined;
  const trimmed = dataHash.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new ValidationError("Data hash must be exactly 32 bytes (64 hex characters).");
  }
  return Buffer.from(trimmed, 'hex');
}

function parseSignableObjects(value: unknown): DataDescriptor[] {
  if (value == null || value === "" || value === "[]") {
    return [];
  }
  let parsed: unknown[];
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for signableObjects: ${message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new ValidationError("signableObjects must be a JSON array.");
  }
  if (!Array.isArray(parsed)) {
    throw new ValidationError("signableObjects must be a JSON array.");
  }
  return parsed.map((obj, index) => {
    try {
      const objAny = obj as Record<string, unknown>;
      const objWithVersion = {
        ...objAny,
        version: objAny.version != null ? new BN(objAny.version as number) : new BN(1),
        flags: objAny.flags != null ? new BN(objAny.flags as number) : new BN(0)
      };
      return DataDescriptor.fromJson(objWithVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid object";
      throw new ValidationError(`Invalid DataDescriptor at index ${index}: ${message}`);
    }
  });
}

function parseSignature(value: unknown): VerifiableSignatureData | undefined {
  if (value == null || value === "" || value === "{}") return undefined;
  let parsed: Record<string, unknown>;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for signature: ${message}`);
    }
  } else if (typeof value === "object" && value !== null) {
    parsed = value as Record<string, unknown>;
  } else {
    throw new ValidationError("signature must be a JSON object.");
  }
  try { return VerifiableSignatureData.fromJson(parsed as any); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature object";
    throw new ValidationError(`Invalid VerifiableSignatureData: ${message}`);
  }
}

// Fixed flags for the create-attestation tab
function getAttestationFlags(): InstanceType<typeof BN> {
  return DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
    .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
    .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
}

function applyUserControlledFlags(details: DataPacketRequestDetails, originalFlags: InstanceType<typeof BN>): void {
  const userControlledFlags = originalFlags.and(
    DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE
      .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
      .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD)
  );
  details.flags = details.flags.or(userControlledFlags);
}

function buildRecipientAuthDetails(recipientAddress: CompactIAddressObject): AuthenticationRequestOrdinalVDXFObject {
  const recipientConstraints = new RecipientConstraint({
    type: RecipientConstraint.REQUIRED_ID,
    identity: recipientAddress
  });
  const authDetails = new AuthenticationRequestDetails({
    recipientConstraints: [recipientConstraints]
  });
  return new AuthenticationRequestOrdinalVDXFObject({ data: authDetails });
}

// ── Create Attestation (same as dataPacket.ts createAttestation) ─────

export async function createAttestationForTab(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as CreateAttestationTabPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();

    const signingId = requireString(payload.signingId, "signingId");
    const encryptToAddress = requireString(payload.encryptToAddress, "encryptToAddress");
    const attestationLabel = requireString(payload.attestationLabel, "attestationLabel");

    if (!Array.isArray(payload.mmrdata) || payload.mmrdata.length === 0) {
      throw new ValidationError("mmrdata must be a non-empty array of data entries.");
    }

    const mmrdata = payload.mmrdata.map((entry, i) => {
      if (!entry.label || typeof entry.label !== "string") {
        throw new ValidationError(`mmrdata[${i}].label is required (VDXF key i-address).`);
      }
      if (!entry.message || typeof entry.message !== "string") {
        throw new ValidationError(`mmrdata[${i}].message is required.`);
      }
      return {
        flags: entry.flags ?? 0,
        label: entry.label.trim(),
        mimetype: entry.mimetype || "text/plain",
        message: entry.message
      };
    });

    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      { auth: { username: rpcUser, password: rpcPassword } }
    );

    const signDataParams = {
      address: signingId,
      createmmr: true,
      encrypttoaddress: encryptToAddress,
      mmrdata: mmrdata
    };

    console.log("Calling signdata for attestation (create-attestation tab):", JSON.stringify(signDataParams, null, 2));

    const sigRes = await verusId.interface.request({
      cmd: "signdata",
      getParams: () => [signDataParams]
    } as any);

    if (sigRes.error) {
      throw new Error(sigRes.error.message || "RPC signdata failed.");
    }

    const result = sigRes.result as Record<string, unknown>;
    if (!result) throw new Error("RPC signdata returned no result.");

    const mmrdescriptorJson = result.mmrdescriptor as Record<string, unknown>;
    const signaturedataJson = result.signaturedata as Record<string, unknown>;
    if (!mmrdescriptorJson) throw new Error("signdata response missing mmrdescriptor.");
    if (!signaturedataJson) throw new Error("signdata response missing signaturedata.");

    const mmr = MMRDescriptor.fromJson(mmrdescriptorJson as any);
    const signaturedataObj = SignatureData.fromJson(signaturedataJson as any);

    // Build the inner VdxfUniValue: MMRDescriptor + SignatureData
    const innerMap: Array<{[key: string]: any}> = [];
    innerMap.push({ [MMRDescriptorKey.vdxfid]: mmr });
    innerMap.push({ [SignatureDataKey.vdxfid]: signaturedataObj });
    const innerUniValue = new VdxfUniValue({ values: innerMap });

    // Wrap in a DataDescriptor with the attestation label
    const containingDataDescriptor = new DataDescriptor({
      version: new BN(1),
      flags: new BN(0),
      label: attestationLabel,
      objectdata: innerUniValue.toBuffer()
    });
 
    // Serialize to hex and compute hash
    const pastebinHex = containingDataDescriptor.toBuffer().toString('hex');
    const pastebinHash = crypto.createHash('sha256').update(Buffer.from(pastebinHex, 'hex')).digest('hex');

    let pastebinJson: unknown;
    try {
      pastebinJson = containingDataDescriptor.toJson();
    } catch {
      pastebinJson = { note: "Could not serialize to JSON" };
    }

    res.json({
      pastebinHex,
      pastebinHash,
      pastebinJson,
      rawSigndataResult: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) console.error("Create attestation (tab) failed:", error);
    res.status(status).json({ error: message });
  }
}

// ── Sign DataPacket for attestation tab ─────────────────────────────

export async function signAttestationPacket(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as SignAttestationPacketPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");

    const flags = getAttestationFlags();
    const requestId = parseAddress(payload.requestId, "requestId");

    // Build signableObjects from the URL descriptor
    let signableObjects: DataDescriptor[] = [];
    const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
    if (downloadUrl) {
      const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
      signableObjects = [buildUrlDataDescriptor(downloadUrl, dataHash)];
    } else {
      signableObjects = parseSignableObjects(payload.signableObjects);
    }

    const detailsParams: Record<string, unknown> = {
      version: new BN(1),
      flags: flags,
      signableObjects: signableObjects
    };

    if (requestId) {
      detailsParams.requestID = requestId;
    }

    const details = new DataPacketRequestDetails(detailsParams as any);
    applyUserControlledFlags(details, flags);
    console.log("Constructed DataPacketRequestDetails for attestation tab:", details.toJson());

    const messageHex = details.toBuffer().toString("hex");

    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      { auth: { username: rpcUser, password: rpcPassword } }
    );

    const sigRes = await verusId.interface.request({
      cmd: "signdata",
      getParams: () => [{
        address: signingId,
        messagehex: messageHex
      }]
    } as any);

    if (sigRes.error) throw new Error(sigRes.error.message || "RPC signdata failed.");

    const result = sigRes.result as Record<string, unknown>;
    if (!result || typeof result.signature !== "string") {
      throw new Error("RPC signdata returned no valid signature.");
    }

    const verifiableSignature = VerifiableSignatureData.fromCLIJson(result as any);
    verifiableSignature.systemID = CompactIAddressObject.fromAddress(SYSTEM_ID_TESTNET);
    verifiableSignature.setHasSystem();
    const signatureJson = verifiableSignature.toJson();

    res.json({
      signatureData: signatureJson,
      messageHex: messageHex
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) console.error("Attestation packet signing failed:", error);
    res.status(status).json({ error: message });
  }
}

// ── Generate QR for attestation tab ─────────────────────────────────

export async function generateAttestationQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateAttestationQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword, isTestnet } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");

    const flags = getAttestationFlags();
    const requestId = parseAddress(payload.requestId, "requestId");
    const recipientIdentity = parseAddress(payload.recipientIdentity, "recipientIdentity");

    if (!requestId) throw new ValidationError("Request ID is required.");
    if (!recipientIdentity) throw new ValidationError("Recipient Identity is required.");

    // Build a single URLRef DataDescriptor for the QR (lightweight)
    const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
    if (!downloadUrl) throw new ValidationError("Download URL is required.");
    const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
    const urlDescriptor = buildUrlDataDescriptor(downloadUrl, dataHash);

    // Build DataPacketRequestDetails with only the URL descriptor (no signature)
    const detailsParams: Record<string, unknown> = {
      version: new BN(1),
      flags: flags,
      signableObjects: [urlDescriptor],
      requestID: requestId
    };

    const details = new DataPacketRequestDetails(detailsParams as any);
    applyUserControlledFlags(details, flags);

    // Build details array: auth + data packet (only URLRef, no attestation data)
    const detailsArray: Array<DataPacketRequestOrdinalVDXFObject | AuthenticationRequestOrdinalVDXFObject> = [];
    detailsArray.push(buildRecipientAuthDetails(recipientIdentity));
    detailsArray.push(new DataPacketRequestOrdinalVDXFObject({ data: details }));

    let redirects: RedirectInput[] | undefined;
    if (payload.redirects != null && payload.redirects !== "" && payload.redirects !== "[]") {
      const parsed = parseJsonField<RedirectInput[]>(payload.redirects, "redirects", true);
      if (!Array.isArray(parsed)) throw new ValidationError("redirects must be a JSON array.");
      redirects = parsed.length > 0 ? parsed : undefined;
    }

    const reqToSign = buildGenericRequestFromDetails({
      details: detailsArray as any,
      signed: true,
      signingId: signingId,
      redirects: redirects
    }, isTestnet);

    await signRequest({
      request: reqToSign,
      rpcHost,
      rpcPort,
      rpcUser,
      rpcPassword,
      signingId
    });

    // Verify
    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      { auth: { username: rpcUser, password: rpcPassword } }
    );

    const deeplink = reqToSign.toWalletDeeplinkUri();
    const back = primitives.GenericRequest.fromWalletDeeplinkUri(deeplink);
    const resultok = await verusId.verifyGenericRequest(back);

    if (!resultok) {
      console.log("Attestation QR verification failed:", JSON.stringify(reqToSign.toJson(), null, 2), JSON.stringify(back.toJson(), null, 2));
      throw new Error("Failed to verify the generated GenericRequest.");
    }

    const qrDataUrl = await QRCode.toDataURL(deeplink, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    });

    const checkResult = primitives.GenericRequest.fromWalletDeeplinkUri(deeplink);
    const parsedRequest = checkResult.toJson() as Record<string, unknown>;

    // Patch flags in display
    if (Array.isArray(parsedRequest.details) && parsedRequest.details.length > 0) {
      const detail = parsedRequest.details[parsedRequest.details.length - 1] as Record<string, unknown>;
      if (detail && typeof detail.data === "object" && detail.data !== null) {
        (detail.data as Record<string, unknown>).flags = flags.toNumber();
      }
    }

    res.json({ deeplink, qrDataUrl, parsedRequest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) console.error("Attestation QR generation failed:", error);
    res.status(status).json({ error: message });
  }
}


