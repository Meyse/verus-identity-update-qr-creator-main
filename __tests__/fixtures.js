const { BN } = require('bn.js');
const {
  CompactIAddressObject,
  CompactAddressObject,
  VerifiableSignatureData,
  DataDescriptor,
  URLRef,
  CrossChainDataRef,
  CrossChainDataRefKey,
  VdxfUniValue
} = require('verus-typescript-primitives');

// Test system and identity addresses (valid base58 Verus testnet addresses)
// Using known valid Verus testnet i-addresses for testing
const SYSTEM_ID_TESTNET = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq";
const TEST_SIGNING_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"; // Valid testnet system ID
const TEST_REQUEST_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"; // Reuse valid testnet ID
const TEST_RECIPIENT_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"; // Reuse valid testnet ID

// Create sample CompactIAddressObject instances
const createTestSigningId = () => CompactIAddressObject.fromAddress(TEST_SIGNING_ID);
const createTestRequestId = () => CompactIAddressObject.fromAddress(TEST_REQUEST_ID);
const createTestRecipientId = () => CompactIAddressObject.fromAddress(TEST_RECIPIENT_ID);
const createTestSystemId = () => CompactIAddressObject.fromAddress(SYSTEM_ID_TESTNET);

// Create sample VerifiableSignatureData
const createTestSignatureData = () => new VerifiableSignatureData({
  systemID: createTestSystemId(),
  identityID: createTestSigningId()
});

// Create sample statements
const createTestStatements = () => [
  "This is a test statement 1",
  "This is a test statement 2"
];

// Create a sample DataDescriptor with simple data
const createSimpleDataDescriptor = (data = "Test data") => {
  const buffer = Buffer.from(data, 'utf-8');
  return DataDescriptor.fromJson({
    version: 1,
    objectdata: buffer.toString('hex')
  });
};

// Create a sample DataDescriptor with URL (for download flag tests)
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

// Create multiple DataDescriptors for testing
const createMultipleDataDescriptors = (count = 3) => {
  const descriptors = [];
  for (let i = 0; i < count; i++) {
    descriptors.push(createSimpleDataDescriptor(`Test data ${i + 1}`));
  }
  return descriptors;
};

// Sample redirect URIs for GenericRequest
const createTestRedirects = () => [
  { type: 1, uri: "verus://callback/success" },
  { type: 2, uri: "https://example.com/callback" }
];

module.exports = {
  SYSTEM_ID_TESTNET,
  TEST_SIGNING_ID,
  TEST_REQUEST_ID,
  TEST_RECIPIENT_ID,
  createTestSigningId,
  createTestRequestId,
  createTestRecipientId,
  createTestSystemId,
  createTestSignatureData,
  createTestStatements,
  createSimpleDataDescriptor,
  createUrlDataDescriptor,
  createMultipleDataDescriptors,
  createTestRedirects
};
