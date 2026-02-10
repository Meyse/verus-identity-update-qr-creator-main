// Updated: align CompactIAddressObject usage and signData with the raw
// request hash so wallet verification succeeds.
import * as path from "path";
import express = require("express");
import { BN } from "bn.js";
import * as QRCode from "qrcode";
import {
  AuthenticationRequestDetails,
  AuthenticationRequestOrdinalVDXFObject,
  IdentityUpdateRequestDetails,
  IdentityUpdateRequestOrdinalVDXFObject,
  VerusPayInvoiceDetails,
  VerusPayInvoiceDetailsOrdinalVDXFObject,
  VerifiableSignatureData,
  CompactIAddressObject,
  ResponseURI,
  TransferDestination,
  DEST_PKH,
  DEST_ID,
  fromBase58Check
} from "verus-typescript-primitives";
import { VerusIdInterface, primitives } from "verusid-ts-client";

const {
  RPC_HOST,
  RPC_PORT,
  RPC_USER,
  RPC_PASSWORD
} = require("../config.js");

const SYSTEM_ID_TESTNET = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq";

type RedirectInput = {
  type?: string | number;
  uri?: string;
};

type GenerateUpdateQrPayload = {
  signingId?: string;
  requestId?: string;
  identityChanges?: unknown;
  redirects?: unknown;
};

type GenerateAuthQrPayload = {
  signingId?: string;
  requestId?: string;
  expiryTime?: string | number;
  recipientConstraintType?: string | number;
  recipientConstraintIdentity?: string;
  redirects?: unknown;
};

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

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(__dirname, "..", "public")));

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required.`);
  }
  return value.trim();
}

function parseNumber(value: unknown, fieldName: string, fallback?: number): number {
  if (value == null || value === "") {
    if (fallback != null) return fallback;
    throw new ValidationError(`${fieldName} is required.`);
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number.`);
  }
  return num;
}

function parseOptionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number.`);
  }
  return Math.floor(num);
}

function parseJsonField<T>(value: unknown, fieldName: string, required: boolean): T | undefined {
  if (value == null || value === "") {
    if (required) throw new ValidationError(`${fieldName} is required.`);
    return undefined;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for ${fieldName}: ${message}`);
    }
  }
  return value as T;
}

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

function buildResponseUris(redirects?: RedirectInput[]): ResponseURI[] | undefined {
  if (!redirects || redirects.length === 0) return undefined;

  const responseUris = redirects
    .map((redirect) => {
      const uri = typeof redirect?.uri === "string" ? redirect.uri.trim() : "";
      if (!uri) return undefined;

      const type = String(redirect?.type ?? "");
      if (type === "1") return ResponseURI.fromUriString(uri, ResponseURI.TYPE_REDIRECT);
      if (type === "2") return ResponseURI.fromUriString(uri, ResponseURI.TYPE_POST);
      return undefined;
    })
    .filter((redirect): redirect is ResponseURI => redirect != null);

  return responseUris.length > 0 ? responseUris : undefined;
}

function buildGenericRequestFromDetails(params: {
  details: primitives.GenericRequest["details"];
  signed: boolean;
  signingId?: string;
  redirects?: RedirectInput[];
}): primitives.GenericRequest {
  const responseURIs = buildResponseUris(params.redirects);

  const req = new primitives.GenericRequest({
    details: params.details,
    createdAt: new BN((Date.now() / 1000).toFixed(0)),
    responseURIs
  });

  if (params.signed) {
    if (!params.signingId) {
      throw new ValidationError("signingId is required when signed is true.");
    }
    req.signature = new VerifiableSignatureData({
      systemID: CompactIAddressObject.fromAddress(SYSTEM_ID_TESTNET),
      identityID: CompactIAddressObject.fromAddress(params.signingId)
    });
    req.setSigned();
  }

  req.setIsTestnet();
  return req;
}

function buildUpdateRequest(params: {
  identityChanges: Record<string, unknown>;
  requestId?: string;
  signingId: string;
  redirects?: RedirectInput[];
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
  });
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

async function signRequest(params: {
  request: primitives.GenericRequest;
  rpcHost: string;
  rpcPort: number;
  rpcUser: string;
  rpcPassword: string;
  signingId: string;
}): Promise<void> {
  const verusId = new VerusIdInterface(
    SYSTEM_ID_TESTNET,
    `http://${params.rpcHost}:${params.rpcPort}`,
    {
      auth: {
        username: params.rpcUser,
        password: params.rpcPassword
      }
    }
  );

  const rawHash = params.request.getRawDataSha256(false);

  const sigRes = await verusId.interface.signData({
    address: params.signingId,
    datahash: rawHash.toString("hex")
  });

  const signature = sigRes?.result?.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("RPC signData returned no signature.");
  }

  if (!params.request.signature) {
    throw new Error("Request signature metadata is missing.");
  }
  params.request.signature.signatureAsVch = Buffer.from(signature, "base64");
}

app.get("/api/identities", async (_req, res) => {
  try {
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");

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

    const rpcResult = await verusId.interface.request({
      getParams: () => [],
      cmd: "listidentities"
    } as any);

    if (rpcResult.error || !Array.isArray(rpcResult.result)) {
      res.json({ identities: [] });
      return;
    }

    const identities = rpcResult.result
      .filter((entry: any) => entry?.identity?.name && entry?.identity?.identityaddress)
      .map((entry: any) => ({
        name: entry.identity.name,
        iAddress: entry.identity.identityaddress
      }));

    res.json({ identities });
  } catch (error) {
    console.error("Failed to list identities:", error);
    res.json({ identities: [] });
  }
});

