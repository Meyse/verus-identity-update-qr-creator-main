# DataPacketRequestDetails — Developer Guide

This guide shows how to create `DataPacketRequestDetails` objects for sending data to users via `GenericRequest`.

---

## Overview

`DataPacketRequestDetails` replaces the older `LoginConsentRequest` approach that used `ATTESTATION_PROVISION_TYPE.vdxfid` in `provisioning_info` and `ATTESTATION_PROVISION_URL.vdxfid` in `redirect_uris`.

---

## Old Approach (Deprecated)

Previously, data was sent using `LoginConsentRequest`:

```javascript
{
  vdxfkey: 'i5maLnB62WmKKXFZniqDRU1JiC2Hd1xpVb',
  challenge_id: 'i7pZ1YqF1ADaNnC7ow6ndSBAEmYDq5wH7L',
  requested_access: [
    RequestedPermission {
      vdxfkey: 'iLUrA89mDKnwxZcMiPadfNB9TLp58A2TKU',
      data: ''
    }
  ],
  provisioning_info: [
    ProvisioningInfo {
      vdxfkey: 'i7VGPAp3q2h4U4njZ556b9eG3Jts2gmzHn',  // ATTESTATION_PROVISION_TYPE
      data: 'Valu Claims'
    }
  ],
  redirect_uris: [
    {
      uri: 'https://api.roomful.net/verus/getClaimsData/i7pZ1YqF1ADaNnC7ow6ndSBAEmYDq5wH7L',
      vdxfkey: 'iD9J9aQ6vsRYvqZbBs9QpKmCcgUynee7mT'  // ATTESTATION_PROVISION_URL
    }
  ],
  created_at: 1772464517
}
```

---

## New Approach — DataPacketRequestDetails

### Imports

```javascript
const {
  DataPacketRequestDetails,
  DataPacketRequestOrdinalVDXFObject,
  GenericRequest,
  DataDescriptor,
  URLRef,
  CrossChainDataRef,
  CrossChainDataRefKey,
  VdxfUniValue,
  CompactIAddressObject,
  CompactAddressObject
} = require('verus-typescript-primitives');
```

### Creating a URL Data Descriptor

Use this helper to create a `DataDescriptor` containing a URL reference:

```javascript
const createUrlDataDescriptor = (url = "https://example.com/data.json", dataHash = null) => {
  const urlRefParams = { version: URLRef.LAST_VERSION, url: url };
  
  if (dataHash) {
    urlRefParams.flags = URLRef.FLAG_HAS_HASH;
    urlRefParams.data_hash = Buffer.from(dataHash, 'hex');
  }
  
  const urlRef = new URLRef(urlRefParams);
  const ccdref = new CrossChainDataRef(urlRef);
  
  const urlRefMap = [];
  urlRefMap.push({ [CrossChainDataRefKey.vdxfid]: ccdref });
  
  const urlRefUniValue = new VdxfUniValue({ values: urlRefMap });
  
  return DataDescriptor.fromJson({
    version: 1,
    objectdata: urlRefUniValue.toBuffer().toString('hex')
  });
};
```

### Setting Up Flags

For transmitting data to a user with a download URL:

```javascript
const userControlledFlags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
  .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
  .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
```

### Available Flags

| Flag | Description |
|------|-------------|
| `FLAG_HAS_REQUEST_ID` | Request includes a tracking request ID |
| `FLAG_HAS_STATEMENTS` | Request includes statement strings |
| `FLAG_HAS_SIGNATURE` | Request includes a signature |
| `FLAG_FOR_USERS_SIGNATURE` | Request is asking for user's signature |
| `FLAG_FOR_TRANSMITTAL_TO_USER` | Data is being sent TO the user |
| `FLAG_HAS_URL_FOR_DOWNLOAD` | Data should be downloaded from URL |

### Creating DataPacketRequestDetails

```javascript
const url = "https://api.roomful.net/verus/getClaimsData/i7pZ1YqF1ADaNnC7ow6ndSBAEmYDq5wH7L'";
const hashOfDataAtURI = "32byteshex"

const details = new DataPacketRequestDetails({
  flags: userControlledFlags,
  signableObjects: createUrlDataDescriptor(url, hashOfDataAtURI),
  requestID: new CompactIAddressObject({
    type: CompactAddressObject.TYPE_I_ADDRESS,
    address: "ixzczcxzczxczxczxczxczxzxc",  //random i address for requestid tracking
    rootSystemName: "VRSC"
  })
});
```

