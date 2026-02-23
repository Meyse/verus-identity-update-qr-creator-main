const { BN } = require('bn.js');
const {
  DataPacketRequestDetails,
  DataPacketRequestOrdinalVDXFObject,
  CompactIAddressObject
} = require('verus-typescript-primitives');

const {
  createTestRequestId,
  createTestSignatureData,
  createTestStatements,
  createSimpleDataDescriptor,
  createUrlDataDescriptor,
  createMultipleDataDescriptors
} = require('./fixtures');

/**
 * Validation function for DataPacketRequestDetails.
 * Validates that flags match the presence of data.
 * 
 * @param {DataPacketRequestDetails} details - The DataPacketRequestDetails instance
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateDataPacketRequestDetails(details) {
  const errors = [];
  const flags = details.flags;

  // FLAG_HAS_REQUEST_ID (1) - must have requestID when set
  if (flags.and(DataPacketRequestDetails.FLAG_HAS_REQUEST_ID).gt(new BN(0))) {
    if (!details.requestID) {
      errors.push('FLAG_HAS_REQUEST_ID is set but requestID is missing');
    }
  } else {
    if (details.requestID) {
      errors.push('requestID is present but FLAG_HAS_REQUEST_ID is not set');
    }
  }

  // FLAG_HAS_STATEMENTS (2) - must have statements when set
  if (flags.and(DataPacketRequestDetails.FLAG_HAS_STATEMENTS).gt(new BN(0))) {
    if (!details.statements || details.statements.length === 0) {
      errors.push('FLAG_HAS_STATEMENTS is set but statements are missing or empty');
    }
  } else {
    if (details.statements && details.statements.length > 0) {
      errors.push('statements are present but FLAG_HAS_STATEMENTS is not set');
    }
  }

  // FLAG_HAS_SIGNATURE (4) - must have signature when set
  if (flags.and(DataPacketRequestDetails.FLAG_HAS_SIGNATURE).gt(new BN(0))) {
    if (!details.signature) {
      errors.push('FLAG_HAS_SIGNATURE is set but signature is missing');
    }
  } else {
    if (details.signature) {
      errors.push('signature is present but FLAG_HAS_SIGNATURE is not set');
    }
  }

  // FLAG_FOR_USERS_SIGNATURE (8) - can be present or not
  // (GenericRequest validation will check for returnurl requirement)

  // FLAG_FOR_TRANSMITTAL_TO_USER (16) - can be present or not
  // (GenericRequest validation will check for auth preceding requirement)

  // FLAG_HAS_URL_FOR_DOWNLOAD (32) - can be present or not
  // When set, signableObjects should contain URL DataDescriptor

  // signableObjects must always be present and non-empty
  if (!details.signableObjects || details.signableObjects.length === 0) {
    errors.push('signableObjects must be present and non-empty');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Reusable roundtrip serialization test function.
 * Serializes a DataPacketRequestDetails instance, deserializes it, and verifies equality.
 * 
 * @param {DataPacketRequestDetails} initial - The initial DataPacketRequestDetails instance
 * @returns {Object} - { success: boolean, error?: string, initialHex?: string, restoredHex?: string }
 */
