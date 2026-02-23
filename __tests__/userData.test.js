const { BN } = require('bn.js');
const {
  UserDataRequestDetails,
  UserDataRequestOrdinalVDXFObject,
  CompactIAddressObject,
  CompactAddressObject
} = require('verus-typescript-primitives');

const {
  createTestSigner,
  createUserDataRequestId,
  createSingleSearchDataKey,
  createMultipleSearchDataKeys,
  createTestRequestedKeys,
  VDXF_KEY_ATTESTATION_NAME,
  VDXF_KEY_CLAIMS_EMPLOYMENT,
  VDXF_KEY_IDENTITY_OVER21,
  VDXF_KEY_IDENTITY_EMAIL,
  TEST_SIGNER_ID,
  TEST_USERDATA_REQUEST_ID
} = require('./fixtures');

// ── Constants ──

const DATA_TYPES = [
  { name: 'FULL_DATA',    value: UserDataRequestDetails.FULL_DATA,    num: 1 },
  { name: 'PARTIAL_DATA', value: UserDataRequestDetails.PARTIAL_DATA, num: 2 },
  { name: 'COLLECTION',   value: UserDataRequestDetails.COLLECTION,   num: 3 }
];

const REQUEST_TYPES = [
  { name: 'ATTESTATION', value: UserDataRequestDetails.ATTESTATION, num: 1 },
  { name: 'CLAIM',       value: UserDataRequestDetails.CLAIM,       num: 2 },
  { name: 'CREDENTIAL',  value: UserDataRequestDetails.CREDENTIAL,  num: 3 }
];

// 3 flags → 2^3 = 8 combinations (0x0 – 0x7)
const FLAG_DEFINITIONS = [
  {
    bit: 0, // 2^0 = 1
    name: 'FLAG_HAS_REQUEST_ID',
    flag: UserDataRequestDetails.FLAG_HAS_REQUEST_ID,
    dataKey: 'requestID',
    createData: createUserDataRequestId
  },
  {
    bit: 1, // 2^1 = 2
    name: 'FLAG_HAS_SIGNER',
    flag: UserDataRequestDetails.FLAG_HAS_SIGNER,
    dataKey: 'signer',
    createData: createTestSigner
  },
  {
    bit: 2, // 2^2 = 4
    name: 'FLAG_HAS_REQUESTED_KEYS',
    flag: UserDataRequestDetails.FLAG_HAS_REQUESTED_KEYS,
    dataKey: 'requestedKeys',
    createData: createTestRequestedKeys
  }
];

// ── Helpers ──

/**
 * Validate that flags match the presence of companion data,
 * and that dataType / requestType are valid enums.
 */
