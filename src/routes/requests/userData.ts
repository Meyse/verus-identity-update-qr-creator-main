import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import {
  UserDataRequestDetails,
  UserDataRequestOrdinalVDXFObject,
  CompactIAddressObject
} from "verus-typescript-primitives";
import { primitives } from "verusid-ts-client";
import {
  ValidationError,
  RedirectInput,
  requireString,
  parseJsonField,
  parseAddress,
  buildGenericRequestFromDetails,
  signRequest,
  getRpcConfig
} from "../utils";

// Use constants from UserDataRequestDetails
// Flags: FLAG_HAS_REQUEST_ID = 1, FLAG_HAS_SIGNER = 2, FLAG_HAS_REQUESTED_KEYS = 4
// Data type values (varuints): FULL_DATA = 1, PARTIAL_DATA = 2, COLLECTION = 3
// Request type values (varuints): ATTESTATION = 1, CLAIM = 2, CREDENTIAL = 3

type GenerateUserDataQrPayload = {
  signingId?: string;
  dataType?: number;
  requestType?: number;
  searchDataKey?: string;
  searchDataValue?: string;
  signer?: string;
  requestedKeys?: unknown;
  requestId?: string;
  redirects?: unknown;
};

function parseRequestedKeys(value: unknown): string[] | undefined {
  if (value == null || value === "" || value === "[]") {
    return undefined;
  }
  
  let parsed: unknown[];
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for requestedKeys: ${message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new ValidationError("requestedKeys must be a JSON array of i-addresses.");
  }
  
  if (!Array.isArray(parsed)) {
    throw new ValidationError("requestedKeys must be a JSON array of i-addresses.");
  }
  
  const keys = parsed.map((item, index) => {
    if (typeof item !== "string") {
      throw new ValidationError(`requestedKeys item at index ${index} must be a string.`);
    }
    return item.trim();
  });
  
  return keys.length > 0 ? keys : undefined;
}

function buildSearchDataKey(keyAddress: string | undefined, keyValue: string | undefined): Array<{[key: string]: string}> | undefined {
  if (!keyAddress || keyAddress.trim() === "") {
    return undefined;
  }
  
  const key = keyAddress.trim();
  const value = keyValue?.trim() ?? "";
  
  return [{ [key]: value }];
}

function buildUserDataRequest(params: {
  signingId: string;
  dataType: InstanceType<typeof BN>;
  requestType: InstanceType<typeof BN>;
  searchDataKey?: Array<{[key: string]: string}>;
  signer?: CompactIAddressObject;
  requestedKeys?: string[];
  requestId?: CompactIAddressObject;
  redirects?: RedirectInput[];
}): primitives.GenericRequest {
  const detailsParams: Record<string, unknown> = {
    version: new BN(1),
    dataType: params.dataType,
    requestType: params.requestType,
    searchDataKey: params.searchDataKey || []
  };
  
  if (params.signer) {
    detailsParams.signer = params.signer;
  }
  if (params.requestedKeys && params.requestedKeys.length > 0) {
    detailsParams.requestedKeys = params.requestedKeys;
  }
  if (params.requestId) {
    detailsParams.requestID = params.requestId;
  }

  // Constructor's setFlags() will set FLAG_HAS_SIGNER, FLAG_HAS_REQUEST_ID, FLAG_HAS_REQUESTED_KEYS
  const details = new UserDataRequestDetails(detailsParams as any);

  return buildGenericRequestFromDetails({
    details: [new UserDataRequestOrdinalVDXFObject({ data: details })],
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  });
}

export async function generateUserDataQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateUserDataQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    // Parse data type (default to FULL_DATA)
    // UI sends: 1 = Full Data, 2 = Partial Data, 3 = Collection
    // These are varuint values, not flags
    let dataType = UserDataRequestDetails.FULL_DATA;
    if (payload.dataType != null) {
      const dt = Number(payload.dataType);
      if (dt === 1) dataType = UserDataRequestDetails.FULL_DATA;
      else if (dt === 2) dataType = UserDataRequestDetails.PARTIAL_DATA;
      else if (dt === 3) dataType = UserDataRequestDetails.COLLECTION;
      else throw new ValidationError("dataType must be 1 (Full Data), 2 (Partial Data), or 3 (Collection).");
    }
    
    // Parse request type (default to ATTESTATION)
    // UI sends: 1 = Attestation, 2 = Claim, 3 = Credential
    // These are varuint values, not flags
    let requestType = UserDataRequestDetails.ATTESTATION;
    if (payload.requestType != null) {
      const rt = Number(payload.requestType);
      if (rt === 1) requestType = UserDataRequestDetails.ATTESTATION;
      else if (rt === 2) requestType = UserDataRequestDetails.CLAIM;
      else if (rt === 3) requestType = UserDataRequestDetails.CREDENTIAL;
      else throw new ValidationError("requestType must be 1 (Attestation), 2 (Claim), or 3 (Credential).");
    }
    
    const searchDataKey = buildSearchDataKey(payload.searchDataKey, payload.searchDataValue);
    const signer = parseAddress(payload.signer, "signer");
    const requestedKeys = parseRequestedKeys(payload.requestedKeys);
    const requestId = parseAddress(payload.requestId, "requestId");
    
    // Validate: requestedKeys only makes sense with PARTIAL_DATA
    if (requestedKeys && requestedKeys.length > 0 && !dataType.eq(UserDataRequestDetails.PARTIAL_DATA)) {
      throw new ValidationError("Requested Keys can only be used with Partial Data type.");
    }

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      false
    );

    const reqToSign = buildUserDataRequest({
      signingId,
      dataType,
      requestType,
      searchDataKey,
      signer,
      requestedKeys,
      requestId,
      redirects: redirects || undefined
    });

    await signRequest({
      request: reqToSign,
      rpcHost,
      rpcPort,
      rpcUser,
      rpcPassword,
      signingId
    });

    const deeplink = reqToSign.toWalletDeeplinkUri();
    const qrDataUrl = await QRCode.toDataURL(deeplink, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    });

    res.json({ deeplink, qrDataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) {
      console.error("User Data QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
