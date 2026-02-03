// Updated: use remote API + env WIF for offline signing (no local node).
import { BN } from 'bn.js';
import { IdentityUpdateRequestDetails, GenericRequest, IdentityUpdateRequestOrdinalVDXFObject, VerifiableSignatureData, CompactAddressObject, ResponseURI } from 'verus-typescript-primitives';
import { VerusIdInterface } from 'verusid-ts-client'
import { ECPair, networks } from '@bitgo/utxo-lib';

const { 
  API_BASE_URL,
  SYSTEM_I_ADDRESS,
  JSON_IDENTITY_CHANGES,
  REQUEST_ID,
  REDIRECTS,
  SIGNING_ID
} = require("../config.js");
const qrcode = require('qrcode-terminal');

function requireEnvVar(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

const SIGNING_WIF = requireEnvVar("VERUS_SIGNING_WIF");

if (!API_BASE_URL) {
  throw new Error("Missing API_BASE_URL in config.js.");
}

if (!SYSTEM_I_ADDRESS) {
  throw new Error("Missing SYSTEM_I_ADDRESS in config.js.");
}

if (!SIGNING_ID) {
  throw new Error("Missing SIGNING_ID in config.js.");
}

const VerusId = new VerusIdInterface(SYSTEM_I_ADDRESS, API_BASE_URL);

function getSigningAddressFromWif(wif: string) {
  return ECPair.fromWIF(wif, networks.verustest).getAddress();
}

function assertSingleSigIdentity(identityResult: any, signingAddress: string) {
  if (identityResult.status !== "active") {
    throw new Error("Signing identity is not active.");
  }

  const minSigs = identityResult.identity?.minimumsignatures;

  if (minSigs !== 1) {
    throw new Error("Signing identity must be single-sig (minimumsignatures = 1).");
  }

  const primaryAddresses = identityResult.identity?.primaryaddresses;

  if (!Array.isArray(primaryAddresses) || primaryAddresses.length === 0) {
    throw new Error("Signing identity has no primary addresses.");
  }

  if (!primaryAddresses.includes(signingAddress)) {
    throw new Error("VERUS_SIGNING_WIF does not match any primary address for SIGNING_ID.");
  }
}

async function fetchSigningContext(signingId: string, signingAddress: string) {
  const [infoRes, identityRes] = await Promise.all([
    VerusId.interface.getInfo(),
    VerusId.interface.getIdentity(signingId)
  ]);

  if (infoRes.error) throw new Error(infoRes.error.message);
  if (identityRes.error) throw new Error(identityRes.error.message);

  const identityResult = identityRes.result!;
  const currentHeight = infoRes.result!.longestchain;

  assertSingleSigIdentity(identityResult, signingAddress);

  return { identityResult, currentHeight };
}

async function main() {
  const dets = IdentityUpdateRequestDetails.fromCLIJson(
    JSON_IDENTITY_CHANGES,
    {
      requestid: REQUEST_ID
    }
  )

  const responseUris = Array.isArray(REDIRECTS)
    ? REDIRECTS.filter((redirect) => typeof redirect?.uri === "string" && redirect.uri.length > 0)
      .map((redirect) => {
        const type = String(redirect?.type);
        if (type === "1") return ResponseURI.fromUriString(redirect.uri, ResponseURI.TYPE_REDIRECT);
        if (type === "2") return ResponseURI.fromUriString(redirect.uri, ResponseURI.TYPE_POST);
        return undefined;
      })
      .filter((redirect): redirect is ResponseURI => redirect != null)
    : undefined;

  const req = new GenericRequest({
    details: [new IdentityUpdateRequestOrdinalVDXFObject({
      data: dets
    })],
    createdAt: new BN((Date.now() / 1000).toFixed(0)),
    responseURIs: responseUris && responseUris.length > 0 ? responseUris : undefined
  });

  req.signature = new VerifiableSignatureData({
    systemID: CompactAddressObject.fromIAddress(SYSTEM_I_ADDRESS),
    identityID: CompactAddressObject.fromIAddress(SIGNING_ID)
  })

  req.setIsTestnet()

  const signingAddress = getSigningAddressFromWif(SIGNING_WIF);
  const { identityResult, currentHeight } = await fetchSigningContext(SIGNING_ID, signingAddress);
  const signedReq = await VerusId.signGenericRequest(req, SIGNING_WIF, identityResult, currentHeight);

  const dl = signedReq.toWalletDeeplinkUri();
  
  qrcode.generate(dl);
  console.log(dl)
}

main();