```js

  async function createSignedRequest(details: Array<OrdinalVDXFObject>) {
    return VerusId.createGenericRequest(
      {
        createdAt: TEST_CREATED_AT,
        salt: TEST_SALT,
        details: details,
        signature: new VerifiableSignatureData(TEST_UNSIGNED_VERIFIABLE_SIG_DATA)
      },
      "UrEJQMk9PD4Fo9i8FNb1ZSFRrC9TrD4j6CGbFvbFHVH83bStroHH",
      TEST_ID,
      18167,
      VERUSTEST_I_ADDR
    );
  }


    const req = await createSignedRequest([
      new IdentityUpdateResponseOrdinalVDXFObject({ data: TEST_ID_UPDATE_RESPONSE_DETAILS }),
      new AuthenticationRequestOrdinalVDXFObject()
    ]);

    const ok = await VerusId.verifyGenericRequest(
      req,
      TEST_ID,
      VERUSTEST_I_ADDR,
      TEST_CREATED_AT.toNumber()
    );

    const deeplink = req.toWalletDeeplinkUri();