function validateUserDataRequestDetails(details) {
  const errors = [];
  const flags = details.flags;

  // FLAG_HAS_REQUEST_ID (1) ↔ requestID
  if (flags.and(UserDataRequestDetails.FLAG_HAS_REQUEST_ID).gt(new BN(0))) {
    if (!details.requestID) {
      errors.push('FLAG_HAS_REQUEST_ID is set but requestID is missing');
    }
  } else {
    if (details.requestID) {
      errors.push('requestID is present but FLAG_HAS_REQUEST_ID is not set');
    }
  }

  // FLAG_HAS_SIGNER (2) ↔ signer
  if (flags.and(UserDataRequestDetails.FLAG_HAS_SIGNER).gt(new BN(0))) {
    if (!details.signer) {
      errors.push('FLAG_HAS_SIGNER is set but signer is missing');
    }
  } else {
    if (details.signer) {
      errors.push('signer is present but FLAG_HAS_SIGNER is not set');
    }
  }

  // FLAG_HAS_REQUESTED_KEYS (4) ↔ requestedKeys
  if (flags.and(UserDataRequestDetails.FLAG_HAS_REQUESTED_KEYS).gt(new BN(0))) {
    if (!details.requestedKeys || details.requestedKeys.length === 0) {
      errors.push('FLAG_HAS_REQUESTED_KEYS is set but requestedKeys is missing or empty');
    }
  } else {
    if (details.requestedKeys && details.requestedKeys.length > 0) {
      errors.push('requestedKeys is present but FLAG_HAS_REQUESTED_KEYS is not set');
    }
  }

  // dataType must be one of FULL_DATA (1), PARTIAL_DATA (2), COLLECTION (3)
  const dtValid = details.dataType.eq(UserDataRequestDetails.FULL_DATA)
    || details.dataType.eq(UserDataRequestDetails.PARTIAL_DATA)
    || details.dataType.eq(UserDataRequestDetails.COLLECTION);
  if (!dtValid) {
    errors.push(`Invalid dataType: ${details.dataType.toString()}`);
  }

  // requestType must be one of ATTESTATION (1), CLAIM (2), CREDENTIAL (3)
  const rtValid = details.requestType.eq(UserDataRequestDetails.ATTESTATION)
    || details.requestType.eq(UserDataRequestDetails.CLAIM)
    || details.requestType.eq(UserDataRequestDetails.CREDENTIAL);
  if (!rtValid) {
    errors.push(`Invalid requestType: ${details.requestType.toString()}`);
  }

  // searchDataKey must be present and non-empty
  if (!details.searchDataKey || Object.keys(details.searchDataKey).length === 0) {
    errors.push('searchDataKey must be present and non-empty');
  }

  // PARTIAL_DATA requires requestedKeys
  if (details.dataType.eq(UserDataRequestDetails.PARTIAL_DATA)) {
    if (!details.requestedKeys || details.requestedKeys.length === 0) {
      errors.push('PARTIAL_DATA requires requestedKeys to be present');
    }
  }

  // COLLECTION should NOT use requestedKeys
  if (details.dataType.eq(UserDataRequestDetails.COLLECTION)) {
    if (details.requestedKeys && details.requestedKeys.length > 0) {
      errors.push('COLLECTION should not have requestedKeys');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Roundtrip serialization: toBuffer() → fromBuffer() → compare hex.
 */
function testRoundtripSerialization(initial) {
  try {
    const initialBuffer = initial.toBuffer();
    const initialHex = initialBuffer.toString('hex');

    const restored = new UserDataRequestDetails();
    restored.fromBuffer(initialBuffer, 0);

    const restoredHex = restored.toBuffer().toString('hex');
    if (initialHex === restoredHex) {
      return { success: true };
    }
    return { success: false, error: 'hex mismatch', initialHex, restoredHex };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Build a UserDataRequestDetails from a flag mask (0–7), dataType, and requestType.
 *
 * For PARTIAL_DATA the FLAG_HAS_REQUESTED_KEYS bit is always forced on.
 * For COLLECTION the FLAG_HAS_REQUESTED_KEYS bit is always forced off.
 */
function buildFromMask(mask, dataType, requestType) {
  let flags = new BN(0);
  const data = {};

  for (const def of FLAG_DEFINITIONS) {
    if (mask & (1 << def.bit)) {
      flags = flags.or(def.flag);
      if (def.dataKey && def.createData) {
        data[def.dataKey] = def.createData();
      }
    }
  }

  // Enforce constraints:
  // PARTIAL_DATA always needs requestedKeys
  if (dataType.eq(UserDataRequestDetails.PARTIAL_DATA)) {
    if (!data.requestedKeys) {
      flags = flags.or(UserDataRequestDetails.FLAG_HAS_REQUESTED_KEYS);
      data.requestedKeys = createTestRequestedKeys();
    }
  }
  // COLLECTION must NOT have requestedKeys
  if (dataType.eq(UserDataRequestDetails.COLLECTION)) {
    flags = flags.and(UserDataRequestDetails.FLAG_HAS_REQUESTED_KEYS.notn(256).and(new BN(0xFF)));
    // Simpler: just clear bit 2
    flags = new BN(flags.toNumber() & ~4);
    delete data.requestedKeys;
  }

  const searchDataKey = dataType.eq(UserDataRequestDetails.COLLECTION)
    ? createMultipleSearchDataKeys()
    : createSingleSearchDataKey();

  return new UserDataRequestDetails({
    version: new BN(1),
    flags,
    dataType,
    requestType,
    searchDataKey,
    ...data
  });
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('UserDataRequestDetails', () => {

  // ── Basic flag validation ──

  describe('Basic flag validation', () => {

    test('no optional flags — bare minimum', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('FLAG_HAS_REQUEST_ID with requestID', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey(),
        requestID: createUserDataRequestId()
      });
      expect(details.hasRequestID()).toBe(true);
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('FLAG_HAS_SIGNER with signer', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey(),
        signer: createTestSigner()
      });
      expect(details.hasSigner()).toBe(true);
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('FLAG_HAS_REQUESTED_KEYS with requestedKeys (PARTIAL_DATA)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey(),
        requestedKeys: createTestRequestedKeys()
      });
      expect(details.hasRequestedKeys()).toBe(true);
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('all three flags set', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.CREDENTIAL,
        searchDataKey: createSingleSearchDataKey(),
        requestID: createUserDataRequestId(),
        signer: createTestSigner(),
        requestedKeys: createTestRequestedKeys()
      });
      expect(details.flags.toNumber()).toBe(7);
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('should fail when searchDataKey is empty', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: []
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(false);
      expect(v.errors).toContain('searchDataKey must be present and non-empty');
    });

    test('PARTIAL_DATA without requestedKeys should fail validation', () => {
      // Manually construct to bypass setFlags auto-setting
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(false);
      expect(v.errors).toContain('PARTIAL_DATA requires requestedKeys to be present');
    });

    test('COLLECTION with requestedKeys should fail validation', () => {
      // Force requestedKeys on COLLECTION
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.COLLECTION,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createMultipleSearchDataKeys(),
        requestedKeys: createTestRequestedKeys()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(false);
      expect(v.errors).toContain('COLLECTION should not have requestedKeys');
    });
  });

  // ── dataType enumeration ──

  describe('dataType values', () => {
    test.each(DATA_TYPES)('should accept dataType $name ($num)', ({ value }) => {
      const isPartial = value.eq(UserDataRequestDetails.PARTIAL_DATA);
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: value,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: value.eq(UserDataRequestDetails.COLLECTION) ? createMultipleSearchDataKeys() : createSingleSearchDataKey(),
        ...(isPartial ? { requestedKeys: createTestRequestedKeys() } : {})
      });
      expect(details.hasDataTypeSet()).toBe(true);
      expect(details.isValid()).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('should reject invalid dataType (0)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: new BN(0),
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(details.hasDataTypeSet()).toBe(false);
      expect(details.isValid()).toBe(false);
    });

    test('should reject invalid dataType (4)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: new BN(4),
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(details.hasDataTypeSet()).toBe(false);
      expect(details.isValid()).toBe(false);
    });
  });

  // ── requestType enumeration ──

  describe('requestType values', () => {
    test.each(REQUEST_TYPES)('should accept requestType $name ($num)', ({ value }) => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: value,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(details.hasRequestTypeSet()).toBe(true);
      expect(details.isValid()).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('should reject invalid requestType (0)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: new BN(0),
        searchDataKey: createSingleSearchDataKey()
      });
      expect(details.hasRequestTypeSet()).toBe(false);
      expect(details.isValid()).toBe(false);
    });

    test('should reject invalid requestType (4)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: new BN(4),
        searchDataKey: createSingleSearchDataKey()
      });
      expect(details.hasRequestTypeSet()).toBe(false);
      expect(details.isValid()).toBe(false);
    });
  });

  // ── Real-world scenarios ──

  describe('Real-world scenarios', () => {

    test('full KYC attestation request (FULL_DATA + ATTESTATION + signer)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: [{ [VDXF_KEY_ATTESTATION_NAME]: "Valu Proof of Humanity" }],
        signer: createTestSigner()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('employment claim request (FULL_DATA + CLAIM)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.CLAIM,
        searchDataKey: [{ [VDXF_KEY_CLAIMS_EMPLOYMENT]: "Employment at Acme Widgets" }],
        signer: createTestSigner()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('partial credential request (PARTIAL_DATA + CREDENTIAL + requestedKeys)', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.CREDENTIAL,
        searchDataKey: [{ [VDXF_KEY_ATTESTATION_NAME]: "Valu Proof of Humanity" }],
        signer: createTestSigner(),
        requestedKeys: [VDXF_KEY_IDENTITY_OVER21, VDXF_KEY_IDENTITY_EMAIL]
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(details.hasRequestedKeys()).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('collection of employment credentials', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.COLLECTION,
        requestType: UserDataRequestDetails.CREDENTIAL,
        searchDataKey: [{ [VDXF_KEY_CLAIMS_EMPLOYMENT]: "" }],
        signer: createTestSigner()
      });
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });

    test('full attestation with requestID and signer', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: [{ [VDXF_KEY_ATTESTATION_NAME]: "Attestation Name" }],
        signer: createTestSigner(),
        requestID: createUserDataRequestId()
      });
      expect(details.flags.toNumber()).toBe(3); // REQUEST_ID(1) | SIGNER(2)
      const v = validateUserDataRequestDetails(details);
      expect(v.valid).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });
  });

  // ── Comprehensive loop: all flag × dataType × requestType combos ──

  describe('Comprehensive combinations (flags × dataType × requestType)', () => {
    // 8 flag masks × 3 dataTypes × 3 requestTypes = 72 combinations
    // Some are constrained (PARTIAL needs requestedKeys, COLLECTION forbids requestedKeys)
    const combos = [];
    for (let mask = 0x0; mask <= 0x7; mask++) {
      for (const dt of DATA_TYPES) {
        for (const rt of REQUEST_TYPES) {
          combos.push({ mask, dtName: dt.name, dtVal: dt.value, rtName: rt.name, rtVal: rt.value });
        }
      }
    }

    test.each(combos)(
      'mask=0x$mask $dtName + $rtName',
      ({ mask, dtName, dtVal, rtName, rtVal }) => {
        const details = buildFromMask(mask, dtVal, rtVal);

        // Get active flag names for debug
        const flagNames = FLAG_DEFINITIONS
          .filter(def => details.flags.toNumber() & (1 << def.bit))
          .map(def => def.name);

        // Validate
        const v = validateUserDataRequestDetails(details);
        if (!v.valid) {
          console.error(`Validation failed: mask=0x${mask.toString(16)} ${dtName} ${rtName} flags=[${flagNames}]`);
          console.error('Errors:', v.errors);
        }
        expect(v.valid).toBe(true);

        // Roundtrip
        const rt = testRoundtripSerialization(details);
        if (!rt.success) {
          console.error(`Roundtrip failed: mask=0x${mask.toString(16)} ${dtName} ${rtName}`);
          console.error('Error:', rt.error);
          if (rt.initialHex && rt.restoredHex) {
            console.error('Initial:', rt.initialHex);
            console.error('Restored:', rt.restoredHex);
          }
        }
        expect(rt.success).toBe(true);
      }
    );
  });

  // ── OrdinalVDXFObject wrapper ──

  describe('UserDataRequestOrdinalVDXFObject wrapper', () => {

    test('should wrap and roundtrip via OrdinalVDXFObject', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey(),
        signer: createTestSigner(),
        requestID: createUserDataRequestId()
      });

      const obj = new UserDataRequestOrdinalVDXFObject({ data: details });
      const buf = obj.toBuffer();
      const restored = new UserDataRequestOrdinalVDXFObject();
      restored.fromBuffer(buf, 0);

      expect(restored.data).toBeDefined();
      expect(restored.toBuffer().toString('hex')).toBe(buf.toString('hex'));
    });

    test('should roundtrip PARTIAL_DATA with requestedKeys via OrdinalVDXFObject', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.CREDENTIAL,
        searchDataKey: [{ [VDXF_KEY_ATTESTATION_NAME]: "Valu Proof of Humanity" }],
        signer: createTestSigner(),
        requestedKeys: [VDXF_KEY_IDENTITY_OVER21, VDXF_KEY_IDENTITY_EMAIL]
      });

      const obj = new UserDataRequestOrdinalVDXFObject({ data: details });
      const buf = obj.toBuffer();
      const restored = new UserDataRequestOrdinalVDXFObject();
      restored.fromBuffer(buf, 0);

      expect(restored.data.flags.toNumber()).toBe(details.flags.toNumber());
      expect(restored.toBuffer().toString('hex')).toBe(buf.toString('hex'));
    });

    test('should roundtrip COLLECTION via OrdinalVDXFObject', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.COLLECTION,
        requestType: UserDataRequestDetails.CLAIM,
        searchDataKey: createMultipleSearchDataKeys(),
        signer: createTestSigner()
      });

      const obj = new UserDataRequestOrdinalVDXFObject({ data: details });
      const buf = obj.toBuffer();
      const restored = new UserDataRequestOrdinalVDXFObject();
      restored.fromBuffer(buf, 0);

      expect(restored.toBuffer().toString('hex')).toBe(buf.toString('hex'));
    });
  });

  // ── isValid() method ──

  describe('isValid()', () => {

    test('valid minimal instance returns true', () => {
      const d = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(d.isValid()).toBe(true);
    });

    test('invalid version (0) returns false', () => {
      const d = new UserDataRequestDetails({
        version: new BN(0),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(d.isValid()).toBe(false);
    });

    test('empty searchDataKey returns false', () => {
      const d = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: []
      });
      expect(d.isValid()).toBe(false);
    });

    test('invalid dataType returns false', () => {
      const d = new UserDataRequestDetails({
        version: new BN(1),
        dataType: new BN(99),
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: createSingleSearchDataKey()
      });
      expect(d.isValid()).toBe(false);
    });

    test('invalid requestType returns false', () => {
      const d = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.FULL_DATA,
        requestType: new BN(99),
        searchDataKey: createSingleSearchDataKey()
      });
      expect(d.isValid()).toBe(false);
    });
  });

  // ── JSON serialization ──

  describe('toJson() / fromJson()', () => {

    test('roundtrip via JSON', () => {
      const original = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.PARTIAL_DATA,
        requestType: UserDataRequestDetails.CREDENTIAL,
        searchDataKey: [{ [VDXF_KEY_ATTESTATION_NAME]: "Test" }],
        signer: createTestSigner(),
        requestedKeys: createTestRequestedKeys(),
        requestID: createUserDataRequestId()
      });

      const json = original.toJson();
      const restored = UserDataRequestDetails.fromJson(json);

      expect(restored.flags.toNumber()).toBe(original.flags.toNumber());
      expect(restored.dataType.toNumber()).toBe(original.dataType.toNumber());
      expect(restored.requestType.toNumber()).toBe(original.requestType.toNumber());
      expect(restored.toBuffer().toString('hex')).toBe(original.toBuffer().toString('hex'));
    });
  });

  // ── Multiple searchDataKey entries ──

  describe('Multiple searchDataKey entries', () => {

    test('should handle multiple keys', () => {
      const details = new UserDataRequestDetails({
        version: new BN(1),
        dataType: UserDataRequestDetails.COLLECTION,
        requestType: UserDataRequestDetails.ATTESTATION,
        searchDataKey: [
          { [VDXF_KEY_ATTESTATION_NAME]: "Attestation Name" },
          { [VDXF_KEY_CLAIMS_EMPLOYMENT]: "Employment" },
          { [VDXF_KEY_IDENTITY_OVER21]: "Over 21" }
        ]
      });
      expect(details.searchDataKey.length).toBe(3);
      expect(details.isValid()).toBe(true);
      expect(testRoundtripSerialization(details).success).toBe(true);
    });
  });
});
