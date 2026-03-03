## To request a piece of data off the user we can:


### If you want to request keys from an mmr attetation the user owns

```js

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

    const provisionJson: UserDataRequestJson = {
      version: 1,
      flags: UserDataRequestDetails.FLAG_HAS_SIGNER.toNumber(),
      datatype: UserDataRequestDetails.PARTIAL_DATA.toNumber(), //partial data to request just mmr info
      requesttype: UserDataRequestDetails.ATTESTATION.toNumber(),
      searchdatakey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Attestation Name" }], // name e.g. [ATTESTATION_NAME.vdxfid]: ""
      signer: { version: 1, type: CompactAddressObject.TYPE_FQN.toNumber(), address: "attestationsigner@", rootsystemname: "VRSC" },
      requestedkeys: ["iLB8SG7ErJtTYcG1f4w9RLuMJPpAsjFkiL"], // keys from mmr wanted e.g. vrsc::identity.firstname
      requestid: CompactIAddressObject.fromAddress("iD4CrjbJBZmwEZQ4bCWgbHx9tBHGP9mdSQ").toJson()
    }

    const userDetailsObject = UserDataRequestDetails.fromJson(provisionJson);

    const authOrdinal = buildRecipientAuthDetails("theusersaddress@")       

    const userOrdinal = new UserDataRequestOrdinalVDXFObject({ data: details });

    const VerusId = new VerusIdInterface("VRSC", "https://api.verus.services");

    const req = VerusId.createGenericRequest(
      {
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        details: [authOrdinal, userOrdinal],
        signature: new VerifiableSignatureData({systemID: CompactIAddressObject.fromAddress(SYSTEM_ID.toAddress()!),
            identityID: CompactIAddressObject.fromAddress(VALU_SIGNING_ID.identity.identityaddress)}),
        responseURIs: [ResponseURI.fromUriString("https://verus.io/callback", ResponseURI.TYPE_POST)]
      },
      WIF_OF_VALUID_SIGNING,
      null,
      null,
      VERUS_I_ADDR
    );

```

### If you want to request the full data e.g. a full claim

```js

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

    const provisionJson: UserDataRequestJson = {
      version: 1,
      flags: UserDataRequestDetails.FLAG_HAS_SIGNER.toNumber(),
      datatype: UserDataRequestDetails.PARTIAL_DATA.toNumber(), //full data to request 
      requesttype: UserDataRequestDetails.ATTESTATION.toNumber(),
      searchdatakey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Attestation Name" }], // name e.g. [ATTESTATION_NAME.vdxfid]: ""
      signer: { version: 1, type: CompactAddressObject.TYPE_FQN.toNumber(), address: "attestationsigner@", rootsystemname: "VRSC" },
      requestedkeys: null, 
      requestid: CompactIAddressObject.fromAddress("iD4CrjbJBZmwEZQ4bCWgbHx9tBHGP9mdSQ").toJson()
    }

    const userDetailsObject = UserDataRequestDetails.fromJson(provisionJson);

    const authOrdinal = buildRecipientAuthDetails("theusersaddress@")       

    const userOrdinal = new UserDataRequestOrdinalVDXFObject({ data: details,

     });

    const VerusId = new VerusIdInterface("VRSC", "https://api.verus.services");

    const req = VerusId.createGenericRequest(
      {
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        details: [authOrdinal, userOrdinal],
        signature: new VerifiableSignatureData({systemID: CompactIAddressObject.fromAddress(SYSTEM_ID.toAddress()!),
            identityID: CompactIAddressObject.fromAddress(VALU_SIGNING_ID.identity.identityaddress)})
      },
      WIF_OF_VALUID_SIGNING,
      null,
      null,
      VERUS_I_ADDR
    );

```

### If you want to request a collection of items e.g 3 differnt claims

```js

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

    const provisionJson: UserDataRequestJson = {
      version: 1,
      flags: UserDataRequestDetails.FLAG_HAS_SIGNER.toNumber(),
      datatype: UserDataRequestDetails.COLLECTION.toNumber(), // get all the items of a particular type
      requesttype: UserDataRequestDetails.ATTESTATION.toNumber(),
      searchdatakey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "" }], // valu.vrsc::claims.employment
      signer: { version: 1, type: CompactAddressObject.TYPE_FQN.toNumber(), address: "attestationsigner@", rootsystemname: "VRSC" },
      requestedkeys: null, 
      requestid: CompactIAddressObject.fromAddress("iD4CrjbJBZmwEZQ4bCWgbHx9tBHGP9mdSQ").toJson()
    }

    const userDetailsObject = UserDataRequestDetails.fromJson(provisionJson);

    const authOrdinal = buildRecipientAuthDetails("theusersaddress@")       

    const userOrdinal = new UserDataRequestOrdinalVDXFObject({ data: details,

     });

    const VerusId = new VerusIdInterface("VRSC", "https://api.verus.services");

    const req = VerusId.createGenericRequest(
      {
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        details: [authOrdinal, userOrdinal],
        signature: new VerifiableSignatureData({systemID: CompactIAddressObject.fromAddress(SYSTEM_ID.toAddress()!),
            identityID: CompactIAddressObject.fromAddress(VALU_SIGNING_ID.identity.identityaddress)})
      },
      WIF_OF_VALUID_SIGNING,
      null,
      null,
      VERUS_I_ADDR
    );

```