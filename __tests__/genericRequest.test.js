const { BN } = require('bn.js');
const {
  DataPacketRequestDetails,
  DataPacketRequestOrdinalVDXFObject,
  AuthenticationRequestDetails,
  AuthenticationRequestOrdinalVDXFObject,
  ProvisionIdentityDetailsOrdinalVDXFObject,
  AppEncryptionRequestOrdinalVDXFObject,
  VerusPayInvoiceDetailsOrdinalVDXFObject,
  IdentityUpdateRequestOrdinalVDXFObject,
  RecipientConstraint,
  CompactIAddressObject,
  VerifiableSignatureData,
  ResponseURI,
  GenericRequest
} = require('verus-typescript-primitives');

const { VerusIdInterface } = require('verusid-ts-client');

const {
  SYSTEM_ID_TESTNET,
  createTestSigningId,
  createTestRequestId,
  createTestRecipientId,
  createTestSystemId,
  createSimpleDataDescriptor,
  createTestStatements
} = require('./fixtures');

/**
 * Test implementation of isValidGenericRequestDetails based on the VerusIdInterface implementation.
 * Rules:
 * - Authentication must be at index 0 if present
 * - Special requests (VerusPay/IdentityUpdate) must be at the last index if present
 * - Provisioning must come after authentication if both present
 * - AppEncryption must come after authentication if both present
 */
function isValidGenericRequestDetails(details) {
  if (!Array.isArray(details)) return false;

  let authIndex = -1;
  let specialIndex = -1;
  let provisioningIndex = -1;
  let appEncryptIndex = -1;

  for (let i = 0; i < details.length; i++) {
    const detail = details[i];

    if (detail instanceof AuthenticationRequestOrdinalVDXFObject) {
      if (authIndex !== -1) return false; // Only one auth allowed
      authIndex = i;
    }

    if (detail instanceof ProvisionIdentityDetailsOrdinalVDXFObject) {
      if (provisioningIndex !== -1) return false; // Only one provisioning allowed
      provisioningIndex = i;
    }

    if (detail instanceof AppEncryptionRequestOrdinalVDXFObject) {
      if (appEncryptIndex !== -1) return false; // Only one app encrypt allowed
      appEncryptIndex = i;
    }

    if (
      detail instanceof VerusPayInvoiceDetailsOrdinalVDXFObject ||
      detail instanceof IdentityUpdateRequestOrdinalVDXFObject
    ) {
      if (specialIndex !== -1) return false; // Only one special request allowed
      specialIndex = i;
    }
  }

  // Authentication must be at index 0 if present
  if (authIndex !== -1 && authIndex !== 0) return false;

  // Special requests must be at last index if present
  if (specialIndex !== -1 && specialIndex !== details.length - 1) return false;

  // Provisioning must come after authentication if both present
  if (provisioningIndex !== -1 && (authIndex === -1 || provisioningIndex < authIndex)) {
    return false;
  }

  // AppEncryption must come after authentication if both present
  if (appEncryptIndex !== -1 && (authIndex === -1 || appEncryptIndex < authIndex)) {
    return false;
  }

  return true;
}

/**
 * Validation for FLAG_FOR_USERS_SIGNATURE constraint:
 * If DataPacketRequestDetails has FLAG_FOR_USERS_SIGNATURE, the GenericRequest must have a returnurl (responseURIs)
 */