app.get("/api/currencies", async (_req, res) => {
  try {
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");

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

    const queries: Array<{
      launchstate: "complete" | "launched" | "prelaunch";
      systemtype?: "local" | "pbaas" | "imported" | "gateway";
    }> = [
      { launchstate: "complete" },
      { launchstate: "launched" },
      { launchstate: "prelaunch" },
      { launchstate: "complete", systemtype: "local" },
      { launchstate: "complete", systemtype: "pbaas" },
      { launchstate: "complete", systemtype: "imported" },
      { launchstate: "complete", systemtype: "gateway" },
      { launchstate: "launched", systemtype: "local" },
      { launchstate: "launched", systemtype: "pbaas" },
      { launchstate: "launched", systemtype: "imported" },
      { launchstate: "launched", systemtype: "gateway" },
      { launchstate: "prelaunch", systemtype: "local" },
      { launchstate: "prelaunch", systemtype: "pbaas" },
      { launchstate: "prelaunch", systemtype: "imported" },
      { launchstate: "prelaunch", systemtype: "gateway" }
    ] as const;

    const results = await Promise.all(
      queries.map((query) => verusId.interface.listCurrencies(query))
    );

    const combined = results.flatMap((result, index) => {
      const list = Array.isArray(result.result) ? result.result : [];
      const meta = queries[index];
      return list.map((entry: any) => ({
        entry,
        launchstate: meta.launchstate,
        systemtype: meta.systemtype
      }));
    });

    const seen = new Set<string>();
    const chainCurrencies = combined
      .filter(({ entry }) => entry?.currencydefinition?.currencyid)
      .filter(({ entry }) => {
        const id = entry.currencydefinition.currencyid;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(({ entry, launchstate, systemtype }) => ({
        currencyId: entry.currencydefinition.currencyid,
        name: entry.currencydefinition.name,
        fullyQualifiedName: entry.currencydefinition.fullyqualifiedname,
        launchstate,
        systemtype,
        hasBalance: false
      }));

    // Pull wallet-held currencies to ensure balances appear in the list.
    const walletAddressGroups = await verusId.interface.request({
      cmd: "listaddressgroupings",
      getParams: () => []
    } as any);
    const addressGroups = Array.isArray(walletAddressGroups.result)
      ? walletAddressGroups.result
      : [];
    const walletAddresses = new Set<string>();
    addressGroups.forEach((group: any[]) => {
      if (!Array.isArray(group)) return;
      group.forEach((entry: any[]) => {
        if (Array.isArray(entry) && typeof entry[0] === "string") {
          walletAddresses.add(entry[0]);
        }
      });
    });

    let walletCurrencies: Array<{
      currencyId: string;
      name: string;
      hasBalance: boolean;
    }> = [];
    if (walletAddresses.size > 0) {
      const walletBalances = await verusId.interface.getAddressBalance({
        addresses: Array.from(walletAddresses),
        friendlynames: true
      });
      const currencyBalance = walletBalances.result?.currencybalance ?? {};
      const currencyNames = walletBalances.result?.currencynames ?? {};

      walletCurrencies = Object.keys(currencyBalance).map((currencyId) => ({
        currencyId,
        name: currencyNames[currencyId] || currencyId,
        hasBalance: true
      }));
    }

    const byId = new Map<string, any>();
    chainCurrencies.forEach((currency) => {
      byId.set(currency.currencyId, currency);
    });
    walletCurrencies.forEach((currency) => {
      const existing = byId.get(currency.currencyId);
      if (existing) {
        existing.hasBalance = true;
        if (!existing.name && currency.name) {
          existing.name = currency.name;
        }
      } else {
        byId.set(currency.currencyId, {
          currencyId: currency.currencyId,
          name: currency.name,
          fullyQualifiedName: undefined,
          launchstate: undefined,
          systemtype: undefined,
          hasBalance: true
        });
      }
    });

    const currencies = Array.from(byId.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ currencies });
  } catch (error) {
    console.error("Failed to list currencies:", error);
    res.json({ currencies: [] });
  }
});

app.post("/api/generate-qr", async (req, res) => {
  try {
    const payload = req.body as GenerateUpdateQrPayload;
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");
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
      // Keep details in server logs for debugging local setup issues.
      console.error("QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/generate-auth-qr", async (req, res) => {
  try {
    const payload = req.body as GenerateAuthQrPayload;
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");
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
      // Keep details in server logs for debugging local setup issues.
      console.error("Auth QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/generate-invoice-qr", async (req, res) => {
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
      const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
        ? RPC_HOST.trim()
        : "localhost";
      const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
      const rpcUser = requireString(RPC_USER, "RPC_USER");
      const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");

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
});

const portEnv = process.env.UI_PORT ?? process.env.PORT;
const port = portEnv ? parseNumber(portEnv, "UI_PORT") : 3000;

app.listen(port, () => {
  console.log(`Local UI server running at http://localhost:${port}`);
});
