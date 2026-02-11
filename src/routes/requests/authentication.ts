import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import {
  AuthenticationRequestDetails,
  AuthenticationRequestOrdinalVDXFObject,
  CompactIAddressObject
} from "verus-typescript-primitives";
import { primitives } from "verusid-ts-client";
import {
  ValidationError,
  RedirectInput,
  requireString,
  parseOptionalPositiveNumber,
  parseJsonField,
  buildGenericRequestFromDetails,
  signRequest,
  getRpcConfig
} from "../utils";

type GenerateAuthQrPayload = {
  signingId?: string;
  requestId?: string;
  expiryTime?: string | number;
  recipientConstraintType?: string | number;
  recipientConstraintIdentity?: string;
  redirects?: unknown;
};

function parseRecipientConstraints(
  typeValue: unknown,
  identityValue: unknown
): Array<{ type: number; identity: CompactIAddressObject }> | undefined {
  if (typeValue == null || typeValue === "") return undefined;

  const typeNum = typeof typeValue === "number" ? typeValue : Number(typeValue);
  const allowed = new Set([
    AuthenticationRequestDetails.REQUIRED_ID,
    AuthenticationRequestDetails.REQUIRED_SYSTEM,
    AuthenticationRequestDetails.REQUIRED_PARENT
  ]);

  if (!Number.isFinite(typeNum) || !allowed.has(typeNum)) {
    throw new ValidationError("recipientConstraintType must be 1 (ID), 2 (System), or 3 (Parent).");
  }

  const identity = requireString(identityValue, "recipientConstraintIdentity");
  return [
    {
      type: typeNum,
      identity: CompactIAddressObject.fromAddress(identity)
    }
  ];
}

function buildAuthRequest(params: {
  signingId: string;
  requestId: string;
  expiryTime?: number;
  recipientConstraints?: Array<{ type: number; identity: CompactIAddressObject }>;
  redirects?: RedirectInput[];
}): primitives.GenericRequest {
  const details = new AuthenticationRequestDetails({
    requestID: CompactIAddressObject.fromAddress(params.requestId),
    recipientConstraints: params.recipientConstraints,
    expiryTime: params.expiryTime != null ? new BN(params.expiryTime) : undefined
  });

  return buildGenericRequestFromDetails({
    details: [new AuthenticationRequestOrdinalVDXFObject({ data: details })],
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  });
}

export async function generateAuthQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateAuthQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    const requestId = requireString(payload.requestId, "requestId");
    const expiryTime = parseOptionalPositiveNumber(payload.expiryTime, "expiryTime");

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      false
    );

    if (redirects !== undefined && !Array.isArray(redirects)) {
      throw new ValidationError("redirects must be a JSON array.");
    }

    const recipientConstraints = parseRecipientConstraints(
      payload.recipientConstraintType,
      payload.recipientConstraintIdentity
    );

    const reqToSign = buildAuthRequest({
      signingId,
      requestId,
      expiryTime,
      recipientConstraints,
      redirects
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
      console.error("Auth QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