### Wrapping in GenericRequest

```javascript

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



const authOrdinal = buildRecipientAuthDetails("theusersaddress@")
const dataOrdinal = new DataPacketRequestOrdinalVDXFObject({ data: details });


  const VerusId = new VerusIdInterface("VRSC", "https://api.verus.services");

    const req = VerusId.createGenericRequest(
      {
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        details: [authOrdinal, dataOrdinal],
        signature: new VerifiableSignatureData({systemID: CompactIAddressObject.fromAddress(SYSTEM_ID.toAddress()!),
            identityID: CompactIAddressObject.fromAddress(VALU_SIGNING_ID.identity.identityaddress)})
      },
      WIF_OF_VALUID_SIGNING,
      null,
      null,
      VERUS_I_ADDR
    );


```

---

## URL Response Format

When the app downloads data from the URL, the response is **not JSON** — it is a **hex string** representing serialized binary data.

### How the App Verifies the Download

The app hashes the downloaded hex data and compares it to the expected hash:

```javascript
const crypto = require('crypto');

// Download returns hex string
const downloadedHex = downloadResponse.data;

// Convert hex to buffer and hash
const dataBuffer = Buffer.from(downloadedHex, 'hex');
const downloadedHash = crypto.createHash('sha256').update(dataBuffer).digest();

// Compare with expected hash from URLRef
const expectedHash = urlRef.data_hash;
const hashMatches = downloadedHash.equals(expectedHash);

if (!hashMatches) {
  throw new Error('Downloaded data hash does not match expected hash');
}
```

---

## Creating Data for the URL Endpoint

The data served at the URL must be a `DataDescriptor` containing an `MMRDescriptor` and `SignatureData`, serialized to hex.

### Imports

```javascript
const {
  DataDescriptor,
  MMRDescriptor,
  MMRDescriptorKey,
  SignatureData,
  SignatureDataKey,
  VdxfUniValue
} = require('verus-typescript-primitives');
```

### Building the Download Data

```javascript
// Create your MMRDescriptor with claim data
const mmrDescriptor = new MMRDescriptor({
  // ... your MMR descriptor configuration
});

// Create the signature data
const signatureData = new SignatureData({
  // ... your signature configuration
});

// Combine into a VdxfUniValue map
const dataMap = [];
dataMap.push({ [MMRDescriptorKey.vdxfid]: mmrDescriptor });
dataMap.push({ [SignatureDataKey.vdxfid]: signatureData });

// push more mmrdescriptors and signaturedata pairs if multiple item download

const uniValue = new VdxfUniValue({ values: dataMap });

// Wrap in a DataDescriptor
const downloadDescriptor = new DataDescriptor({
  objectdata: uniValue.toBuffer(),
  label: "download claim"
});

// Serialize to hex for serving at URL
const hexToServe = downloadDescriptor.toBuffer().toString('hex');
```

### Server Endpoint Example

```javascript
app.get('/verus/getClaimsData/:requestId', (req, res) => {
  const { requestId } = req.params;
  
  // Retrieve the pre-built download descriptor for this request
  const downloadDescriptor = getStoredDescriptor(requestId);
  
  // Serve as hex string
  const hexData = downloadDescriptor.toBuffer().toString('hex');
  
  res.type('text/plain').send(hexData);
});
```

### Computing the Hash for the Request

When creating the `DataPacketRequestDetails`, compute the hash of the data you will serve:

```javascript
const crypto = require('crypto');

// Build the download descriptor first
const downloadDescriptor = new DataDescriptor({
  objectdata: uniValue.toBuffer(),
  label: "download claim"
});

// Compute hash of serialized data
const dataBuffer = downloadDescriptor.toBuffer();
const dataHash = crypto.createHash('sha256').update(dataBuffer).digest('hex');

// Use this hash when creating the URL descriptor
const urlDescriptor = createUrlDataDescriptor(
  "https://api.example.com/verus/getClaimsData/" + requestId,
  dataHash
);
```
