// Updated: switch to remote API settings and env-based WIF signing.
const conf = {
  // Remote API (vrsctest)
  API_BASE_URL: "https://api.verustest.net/",
  SYSTEM_I_ADDRESS: "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq",

  // What you would normally pass to 'jsonidentity' when calling updateidentity
  JSON_IDENTITY_CHANGES: {
    "name": "player7",
    "contentmultimap": {
      iP2cgAhoWvJr28BhJiTQPD7KBqAXbJNYeW: {
        "data": {
            "createmmr": true,
            "mmrdata": [
                {
                    "message": "{\"rail_transport\": 43326.71, \"public_bus_transport\": 83452.4, \"air_transport\": 1306.83, \"urban_public_transport\": -1, \"time\": 993945600}"
                }
            ],
            "mmrhashtype": "sha256",
            "hashtype": "sha256"
        }
      },
      iB9w3n2QiKXKhs8xHny5PLjNGBtdJqKTTx: '6868686868686868686868686868686868686868',
      iGdWifeNFcN69JiFwmcZTYT1zPYpFumGhq: { iK7a5JNJnbeuYWVHCDRpJosj3irGJ5Qa8c: 'Another test string :)' }
    },
  },

  // Unique number for the request you want to make
  REQUEST_ID: "iJitWFN8PY37GrBVtF38HyftG8WohWipbL",

  // Array of redirect uris, can be left empty
  REDIRECTS: [
    // Type 1 means the user will be redirected to the URI and the response will be appended to the uri as a url parameter
    {
      type: "1",
      uri: "https://www.verus.io"
    },
    // Type 2 means the data will be sent with a POST request to the uri
    {
      type: "2",
      uri: "https://example.com/callback/post-7c3b2f"
    }
  ],

  // The ID you want to sign the request with (single-sig primary address WIF is in VERUS_SIGNING_WIF)
  SIGNING_ID: "i89UVSuN6vfWg1mWpXMuc6dsJBdeYTi7bX",
}

module.exports = conf