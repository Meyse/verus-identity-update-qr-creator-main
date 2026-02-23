# Test Suite Documentation

This test suite provides comprehensive testing for the Verus Identity Update QR Creator application, focusing on DataPacket and GenericRequest functionality.

## Test Files

### `__tests__/fixtures.js`
Common test data and helper functions used across all test files:
- Test identity addresses (signing ID, request ID, recipient ID, system ID)
- Factory functions for creating test objects (signatures, statements, data descriptors)
- URL data descriptor creation with optional data hash
- Test redirect URIs

### `__tests__/dataPacket.test.js`
Comprehensive tests for `DataPacketRequestDetails` and `DataPacketRequestOrdinalVDXFObject`:

#### Flag Combinations Tested
The test suite validates all 64 possible combinations (2^6) of the following flags:
- `FLAG_HAS_REQUEST_ID` (1) - Must have requestID data when set
- `FLAG_HAS_STATEMENTS` (2) - Must have statements array when set
- `FLAG_HAS_SIGNATURE` (4) - Must have signature data when set
- `FLAG_FOR_USERS_SIGNATURE` (8) - Independent (GenericRequest validates returnurl requirement)
- `FLAG_FOR_TRANSMITTAL_TO_USER` (16) - Independent (GenericRequest validates auth presence)
- `FLAG_HAS_URL_FOR_DOWNLOAD` (32) - Independent

#### Test Categories
1. **Basic flag validation** - Individual flag tests with and without required data
2. **Two-flag combinations** - Common paired flag scenarios
3. **Three-flag combinations** - Complex multi-flag scenarios
4. **All flags combination** - Tests with all flags enabled
5. **Comprehensive flag combination tests** - Automated testing of all 64 combinations
6. **DataPacketRequestOrdinalVDXFObject wrapper** - Serialization/deserialization tests
7. **Multiple signableObjects** - Tests with multiple DataDescriptors

#### Validation Function
`validateDataPacketRequestDetails(details)` - Custom validation ensuring:
- Flags match data presence
- Required fields exist when flags are set
- signableObjects is always present and non-empty

### `__tests__/genericRequest.test.js`
Tests for `GenericRequest` validation and the `isValidGenericRequestDetails` function:

#### Rules Validated
1. **Details array must be valid array type**
2. **Authentication position**: Must be at index 0 if present
3. **Special requests position**: VerusPay/IdentityUpdate must be at last index if present
4. **Provisioning constraint**: Must come after authentication if both present
5. **AppEncryption constraint**: Must come after authentication if both present
6. **No duplicate request types**: Only one of each type allowed

#### DataPacket Constraints in GenericRequest
1. **FLAG_FOR_USERS_SIGNATURE**: Requires `responseURIs` (returnurl) in GenericRequest
2. **FLAG_FOR_TRANSMITTAL_TO_USER**: Requires `AuthenticationRequestOrdinalVDXFObject` to precede the DataPacket

#### Test Categories
1. **Basic validation** - Array type checks, single request tests
2. **Authentication position rules** - Index validation
3. **Provisioning rules** - Ordering validation
4. **DataPacket constraints** - FLAG_FOR_USERS_SIGNATURE and FLAG_FOR_TRANSMITTAL_TO_USER
5. **Complete GenericRequest validation** - Integration tests
6. **Serialization/deserialization** - Buffer conversion tests

## Running Tests

```bash
# Install dependencies first
yarn install

# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage report
yarn test:coverage
```

## Test Output Example

The tests use Jest's describe/test structure for clear organization:
```
DataPacketRequestDetails - Flag Combinations
  ✓ Basic flag validation (15 tests)
  ✓ Two-flag combinations (5 tests)
  ✓ Three-flag combinations (3 tests)
  ✓ All flags combination (1 test)
  ✓ Comprehensive flag combination tests (64 tests)
  ✓ DataPacketRequestOrdinalVDXFObject wrapper (2 tests)
  ✓ Multiple signableObjects (2 tests)

GenericRequest - isValidGenericRequestDetails
  ✓ Basic validation (4 tests)
  ✓ Authentication position rules (3 tests)
  ✓ DataPacket constraints in GenericRequest (3 tests)
  ✓ Complete GenericRequest validation (2 tests)
  ✓ Serialization and deserialization (1 test)
```

## Key Testing Principles

1. **Comprehensive Coverage**: All flag combinations are tested systematically
2. **Validation Functions**: Custom validators mirror the application logic
3. **Real Objects**: Tests use actual Verus primitives, not mocks
4. **Error Detection**: Invalid combinations are explicitly tested
5. **Integration**: Tests verify interaction between DataPacket and GenericRequest

## Adding New Tests

When adding new test cases:
1. Use fixtures from `fixtures.js` for consistent test data
2. Follow the existing describe/test structure
3. Test both valid and invalid scenarios
4. Update this README with new test categories

## Notes

- Tests use `verus-typescript-primitives` directly, ensuring compatibility with actual library behavior
- Flag validation matches the constraints documented in the application
- The comprehensive flag combination tests automatically generate and test all 64 possible flag states
- GenericRequest validation tests replicate the behavior of `VerusIdInterface.isValidGenericRequestDetails()`