function testRoundtripSerialization(initial) {
  try {
    // Serialize initial to buffer
    const initialBuffer = initial.toBuffer();
    const initialHex = initialBuffer.toString('hex');
    
    // Deserialize from buffer
    const restored = new DataPacketRequestDetails();
    restored.fromBuffer(initialBuffer, 0);
    
    // Serialize restored to buffer
    const restoredBuffer = restored.toBuffer();
    const restoredHex = restoredBuffer.toString('hex');
    
    // Compare hex strings
    if (initialHex === restoredHex) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Serialization roundtrip failed: hex mismatch',
        initialHex,
        restoredHex
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Serialization roundtrip failed: ${error.message}`
    };
  }
}

/**
 * Lookup table for flag bit positions and their required data.
 * Used in comprehensive loop-based testing.
 */
const FLAG_DEFINITIONS = [
  { 
    bit: 0, // 2^0 = 1
    name: 'FLAG_HAS_REQUEST_ID',
    flag: DataPacketRequestDetails.FLAG_HAS_REQUEST_ID,
    dataKey: 'requestID',
    createData: createTestRequestId
  },
  { 
    bit: 1, // 2^1 = 2
    name: 'FLAG_HAS_STATEMENTS',
    flag: DataPacketRequestDetails.FLAG_HAS_STATEMENTS,
    dataKey: 'statements',
    createData: createTestStatements
  },
  { 
    bit: 2, // 2^2 = 4
    name: 'FLAG_HAS_SIGNATURE',
    flag: DataPacketRequestDetails.FLAG_HAS_SIGNATURE,
    dataKey: 'signature',
    createData: createTestSignatureData
  },
  { 
    bit: 3, // 2^3 = 8
    name: 'FLAG_FOR_USERS_SIGNATURE',
    flag: DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE,
    dataKey: null, // No data required
    createData: null
  },
  { 
    bit: 4, // 2^4 = 16
    name: 'FLAG_FOR_TRANSMITTAL_TO_USER',
    flag: DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER,
    dataKey: null, // No data required
    createData: null
  },
  { 
    bit: 5, // 2^5 = 32
    name: 'FLAG_HAS_URL_FOR_DOWNLOAD',
    flag: DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD,
    dataKey: null, // No data required, but affects signableObjects choice
    createData: null
  }
];

/**
 * Build DataPacketRequestDetails from a flag combination mask (0-63).
 * 
 * @param {number} mask - Bitmask from 0 to 63 (0x00 to 0x3F)
 * @returns {DataPacketRequestDetails}
 */
function buildDataPacketFromMask(mask) {
  let flags = new BN(0);
  const data = {};
  let hasUrlFlag = false;
  
  // Check each bit in the mask
  for (const def of FLAG_DEFINITIONS) {
    if (mask & (1 << def.bit)) {
      flags = flags.or(def.flag);
      
      if (def.dataKey && def.createData) {
        data[def.dataKey] = def.createData();
      }
      
      if (def.name === 'FLAG_HAS_URL_FOR_DOWNLOAD') {
        hasUrlFlag = true;
      }
    }
  }
  
  // Choose appropriate signableObjects based on URL flag
  const signableObjects = hasUrlFlag 
    ? [createUrlDataDescriptor()] 
    : [createSimpleDataDescriptor()];
  
  return new DataPacketRequestDetails({
    version: new BN(1),
    flags,
    signableObjects,
    ...data
  });
}

describe('DataPacketRequestDetails - Flag Combinations', () => {
  describe('Basic flag validation', () => {
    test('should create valid DataPacketRequestDetails with no optional flags', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should validate FLAG_HAS_REQUEST_ID requires requestID', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_REQUEST_ID,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should fail when FLAG_HAS_REQUEST_ID is set without requestID', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_REQUEST_ID,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('FLAG_HAS_REQUEST_ID is set but requestID is missing');
    });

    test('should validate FLAG_HAS_STATEMENTS requires statements', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_STATEMENTS,
        signableObjects: [createSimpleDataDescriptor()],
        statements: createTestStatements()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should fail when FLAG_HAS_STATEMENTS is set without statements', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_STATEMENTS,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('FLAG_HAS_STATEMENTS is set but statements are missing or empty');
    });

    test('should validate FLAG_HAS_SIGNATURE requires signature', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_SIGNATURE,
        signableObjects: [createSimpleDataDescriptor()],
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should fail when FLAG_HAS_SIGNATURE is set without signature', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_SIGNATURE,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('FLAG_HAS_SIGNATURE is set but signature is missing');
    });

    test('should validate FLAG_FOR_USERS_SIGNATURE can be set', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should validate FLAG_FOR_TRANSMITTAL_TO_USER can be set', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should validate FLAG_HAS_URL_FOR_DOWNLOAD can be set', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD,
        signableObjects: [createUrlDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should fail when signableObjects is missing', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: []
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('signableObjects must be present and non-empty');
    });
  });

  describe('Two-flag combinations', () => {
    test('FLAG_HAS_REQUEST_ID + FLAG_HAS_STATEMENTS', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId(),
        statements: createTestStatements()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_HAS_REQUEST_ID + FLAG_HAS_SIGNATURE', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId(),
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_HAS_STATEMENTS + FLAG_HAS_SIGNATURE', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_STATEMENTS
        .or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()],
        statements: createTestStatements(),
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_FOR_USERS_SIGNATURE + FLAG_FOR_TRANSMITTAL_TO_USER', () => {
      const flags = DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE
        .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_FOR_TRANSMITTAL_TO_USER + FLAG_HAS_URL_FOR_DOWNLOAD', () => {
      const flags = DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER
        .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createUrlDataDescriptor()]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });
  });

  describe('Three-flag combinations', () => {
    test('FLAG_HAS_REQUEST_ID + FLAG_HAS_STATEMENTS + FLAG_HAS_SIGNATURE', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS)
        .or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId(),
        statements: createTestStatements(),
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_HAS_REQUEST_ID + FLAG_FOR_USERS_SIGNATURE + FLAG_FOR_TRANSMITTAL_TO_USER', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE)
        .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('FLAG_HAS_STATEMENTS + FLAG_HAS_SIGNATURE + FLAG_HAS_URL_FOR_DOWNLOAD', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_STATEMENTS
        .or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE)
        .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createUrlDataDescriptor()],
        statements: createTestStatements(),
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });
  });

  describe('All flags combination', () => {
    test('should validate with all flags set and all data present', () => {
      const flags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS)
        .or(DataPacketRequestDetails.FLAG_HAS_SIGNATURE)
        .or(DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE)
        .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
        .or(DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD);
      
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags,
        signableObjects: [createUrlDataDescriptor()],
        requestID: createTestRequestId(),
        statements: createTestStatements(),
        signature: createTestSignatureData()
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });
  });

  describe('Comprehensive flag combinations - Loop-based (0x00 to 0x3F)', () => {
    // Generate all 64 combinations (2^6 = 64, from 0 to 63)
    const allCombinations = [];
    for (let mask = 0x00; mask <= 0x3F; mask++) {
      allCombinations.push(mask);
    }

    test.each(allCombinations)(
      'should validate and serialize flag combination 0x%s',
      (mask) => {
        // Build DataPacketRequestDetails from mask
        const details = buildDataPacketFromMask(mask);
        
        // Get flag names for debugging
        const flagNames = FLAG_DEFINITIONS
          .filter(def => mask & (1 << def.bit))
          .map(def => def.name);
        
        // Validate
        const validation = validateDataPacketRequestDetails(details);
        
        if (!validation.valid) {
          console.error(`Validation failed for mask 0x${mask.toString(16).padStart(2, '0')} (${flagNames.join(', ')})`);
          console.error('Errors:', validation.errors);
        }
        
        expect(validation.valid).toBe(true);

        // Roundtrip serialization test
        const roundtrip = testRoundtripSerialization(details);
        
        if (!roundtrip.success) {
          console.error(`Serialization failed for mask 0x${mask.toString(16).padStart(2, '0')} (${flagNames.join(', ')})`);
          console.error('Error:', roundtrip.error);
          if (roundtrip.initialHex && roundtrip.restoredHex) {
            console.error('Initial hex:', roundtrip.initialHex);
            console.error('Restored hex:', roundtrip.restoredHex);
          }
        }
        
        expect(roundtrip.success).toBe(true);
      }
    );
  });

  describe('DataPacketRequestOrdinalVDXFObject wrapper', () => {
    test('should wrap DataPacketRequestDetails in OrdinalVDXFObject', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: [createSimpleDataDescriptor()]
      });

      const ordinalObject = new DataPacketRequestOrdinalVDXFObject({ data: details });
      
      expect(ordinalObject).toBeDefined();
      expect(ordinalObject.data).toBe(details);

      // Roundtrip the wrapper
      const buffer = ordinalObject.toBuffer();
      const restored = new DataPacketRequestOrdinalVDXFObject();
      restored.fromBuffer(buffer, 0);
      
      expect(restored.data).toBeDefined();
      expect(restored.toBuffer().toString('hex')).toBe(buffer.toString('hex'));
    });

    test('should serialize and deserialize through OrdinalVDXFObject', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
          .or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS),
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId(),
        statements: createTestStatements()
      });

      const ordinalObject = new DataPacketRequestOrdinalVDXFObject({ data: details });
      
      // Serialize to buffer
      const buffer = ordinalObject.toBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Deserialize back
      const restored = new DataPacketRequestOrdinalVDXFObject();
      restored.fromBuffer(buffer, 0);
      
      expect(restored.data).toBeDefined();
      expect(restored.data.flags.toString()).toBe(details.flags.toString());

      // Full roundtrip test
      const restoredBuffer = restored.toBuffer();
      expect(restoredBuffer.toString('hex')).toBe(buffer.toString('hex'));
    });
  });

  describe('Multiple signableObjects', () => {
    test('should validate with multiple DataDescriptors', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: createMultipleDataDescriptors(5)
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);
      expect(details.signableObjects.length).toBe(5);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });

    test('should validate with URL DataDescriptor when FLAG_HAS_URL_FOR_DOWNLOAD is set', () => {
      const details = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_URL_FOR_DOWNLOAD,
        signableObjects: [createUrlDataDescriptor('https://test.com/file.json')]
      });

      const validation = validateDataPacketRequestDetails(details);
      expect(validation.valid).toBe(true);

      // Roundtrip serialization test
      const roundtrip = testRoundtripSerialization(details);
      expect(roundtrip.success).toBe(true);
    });
  });
});