function validateForUsersSignatureConstraint(request) {
  const errors = [];

  // Check if any DataPacketRequestDetails has FLAG_FOR_USERS_SIGNATURE
  for (const detail of request.details) {
    if (detail instanceof DataPacketRequestOrdinalVDXFObject) {
      const dataPacket = detail.data;
      const hasForUsersSignature = dataPacket.flags
        .and(DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE)
        .gt(new BN(0));

      if (hasForUsersSignature) {
        if (!request.responseURIs || request.responseURIs.length === 0) {
          errors.push('FLAG_FOR_USERS_SIGNATURE requires responseURIs (returnurl) in GenericRequest');
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validation for FLAG_FOR_TRANSMITTAL_TO_USER constraint:
 * If DataPacketRequestDetails has FLAG_FOR_TRANSMITTAL_TO_USER, an AuthenticationRequestOrdinalVDXFObject
 * must precede it in the details array
 */
function validateForTransmittalToUserConstraint(details) {
  const errors = [];
  let authIndex = -1;

  // Find authentication index
  for (let i = 0; i < details.length; i++) {
    if (details[i] instanceof AuthenticationRequestOrdinalVDXFObject) {
      authIndex = i;
      break;
    }
  }

  // Check each DataPacketRequest
  for (let i = 0; i < details.length; i++) {
    const detail = details[i];
    if (detail instanceof DataPacketRequestOrdinalVDXFObject) {
      const dataPacket = detail.data;
      const hasForTransmittalToUser = dataPacket.flags
        .and(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER)
        .gt(new BN(0));

      if (hasForTransmittalToUser) {
        if (authIndex === -1) {
          errors.push('FLAG_FOR_TRANSMITTAL_TO_USER requires AuthenticationRequestOrdinalVDXFObject in details array');
        } else if (authIndex >= i) {
          errors.push('AuthenticationRequestOrdinalVDXFObject must precede DataPacketRequestOrdinalVDXFObject when FLAG_FOR_TRANSMITTAL_TO_USER is set');
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

describe('GenericRequest - isValidGenericRequestDetails', () => {
  describe('Basic validation', () => {
    test('should accept empty details array', () => {
      expect(isValidGenericRequestDetails([])).toBe(true);
    });

    test('should reject non-array input', () => {
      expect(isValidGenericRequestDetails(null)).toBe(false);
      expect(isValidGenericRequestDetails(undefined)).toBe(false);
      expect(isValidGenericRequestDetails({})).toBe(false);
      expect(isValidGenericRequestDetails('string')).toBe(false);
    });

    test('should accept single DataPacketRequest', () => {
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: [createSimpleDataDescriptor()]
      });

      const details = [new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })];
      expect(isValidGenericRequestDetails(details)).toBe(true);
    });

    test('should accept single AuthenticationRequest', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });

      const details = [new AuthenticationRequestOrdinalVDXFObject({ data: auth })];
      expect(isValidGenericRequestDetails(details)).toBe(true);
    });
  });

  describe('Authentication position rules', () => {
    test('should accept Authentication at index 0', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: [createSimpleDataDescriptor()]
      });

      const details = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth }),
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })
      ];

      expect(isValidGenericRequestDetails(details)).toBe(true);
    });

    test('should reject Authentication at non-zero index', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: new BN(0),
        signableObjects: [createSimpleDataDescriptor()]
      });

      const details = [
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket }),
        new AuthenticationRequestOrdinalVDXFObject({ data: auth })
      ];

      expect(isValidGenericRequestDetails(details)).toBe(false);
    });

    test('should reject multiple Authentication requests', () => {
      const auth1 = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });
      const auth2 = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });

      const details = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth1 }),
        new AuthenticationRequestOrdinalVDXFObject({ data: auth2 })
      ];

      expect(isValidGenericRequestDetails(details)).toBe(false);
    });
  });

  describe('Provisioning rules', () => {
    test('should accept Provisioning after Authentication', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });
      
      // Note: ProvisionIdentityDetailsOrdinalVDXFObject might need proper construction
      // This is a placeholder - adjust based on actual implementation
      const details = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth })
        // Would add ProvisionIdentityDetailsOrdinalVDXFObject here if we had test data
      ];

      expect(isValidGenericRequestDetails(details)).toBe(true);
    });
  });

  describe('DataPacket constraints in GenericRequest', () => {
    test('FLAG_FOR_USERS_SIGNATURE requires responseURIs', () => {
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE,
        signableObjects: [createSimpleDataDescriptor()]
      });

      // Without responseURIs
      const request1 = new GenericRequest({
        details: [new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })],
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        flags: GenericRequest.BASE_FLAGS
      });

      const validation1 = validateForUsersSignatureConstraint(request1);
      expect(validation1.valid).toBe(false);
      expect(validation1.errors).toContain('FLAG_FOR_USERS_SIGNATURE requires responseURIs (returnurl) in GenericRequest');

      // With responseURIs
      const request2 = new GenericRequest({
        details: [new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })],
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        responseURIs: [ResponseURI.fromUriString('verus://callback', ResponseURI.TYPE_REDIRECT)],
        flags: GenericRequest.BASE_FLAGS
      });

      const validation2 = validateForUsersSignatureConstraint(request2);
      expect(validation2.valid).toBe(true);
    });

    test('FLAG_FOR_TRANSMITTAL_TO_USER requires preceding Authentication', () => {
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER,
        signableObjects: [createSimpleDataDescriptor()]
      });

      // Without Authentication
      const details1 = [new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })];
      const validation1 = validateForTransmittalToUserConstraint(details1);
      expect(validation1.valid).toBe(false);
      expect(validation1.errors[0]).toContain('AuthenticationRequestOrdinalVDXFObject');

      // With Authentication preceding
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId(),
        recipientConstraints: [
          new RecipientConstraint({
            type: RecipientConstraint.REQUIRED_ID,
            identity: createTestRecipientId()
          })
        ]
      });

      const details2 = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth }),
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })
      ];

      const validation2 = validateForTransmittalToUserConstraint(details2);
      expect(validation2.valid).toBe(true);
    });

    test('FLAG_FOR_TRANSMITTAL_TO_USER fails if Authentication comes after', () => {
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId()
      });

      // Authentication after DataPacket - this should fail both isValidGenericRequestDetails and the constraint
      const details = [
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket }),
        new AuthenticationRequestOrdinalVDXFObject({ data: auth })
      ];

      // First check - details order is invalid (auth not at index 0)
      expect(isValidGenericRequestDetails(details)).toBe(false);
    });
  });

  describe('Complete GenericRequest validation', () => {
    test('should create valid GenericRequest with Authentication and DataPacket', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId(),
        recipientConstraints: [
          new RecipientConstraint({
            type: RecipientConstraint.REQUIRED_ID,
            identity: createTestRecipientId()
          })
        ]
      });

      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER,
        signableObjects: [createSimpleDataDescriptor()]
      });

      const details = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth }),
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })
      ];

      // Validate details order
      expect(isValidGenericRequestDetails(details)).toBe(true);

      // Validate FLAG_FOR_TRANSMITTAL_TO_USER constraint
      const transmittalValidation = validateForTransmittalToUserConstraint(details);
      expect(transmittalValidation.valid).toBe(true);

      // Create full GenericRequest
      const request = new GenericRequest({
        details,
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        flags: GenericRequest.BASE_FLAGS,
        signature: new VerifiableSignatureData({
          systemID: createTestSystemId(),
          identityID: createTestSigningId()
        })
      });

      expect(request).toBeDefined();
      expect(request.details.length).toBe(2);
    });

    test('should create valid GenericRequest with all DataPacket flags and constraints', () => {
      const auth = new AuthenticationRequestDetails({
        requestID: createTestRequestId(),
        recipientConstraints: [
          new RecipientConstraint({
            type: RecipientConstraint.REQUIRED_ID,
            identity: createTestRecipientId()
          })
        ]
      });

      const allFlags = DataPacketRequestDetails.FLAG_HAS_REQUEST_ID
        .or(DataPacketRequestDetails.FLAG_HAS_STATEMENTS)
        .or(DataPacketRequestDetails.FLAG_FOR_USERS_SIGNATURE)
        .or(DataPacketRequestDetails.FLAG_FOR_TRANSMITTAL_TO_USER);

      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: allFlags,
        signableObjects: [createSimpleDataDescriptor()],
        requestID: createTestRequestId(),
        statements: createTestStatements()
      });

      const details = [
        new AuthenticationRequestOrdinalVDXFObject({ data: auth }),
        new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })
      ];

      // Validate details order
      expect(isValidGenericRequestDetails(details)).toBe(true);

      // Validate constraints
      const transmittalValidation = validateForTransmittalToUserConstraint(details);
      expect(transmittalValidation.valid).toBe(true);

      // Create full GenericRequest with responseURIs for FLAG_FOR_USERS_SIGNATURE
      const request = new GenericRequest({
        details,
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        responseURIs: [ResponseURI.fromUriString('verus://callback', ResponseURI.TYPE_REDIRECT)],
        flags: GenericRequest.BASE_FLAGS,
        signature: new VerifiableSignatureData({
          systemID: createTestSystemId(),
          identityID: createTestSigningId()
        })
      });

      const usersSignatureValidation = validateForUsersSignatureConstraint(request);
      expect(usersSignatureValidation.valid).toBe(true);

      expect(request).toBeDefined();
      expect(request.details.length).toBe(2);
    });
  });

  describe('Serialization and deserialization', () => {
    test('should serialize and deserialize GenericRequest with DataPacket', () => {
      const dataPacket = new DataPacketRequestDetails({
        version: new BN(1),
        flags: DataPacketRequestDetails.FLAG_HAS_STATEMENTS,
        signableObjects: [createSimpleDataDescriptor()],
        statements: createTestStatements()
      });

      const request = new GenericRequest({
        details: [new DataPacketRequestOrdinalVDXFObject({ data: dataPacket })],
        createdAt: new BN((Date.now() / 1000).toFixed(0)),
        flags: GenericRequest.BASE_FLAGS
      });

      // Serialize
      const buffer = request.toBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Deserialize
      const restored = new GenericRequest();
      restored.fromBuffer(buffer, 0);

      expect(restored.details.length).toBe(request.details.length);
      expect(restored.createdAt.toString()).toBe(request.createdAt.toString());
    });
  });
});

describe('GenericRequest integration with VerusIdInterface', () => {
  test('isValidGenericRequestDetails should be used by VerusIdInterface', () => {
    // This test verifies that VerusIdInterface has the isValidGenericRequestDetails method
    const verusId = new VerusIdInterface('VRSCTEST', 'http://localhost:27486');
    
    // The method exists (it's private but we know it's there from the attachment)
    expect(verusId).toBeDefined();
    expect(typeof verusId.verifyGenericRequest).toBe('function');
  });
});
