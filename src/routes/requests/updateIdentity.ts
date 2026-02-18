import { Request, Response } from "express";
import * as QRCode from "qrcode";
import {
  IdentityUpdateRequestDetails,
  IdentityUpdateRequestOrdinalVDXFObject,
  CompactIAddressObject
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

type GenerateUpdateQrPayload = {
  signingId?: string;
  requestId?: string;
  identityChanges?: unknown;
  redirects?: unknown;
};

function buildUpdateRequest(params: {
  identityChanges: Record<string, unknown>;
  requestId?: string;
  signingId: string;
  redirects?: RedirectInput[];
  isTestnet?: boolean;
}): primitives.GenericRequest {
  const detailsOverrides = params.requestId
    ? { requestid: CompactIAddressObject.fromAddress(params.requestId).toJson() }
    : undefined;
  const details = IdentityUpdateRequestDetails.fromCLIJson(
    params.identityChanges,
    detailsOverrides
  );

  return buildGenericRequestFromDetails({
    details: [new IdentityUpdateRequestOrdinalVDXFObject({ data: details })],
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  }, params.isTestnet ?? false);
}

export async function generateQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateUpdateQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword, isTestnet } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    const requestId = typeof payload.requestId === "string" && payload.requestId.trim().length > 0
      ? payload.requestId.trim()
      : undefined;

    const identityChanges = parseJsonField<Record<string, unknown>>(
      payload.identityChanges,
      "identityChanges",
      true
    );

    if (typeof identityChanges !== "object" || identityChanges == null || Array.isArray(identityChanges)) {
      throw new ValidationError("identityChanges must be a JSON object.");
    }

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      false
    );

    if (redirects !== undefined && !Array.isArray(redirects)) {
      throw new ValidationError("redirects must be a JSON array.");
    }

    const reqToSign = buildUpdateRequest({
      identityChanges,
      requestId,
      signingId,
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
      console.error("QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
