import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import {
  VerusPayInvoiceDetails,
  VerusPayInvoiceDetailsOrdinalVDXFObject,
  TransferDestination,
  DEST_PKH,
  DEST_ID,
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

type GenerateInvoiceQrPayload = {
  signed?: boolean;
  signingId?: string;
  requestedCurrencyId?: string;
  amount?: string;
  destinationType?: string;
  destinationAddress?: string;
  acceptsAnyAmount?: boolean;
  acceptsAnyDestination?: boolean;
  acceptsConversion?: boolean;
  maxEstimatedSlippage?: string;
  expires?: boolean;
  expiryHeight?: string;
  acceptsNonVerusSystems?: boolean;
  acceptedSystems?: string;
  isTestnet?: boolean;
  isPreconvert?: boolean;
  isTagged?: boolean;
  tagAddress?: string;
  redirects?: unknown;
};

function buildInvoiceRequest(params: {
  signed: boolean;
  signingId?: string;
  requestedCurrencyId: string;
  amount?: string;
  destinationType?: string;
  destinationAddress?: string;
  acceptsAnyAmount: boolean;
  acceptsAnyDestination: boolean;
  acceptsConversion: boolean;
  maxEstimatedSlippage?: string;
  expires: boolean;
  expiryHeight?: string;
  acceptsNonVerusSystems: boolean;
  acceptedSystems?: string[];
  isTestnet: boolean;
  isPreconvert: boolean;
  isTagged: boolean;
  tagAddress?: string;
  redirects?: RedirectInput[];
}): primitives.GenericRequest {
  // Build destination if not accepting any destination
  let destination: TransferDestination | undefined;
  if (!params.acceptsAnyDestination) {
    if (!params.destinationAddress) {
      throw new ValidationError("Destination address is required when acceptsAnyDestination is off.");
    }
    const destType = params.destinationType === "id" ? DEST_ID : DEST_PKH;
    destination = new TransferDestination({
      type: destType,
      destination_bytes: fromBase58Check(params.destinationAddress).hash
    });
  }

  // Build amount if not accepting any amount
  let amount: InstanceType<typeof BN> | undefined;
  if (!params.acceptsAnyAmount) {
    if (!params.amount) {
      throw new ValidationError("Amount is required when acceptsAnyAmount is off.");
    }
    amount = new BN(params.amount, 10);
    if (amount.lten(0)) {
      throw new ValidationError("Amount must be a positive number.");
    }
  }

  // Parse accepted systems
  let acceptedSystems: string[] | undefined;
  if (params.acceptsNonVerusSystems && params.acceptedSystems && params.acceptedSystems.length > 0) {
    acceptedSystems = params.acceptedSystems;
  }

  const invoiceDetails = new VerusPayInvoiceDetails({
    amount,
    destination,
    requestedcurrencyid: params.requestedCurrencyId,
    expiryheight: params.expires && params.expiryHeight ? new BN(params.expiryHeight, 10) : undefined,
    maxestimatedslippage: params.acceptsConversion && params.maxEstimatedSlippage
      ? new BN(params.maxEstimatedSlippage, 10)
      : undefined,
    acceptedsystems: acceptedSystems
  });

  invoiceDetails.setFlags({
    acceptsAnyAmount: params.acceptsAnyAmount,
    acceptsAnyDestination: params.acceptsAnyDestination,
    acceptsConversion: params.acceptsConversion,
    expires: params.expires,
    acceptsNonVerusSystems: params.acceptsNonVerusSystems,
    isTestnet: params.isTestnet,
    isPreconvert: params.isPreconvert,
    isTagged: params.isTagged
  });

  return buildGenericRequestFromDetails({
    details: [new VerusPayInvoiceDetailsOrdinalVDXFObject({ data: invoiceDetails })],
    signed: params.signed,
    signingId: params.signingId,
    redirects: params.redirects
  });
}

export async function generateInvoiceQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateInvoiceQrPayload;
    const signed = payload.signed === true;

    let signingId: string | undefined;
    if (signed) {
      signingId = requireString(payload.signingId, "signingId");
    }

    const requestedCurrencyId = requireString(payload.requestedCurrencyId, "requestedCurrencyId");

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      false
    );
    if (redirects !== undefined && !Array.isArray(redirects)) {
      throw new ValidationError("redirects must be a JSON array.");
    }

    // Parse accepted systems from comma-separated string
    let acceptedSystems: string[] | undefined;
    if (payload.acceptsNonVerusSystems && typeof payload.acceptedSystems === "string" && payload.acceptedSystems.trim().length > 0) {
      acceptedSystems = payload.acceptedSystems.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (acceptedSystems.length === 0) {
        throw new ValidationError("At least one accepted system i-address is required.");
      }
    }

    const invoiceRequest = buildInvoiceRequest({
      signed,
      signingId,
      requestedCurrencyId,
      amount: typeof payload.amount === "string" && payload.amount.trim().length > 0
        ? payload.amount.trim()
        : undefined,
      destinationType: typeof payload.destinationType === "string" ? payload.destinationType : undefined,
      destinationAddress: typeof payload.destinationAddress === "string" && payload.destinationAddress.trim().length > 0
        ? payload.destinationAddress.trim()
        : undefined,
      acceptsAnyAmount: payload.acceptsAnyAmount === true,
      acceptsAnyDestination: payload.acceptsAnyDestination === true,
      acceptsConversion: payload.acceptsConversion === true,
      maxEstimatedSlippage: typeof payload.maxEstimatedSlippage === "string" && payload.maxEstimatedSlippage.trim().length > 0
        ? payload.maxEstimatedSlippage.trim()
        : undefined,
      expires: payload.expires === true,
      expiryHeight: typeof payload.expiryHeight === "string" && payload.expiryHeight.trim().length > 0
        ? payload.expiryHeight.trim()
        : undefined,
      acceptsNonVerusSystems: payload.acceptsNonVerusSystems === true,
      acceptedSystems,
      isTestnet: payload.isTestnet !== false,
      isPreconvert: payload.isPreconvert === true,
      isTagged: payload.isTagged === true,
      tagAddress: typeof payload.tagAddress === "string" && payload.tagAddress.trim().length > 0
        ? payload.tagAddress.trim()
        : undefined,
      redirects
    });

    if (signed) {
      const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();

      await signRequest({
        request: invoiceRequest,
        rpcHost,
        rpcPort,
        rpcUser,
        rpcPassword,
        signingId: signingId!
      });
    }

    const deeplink = invoiceRequest.toWalletDeeplinkUri();
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
      console.error("Invoice QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
