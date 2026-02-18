import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import {
  AppEncryptionRequestDetails,
  AppEncryptionRequestOrdinalVDXFObject,
  CompactAddressObject,
  CompactIAddressObject,
  fromBase58Check
} from "verus-typescript-primitives";
import { primitives } from "verusid-ts-client";
import {
  ValidationError,
  RedirectInput,
  requireString,
  parseJsonField,
  buildGenericRequestFromDetails,
  signRequest,
  getRpcConfig
} from "../utils";

type GenerateAppEncryptionQrPayload = {
  signingId?: string;
  encryptToZAddress?: string;
  derivationNumber?: string | number;
  derivationID?: string;
  requestId?: string;
  returnEsk?: boolean;
  redirects?: unknown;
};

function parseOptionalZAddress(value: unknown, fieldName: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("zs1")) {
    throw new ValidationError(`${fieldName} must be a valid z-address (starts with zs1).`);
  }
  return trimmed;
}

function parseDerivationNumber(value: unknown) {
  if (value == null || value === "") {
    return new BN(0);
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    throw new ValidationError("derivationNumber must be a non-negative integer.");
  }
  return new BN(num);
}

function parseOptionalIAddress(value: unknown, fieldName: string): CompactIAddressObject | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();

  if (!trimmed.endsWith("@"))  {
    try {
      // Try parsing as i-address to validate format
      fromBase58Check(trimmed);
    } catch (error) {
      throw new ValidationError(`${fieldName} must be a valid i-address or fully qualified name.`);
    }
  }

  const compactAddressObjectTemp = new CompactIAddressObject({
    version: CompactAddressObject.DEFAULT_VERSION,
    type: CompactAddressObject.TYPE_FQN,
    address: trimmed,
    rootSystemName: "VRSC"
  });

  return compactAddressObjectTemp;
}

function buildAppEncryptionRequest(params: {
  signingId: string;
  encryptToZAddress?: string;
  derivationNumber: InstanceType<typeof BN>;
  derivationID?: CompactIAddressObject;
  requestId?: CompactIAddressObject;
  returnEsk?: boolean;
  redirects?: RedirectInput[];
  isTestnet?: boolean;
}): primitives.GenericRequest {
  // Build flags if returnEsk is requested
  let flags: InstanceType<typeof BN> | undefined;
  if (params.returnEsk) {
    flags = AppEncryptionRequestDetails.FLAG_RETURN_ESK;
  }

  const detailsParams: Record<string, unknown> = {
    derivationNumber: params.derivationNumber
  };
  if (params.encryptToZAddress) {
    detailsParams.encryptToZAddress = params.encryptToZAddress;
  }
  if (params.derivationID) {
    detailsParams.derivationID = params.derivationID;
  }
  if (params.requestId) {
    detailsParams.requestID = params.requestId;
  }
  if (flags) {
    detailsParams.flags = flags;
  }

  const details = new AppEncryptionRequestDetails(detailsParams as any);

  return buildGenericRequestFromDetails({
    details: [new AppEncryptionRequestOrdinalVDXFObject({ data: details })],
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  }, params.isTestnet ?? false);
}

export async function generateAppEncryptionQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateAppEncryptionQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword, isTestnet } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    const encryptToZAddress = parseOptionalZAddress(payload.encryptToZAddress, "encryptToZAddress");
    const derivationNumber = parseDerivationNumber(payload.derivationNumber);
    const derivationID = parseOptionalIAddress(payload.derivationID, "derivationID");
    const requestId = parseOptionalIAddress(payload.requestId, "requestId");
    const returnEsk = Boolean(payload.returnEsk);

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      true
    );

    if (!Array.isArray(redirects) || redirects.length === 0) {
      throw new ValidationError("redirects must be a non-empty JSON array.");
    }

    const reqToSign = buildAppEncryptionRequest({
      signingId,
      encryptToZAddress,
      derivationNumber,
      derivationID,
      requestId,
      returnEsk,
      redirects,
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
      console.error("App Encryption QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
