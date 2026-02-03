// Updated: add sample type 2 POST callback in REDIRECTS.
const conf = {
  // RPC Info
  RPC_PORT: 18843,
  RPC_USER: "c5dUxeBsBvaHsm8Me4sziDgGVqMx-bK8_TZDy4SWiiY",
  RPC_PASSWORD: "51zaj-USx5fRMyB6IJEG5ugE0zUdCt7j7S5B8okw4qw",

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

  // The ID you want to sign the request with (taken from your currently running wallet)
  SIGNING_ID: "i89UVSuN6vfWg1mWpXMuc6dsJBdeYTi7bX",
}

module.exports = conf