// Updated: add type 1 (redirect) and type 2 (POST) responseURIs from config REDIRECTS.
import { BN } from 'bn.js';
import { IdentityUpdateRequestDetails, LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY, VerusIDSignature, GenericRequest, IdentityUpdateRequestOrdinalVDXFObject, VerifiableSignatureData, CompactAddressObject, ResponseURI } from 'verus-typescript-primitives';
import { VerusIdInterface, primitives } from 'verusid-ts-client'

const { 
  RPC_USER, 
  RPC_PORT, 
  RPC_PASSWORD,
  JSON_IDENTITY_CHANGES,
  REQUEST_ID,
  REDIRECTS,
  SIGNING_ID
} = require("../config.js");
const qrcode = require('qrcode-terminal');

const VerusId = new VerusIdInterface("iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq", `http://localhost:${RPC_PORT}`, {
  auth: {
    username: RPC_USER,
    password: RPC_PASSWORD
  },
});

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

  const req = new primitives.GenericRequest({
    details: [new IdentityUpdateRequestOrdinalVDXFObject({
      data: dets
    })],
    createdAt: new BN((Date.now() / 1000).toFixed(0)),
    responseURIs: responseUris && responseUris.length > 0 ? responseUris : undefined
  });

  req.signature = new VerifiableSignatureData({
    systemID: CompactAddressObject.fromIAddress("iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"),
    identityID: CompactAddressObject.fromIAddress(SIGNING_ID)
  })

  req.setSigned()
  req.setIsTestnet()

  const sigRes = await VerusId.interface.signData({
    address: SIGNING_ID,
    datahash: req.getRawDataSha256().toString('hex')
  })

  req.signature.signatureAsVch = Buffer.from(sigRes.result!.signature!, 'base64')

  const dl = req.toWalletDeeplinkUri();
  
  qrcode.generate(dl);
  console.log(dl)
}

main();