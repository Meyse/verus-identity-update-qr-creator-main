import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import * as crypto from "crypto";
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
  RecipientConstraint
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

type GenerateDataPacketQrPayload = {
  signingId?: string;
  flagHasRequestId?: boolean;
  flagHasStatements?: boolean;
  flagHasSignature?: boolean;
  flagForUsersSignature?: boolean;
  flagForTransmittalToUser?: boolean;
  flagHasUrlForDownload?: boolean;
  signableObjects?: unknown;
  statements?: unknown;
  requestId?: string;
  redirects?: unknown;
  downloadUrl?: string;
  dataHash?: string;
  signature?: unknown;
  recipientIdentity?: string;
};

function buildFlags(payload: GenerateDataPacketQrPayload): InstanceType<typeof BN> {
  let flags = new BN(0);
  
 
  if (payload.flagHasRequestId) {
    flags = flags.or(DataPacketRequestDetails.FLAG_HAS_REQUEST_ID);
  }
  if (payload.flagHasStatements) {
    flags = flags.or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS);
  }
  if (payload.flagHasSignature) {
    flags = flags.or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE);
  }
  if (payload.flagForUsersSignature) {
    flags = flags.or(DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE);
  }
  if (payload.flagForTransmittalToUser) {
    flags = flags.or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER);
  }
  if (payload.flagHasUrlForDownload) {
    flags = flags.or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
  }
  
  return flags;
}

// Workaround: DataPacketRequestDetails.calcFlags() only sets flags 1, 2, 4 based on data presence.
// It ignores user-controlled flags 8, 16, 32. We need to manually OR them in after construction.
function applyUserControlledFlags(details: DataPacketRequestDetails, originalFlags: InstanceType<typeof BN>): void {
  const userControlledFlags = originalFlags.and(
    DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE
      .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
      .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD)
  );
  details.flags = details.flags.or(userControlledFlags);
}

function parseSignableObjects(value: unknown): DataDescriptor[] {
  if (value == null || value === "" || value === "[]") {
    return [];
  }
  
  let parsed: unknown[];
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
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
      // Ensure version is BN and flags are set properly
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

function parseStatements(value: unknown): string[] | undefined {
  if (value == null || value === "" || value === "[]") {
    return undefined;
  }
  
  let parsed: unknown[];
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for statements: ${message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new ValidationError("statements must be a JSON array of strings.");
  }
  
  if (!Array.isArray(parsed)) {
    throw new ValidationError("statements must be a JSON array of strings.");
  }
  
  const statements = parsed.map((item, index) => {
    if (typeof item !== "string") {
      throw new ValidationError(`Statement at index ${index} must be a string.`);
    }
    return item;
  });
  
  return statements.length > 0 ? statements : undefined;
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

function parseSignature(value: unknown): VerifiableSignatureData | undefined {
  if (value == null || value === "" || value === "{}") {
    return undefined;
  }
  
  let parsed: Record<string, unknown>;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for signature: ${message}`);
    }
  } else if (typeof value === "object" && value !== null) {
    parsed = value as Record<string, unknown>;
  } else {
    throw new ValidationError("signature must be a JSON object.");
  }
  
  try {
    return VerifiableSignatureData.fromJson(parsed as any);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature object";
    throw new ValidationError(`Invalid VerifiableSignatureData: ${message}`);
  }
}

function buildUrlDataDescriptor(url: string, dataHash?: string): DataDescriptor {
  // Validate and convert dataHash to Buffer if provided
  const dataHashBuffer = validateDataHash(dataHash);
  // Create URLRef with version 1, URL, and optional datahash
  const urlRefParams: Record<string, unknown> = { version: URLRef.LAST_VERSION, url: url };
  if (dataHashBuffer) {
    urlRefParams.flags = URLRef.FLAG_HAS_HASH;
    urlRefParams.data_hash = dataHashBuffer;
  }
  const urlRef = new URLRef(urlRefParams as any);

  const ccdref = new CrossChainDataRef(urlRef)
  
  // Create a map with the CrossChainDataRefKey pointing to the URLRef
  const urlRefMap: Array<{[key: string]: any}> = [];
  urlRefMap.push({ [CrossChainDataRefKey.vdxfid]: ccdref });
  
  // Create VdxfUniValue from the map
  const urlRefUniValue = new VdxfUniValue({ values: urlRefMap });
  // Create DataDescriptor with the serialized VdxfUniValue
  const urlDescriptor = DataDescriptor.fromJson({
    version: 1,
    objectdata: urlRefUniValue.toBuffer().toString('hex')
  });
  
  return urlDescriptor;
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

function buildDataPacketRequest(params: {
  signingId: string;
  flags: InstanceType<typeof BN>;
  signableObjects: DataDescriptor[];
  statements?: string[];
  requestId?: CompactAddressObject;
  redirects?: RedirectInput[];
  signature?: VerifiableSignatureData;
  recipientIdentity?: CompactIAddressObject;
  isTestnet?: boolean;
}): primitives.GenericRequest {
  const detailsParams: Record<string, unknown> = {
    version: new BN(1),
    flags: params.flags,
    signableObjects: params.signableObjects
  };

  if (params.statements && params.statements.length > 0) {
    detailsParams.statements = params.statements;
  }
  if (params.requestId) {
    detailsParams.requestID = params.requestId;
  }
  if (params.signature) {
    detailsParams.signature = params.signature;
  }

  const details = new DataPacketRequestDetails(detailsParams as any);
  
  // Workaround: apply user-controlled flags that calcFlags() ignores
  applyUserControlledFlags(details, params.flags);

  // Build details array: optionally prepend auth entry with recipient constraint
  // IMPORTANT: the buildRecipientAuthDetails has to be before the DataPacketRequestDetails in the array, so the wallet processes the auth first and can enforce recipient constraints before showing the data packet details.
  const detailsArray: Array<DataPacketRequestOrdinalVDXFObject | AuthenticationRequestOrdinalVDXFObject> = [];
  if (params.recipientIdentity) {
    detailsArray.push(buildRecipientAuthDetails(params.recipientIdentity));
  }
  detailsArray.push(new DataPacketRequestOrdinalVDXFObject({ data: details }));

  return buildGenericRequestFromDetails({
    details: detailsArray as any,
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  }, params.isTestnet ?? false);
}

export async function generateDataPacketQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateDataPacketQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword, isTestnet } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    const flags = buildFlags(payload);
    let signableObjects: DataDescriptor[] = [];
    // Only parse statements/requestId if their respective flags are set
    const statements = payload.flagHasStatements ? parseStatements(payload.statements) : undefined;
    const requestId = payload.flagHasRequestId ? parseAddress(payload.requestId, "requestId") : undefined;

    // When flagHasUrlForDownload is set, signableObjects is ONLY the URL DataDescriptor
    if (payload.flagHasUrlForDownload) {
      const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
      if (!downloadUrl) {
        throw new ValidationError("Download URL is required when FLAG_HAS_URL_FOR_DOWNLOAD is set.");
      }
      const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
      const urlDescriptor = buildUrlDataDescriptor(downloadUrl, dataHash);
      signableObjects = [urlDescriptor];
    } else {
      signableObjects = parseSignableObjects(payload.signableObjects);
    }

    let redirects: RedirectInput[] | undefined;
    if (payload.redirects != null && payload.redirects !== "" && payload.redirects !== "[]") {
      const parsed = parseJsonField<RedirectInput[]>(
        payload.redirects,
        "redirects",
        true
      );
      if (!Array.isArray(parsed)) {
        throw new ValidationError("redirects must be a JSON array.");
      }
      redirects = parsed.length > 0 ? parsed : undefined;
    }

    // Parse signature only if the flag is set
    const signature = payload.flagHasSignature ? parseSignature(payload.signature) : undefined;

    // Parse optional recipient identity (only when FLAG_FOR_TRANSMITTAL_TO_USER)
    const recipientIdentity = payload.flagForTransmittalToUser
      ? parseAddress(payload.recipientIdentity, "recipientIdentity")
      : undefined;

    // Validate flag consistency
    if (payload.flagHasStatements && (!statements || statements.length === 0)) {
      throw new ValidationError("Statements are required when FLAG_HAS_STATEMENTS is set.");
    }
    if (payload.flagHasRequestId && !requestId) {
      throw new ValidationError("Request ID is required when FLAG_HAS_REQUEST_ID is set.");
    }
    if (payload.flagHasSignature && !signature) {
      throw new ValidationError("Signature is required when FLAG_HAS_SIGNATURE is set.");
    }

    const reqToSign = buildDataPacketRequest({
      signingId,
      flags,
      signableObjects,
      statements,
      requestId,
      redirects,
      signature,
      recipientIdentity,
      isTestnet
    });

    await signRequest({
      request: reqToSign,
      rpcHost,
      rpcPort,
      rpcUser,
      rpcPassword,
      signingId
    });

    // verifyGenericRequest
    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      {
        auth: {
          username: rpcUser,
          password: rpcPassword
        }
      }
    );

    const deeplink = reqToSign.toWalletDeeplinkUri();
    const back = primitives.GenericRequest.fromWalletDeeplinkUri(deeplink);

    const resultok = await verusId.verifyGenericRequest(back);

    if (!resultok) {
      console.log("jsons",JSON.stringify(reqToSign.toJson(), null, 2), JSON.stringify(back.toJson(), null, 2));
      throw new Error("Failed to verify the generated GenericRequest.");
    }

    const qrDataUrl = await QRCode.toDataURL(deeplink, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    });

    // Parse the deeplink back to get the GenericRequest JSON for display
    const checkResult = primitives.GenericRequest.fromWalletDeeplinkUri(deeplink);
    const parsedRequest = checkResult.toJson() as Record<string, unknown>;
    
    // Workaround: The library's toJson() uses calcFlags() which ignores user-controlled flags.
    // The actual deeplink is correct (toBuffer uses this.flags), but we need to fix the display.
    // Patch the details[0].data.flags with the correct value we computed.
    if (Array.isArray(parsedRequest.details) && parsedRequest.details.length > 0) {
      const detail = parsedRequest.details[0] as Record<string, unknown>;
      if (detail && typeof detail.data === "object" && detail.data !== null) {
        (detail.data as Record<string, unknown>).flags = flags.toNumber();
      }
    }

    res.json({ deeplink, qrDataUrl, parsedRequest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) {
      console.error("Data Packet QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}

type SignDataPacketPayload = {
  signingId?: string;
  flagHasRequestId?: boolean;
  flagHasStatements?: boolean;
  flagHasSignature?: boolean;
  flagForUsersSignature?: boolean;
  flagForTransmittalToUser?: boolean;
  flagHasUrlForDownload?: boolean;
  signableObjects?: unknown;
  statements?: unknown;
  requestId?: string;
  downloadUrl?: string;
  dataHash?: string;
  signature?: unknown;
  recipientIdentity?: string;
};

export async function signDataPacket(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as SignDataPacketPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    const flags = buildFlags(payload);
    let signableObjects: DataDescriptor[] = [];
    // Only parse statements if the flag is set
    const statements = payload.flagHasStatements ? parseStatements(payload.statements) : undefined;
    const requestId = payload.flagHasRequestId ? parseAddress(payload.requestId, "requestId") : undefined;

    // When flagHasUrlForDownload is set, signableObjects is ONLY the URL DataDescriptor
    if (payload.flagHasUrlForDownload) {
      const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
      if (!downloadUrl) {
        throw new ValidationError("Download URL is required when FLAG_HAS_URL_FOR_DOWNLOAD is set.");
      }
      const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
      const urlDescriptor = buildUrlDataDescriptor(downloadUrl, dataHash);
      signableObjects = [urlDescriptor];
    } else {
      signableObjects = parseSignableObjects(payload.signableObjects);
    }

    // Parse signature if provided (optional - this endpoint creates signatures)
    const signature = payload.flagHasSignature ? parseSignature(payload.signature) : undefined;

    // Build the DataPacketRequestDetails
    const detailsParams: Record<string, unknown> = {
      version: new BN(1),
      flags: flags,
      signableObjects: signableObjects
    };
    
    if (statements && statements.length > 0) {
      detailsParams.statements = statements;
    }
    if (requestId) {
      detailsParams.requestID = requestId;
    }
    if (signature) {
      detailsParams.signature = signature;
    }

    const details = new DataPacketRequestDetails(detailsParams as any);
    // Workaround: apply user-controlled flags that calcFlags() ignores
    applyUserControlledFlags(details, flags);
    console.log("Constructed DataPacketRequestDetails with flags:", details.toJson());
    
    // Get the hex of the DataPacketRequestDetails buffer
    const messageHex = details.toBuffer().toString("hex");

    // Call signdata RPC
    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      {
        auth: {
          username: rpcUser,
          password: rpcPassword
        }
      }
    );
    console.log("Requesting signature with messageHex:", messageHex, "and signingId:", signingId);
    const sigRes = await verusId.interface.request({
      cmd: "signdata",
      getParams: () => [{
        address: signingId,
        messagehex: messageHex
      }]
    } as any);

    if (sigRes.error) {
      throw new Error(sigRes.error.message || "RPC signdata failed.");
    }

    const result = sigRes.result as Record<string, unknown>;
    if (!result || typeof result.signature !== "string") {
      throw new Error("RPC signdata returned no valid signature.");
    }

    // Convert to VerifiableSignatureData using fromCLIJson
    const verifiableSignature = VerifiableSignatureData.fromCLIJson(result as any);
    // Force testnet systemID so the embedded signature validates on VRSCTEST
    // fromCLIJson never sets FLAG_HAS_SYSTEM, so the systemID wouldn't be serialized in the buffer.
    // We must both set the correct address AND enable the flag so it's included in toBuffer().
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
    if (status === 500) {
      console.error("Data Packet signing failed:", error);
    }
    res.status(status).json({ error: message });
  }
}

export async function fetchAndHashUrl(req: Request, res: Response): Promise<void> {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string" || !url.trim()) {
      throw new ValidationError("URL is required.");
    }

    const response = await fetch(url.trim());
    if (!response.ok) {
      throw new ValidationError(`Failed to fetch URL: HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const trimmed = text.trim();

    if (!trimmed) {
      throw new ValidationError("URL returned empty content.");
    }

    // Validate it's a hex string
    if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
      throw new ValidationError("URL content is not a valid hex string.");
    }

    // Convert hex to buffer and SHA256 hash it
    const dataBuffer = Buffer.from(trimmed, "hex");
    const hash = crypto.createHash("sha256").update(dataBuffer).digest("hex");
    console.log("Fetched data from URL and computed hash:", hash, dataBuffer.toString("hex"));

    res.json({ dataHash: hash });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) {
      console.error("Fetch and hash URL failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
