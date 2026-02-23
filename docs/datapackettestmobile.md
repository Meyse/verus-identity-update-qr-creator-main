# DataPacketRequestDetails — Mobile App Handler Specification

This document defines the structure, flags, constraints, and expected mobile-app behaviour for `DataPacketRequestDetails` objects received inside a `GenericRequest`. An AI or automated test harness can use this document to verify that every valid flag combination is handled correctly and that invalid combinations are rejected.

---

## 1. Object Overview

A data-packet request is represented by a `DataPacketRequestDetails` instance which is wrapped in a `DataPacketRequestOrdinalVDXFObject` and placed inside the `details` array of a `GenericRequest`.

```
GenericRequest
 ├─ signingId          (CompactIAddressObject – who signed the request)
 ├─ signatureData      (VerifiableSignatureData – outer signature over the whole request)
 ├─ responseURIs       (ResponseURI[] – callback/redirect URIs, optional)
 └─ details[]          (array of OrdinalVDXFObject wrappers)
      ├─ [0] AuthenticationRequestOrdinalVDXFObject   (optional, see constraints)
      └─ [n] DataPacketRequestOrdinalVDXFObject
               └─ data: DataPacketRequestDetails
                    ├─ version        (BN, must be 1)
                    ├─ flags          (BN, bitmask 0x00–0x3F)
                    ├─ signableObjects (DataDescriptor[], at least one required)
                    ├─ statements     (string[], conditional)
                    ├─ signature      (VerifiableSignatureData, conditional)
                    └─ requestID      (CompactIAddressObject, conditional)
```

---

## 2. Flags

Flags are a bitmask stored as a `BN` (big-number) value. Six flag bits are defined:

| Bit | Decimal | Hex    | Constant                           | Description |
|-----|---------|--------|------------------------------------|-------------|
| 0   | 1       | `0x01` | `FLAG_HAS_REQUEST_ID`              | A `requestID` (i-address) is embedded in this request. |
| 1   | 2       | `0x02` | `FLAG_HAS_STATEMENTS`              | One or more UTF-8 statement strings are included. |
| 2   | 4       | `0x04` | `FLAG_HAS_SIGNATURE`               | A `VerifiableSignatureData` signature is embedded inside the data-packet (distinct from the outer GenericRequest signature). |
| 3   | 8       | `0x08` | `FLAG_FOR_USERS_SIGNATURE`         | The sender is requesting the user to sign the `signableObjects` and return their signature. |
| 4   | 16      | `0x10` | `FLAG_FOR_TRANSMITTAL_TO_USER`     | The data is being transmitted **to** the user (i.e. the sender is pushing data to the recipient). |
| 5   | 32      | `0x20` | `FLAG_HAS_URL_FOR_DOWNLOAD`        | The `signableObjects` array contains a URL `DataDescriptor` pointing to downloadable data rather than inline data. |

Any combination of these six bits is valid at the serialization level (0x00 through 0x3F = 64 combinations), but additional **constraints** apply at the GenericRequest level (see Section 3).

### 2.1 Data-carrying flags (bits 0–2)

These flags **require** specific companion data to be present in the `DataPacketRequestDetails`:

| Flag                    | Required companion data | Validation rule |
|-------------------------|------------------------|-----------------|
| `FLAG_HAS_REQUEST_ID`   | `requestID` — a valid `CompactIAddressObject` (base58check i-address) | If the flag is set and `requestID` is missing or invalid → **reject**. If the flag is NOT set but `requestID` is present → **reject**. |
| `FLAG_HAS_STATEMENTS`   | `statements` — a non-empty `string[]` | If the flag is set and `statements` is missing or empty → **reject**. If the flag is NOT set but `statements` has entries → **reject**. |
| `FLAG_HAS_SIGNATURE`    | `signature` — a `VerifiableSignatureData` instance | If the flag is set and `signature` is missing → **reject**. If the flag is NOT set but `signature` is present → **reject**. |

### 2.2 Behavioural flags (bits 3–5)

These flags do **not** carry extra data inside `DataPacketRequestDetails` itself but impose constraints at the `GenericRequest` level or change how the mobile app should handle the request:

| Flag                            | Constraint / Behaviour |
|---------------------------------|------------------------|
| `FLAG_FOR_USERS_SIGNATURE`      | The `GenericRequest` **must** contain `responseURIs` (at least one callback URL) so the signed response can be returned. |
| `FLAG_FOR_TRANSMITTAL_TO_USER`  | An `AuthenticationRequestOrdinalVDXFObject` **must** precede the `DataPacketRequestOrdinalVDXFObject` in the `details` array. The auth entry carries a `RecipientConstraint` identifying the intended recipient. |
| `FLAG_HAS_URL_FOR_DOWNLOAD`     | The first (and typically only) entry in `signableObjects` must be a `DataDescriptor` wrapping a `CrossChainDataRef` → `URLRef`. The URL should include a data hash for verification. |

### 2.3 `signableObjects` always required

Regardless of which flags are set, `signableObjects` must be a non-empty `DataDescriptor[]`. If it is missing or empty the request is invalid and must be **rejected**.

---

## 3. GenericRequest-Level Constraints

The `DataPacketRequestOrdinalVDXFObject` lives inside a `GenericRequest.details[]` array. The ordering and composition of that array has rules:

1. **Authentication at index 0** — If an `AuthenticationRequestOrdinalVDXFObject` is present it **must** be at index 0.
2. **Auth required for transmittal** — If `FLAG_FOR_TRANSMITTAL_TO_USER` is set on any `DataPacketRequestDetails`, an `AuthenticationRequestOrdinalVDXFObject` **must** exist in the array and **must** come before the `DataPacketRequestOrdinalVDXFObject`. The auth entry carries a `RecipientConstraint` with `REQUIRED_ID` pointing to the recipient's i-address.
3. **responseURIs required for user-signature requests** — If `FLAG_FOR_USERS_SIGNATURE` is set, the `GenericRequest` itself must contain at least one `ResponseURI` so the wallet knows where to send the user's signature back to.
4. **Special requests at last index** — If a `VerusPayInvoiceDetailsOrdinalVDXFObject` or `IdentityUpdateRequestOrdinalVDXFObject` is also present, it must be the last element.
5. **Only one of each type** — At most one `AuthenticationRequestOrdinalVDXFObject`, one `DataPacketRequestOrdinalVDXFObject`, etc.

---

## 4. Serialization

`DataPacketRequestDetails` supports buffer serialization and deserialization:

```
toBuffer()   → Buffer       // serialize to binary
fromBuffer() → offset       // deserialize from binary
```

**Roundtrip invariant:** For every valid instance, the following must hold:

```javascript
const initial = new DataPacketRequestDetails({ ... });
const buf = initial.toBuffer();
const restored = new DataPacketRequestDetails();
restored.fromBuffer(buf, 0);
expect(restored.toBuffer().toString('hex')).toBe(buf.toString('hex'));
```

This has been verified for all 64 flag combinations (0x00 – 0x3F) in the desktop test suite.

---

## 5. Mobile App — What to Present / Do for Each Flag

When the mobile wallet receives a `GenericRequest` containing a `DataPacketRequestOrdinalVDXFObject`, it should inspect the flags and handle each as follows:

### 5.1 `FLAG_HAS_REQUEST_ID` (0x01)

**What it means:** The request has a tracking/correlation ID (an i-address).

**Mobile app should:**
- Display the `requestID` to the user (formatted as an i-address string).
- Store it for correlation when sending a response.
- No special user action required beyond acknowledgement.

### 5.2 `FLAG_HAS_STATEMENTS` (0x02)

**What it means:** The sender has included one or more human-readable statement strings (terms, conditions, context).

**Mobile app should:**
- Display each statement to the user in a scrollable list or card view.
- The user should read and acknowledge the statements before proceeding.
- Statements are plain UTF-8 strings — render them as-is (no HTML/markdown).

### 5.3 `FLAG_HAS_SIGNATURE` (0x04)

**What it means:** The `DataPacketRequestDetails` itself contains an embedded `VerifiableSignatureData` proving the sender signed the data-packet contents.

**Mobile app should:**
- Extract the `signature` field from the `DataPacketRequestDetails`.
- Verify the embedded signature against the serialized data-packet buffer using the Verus RPC `verifydata` call or equivalent local verification.
- Display the verification result to the user:
  - **Valid:** Show a green checkmark / "Signature verified" with the signer's identity.
  - **Invalid:** Show a warning / "Signature verification failed" and advise caution.
- This is the **inner** signature on the data-packet itself — it is separate from the **outer** `GenericRequest` signature which covers the whole request.

### 5.4 `FLAG_FOR_USERS_SIGNATURE` (0x08)

**What it means:** The sender is requesting that the **user signs** the `signableObjects` and returns the signature.

**Mobile app should:**
- Display the `signableObjects` data to the user for review.
- Present a clear prompt: *"[Sender] is requesting your signature on the following data."*
- If the user approves, sign the serialized `DataPacketRequestDetails` buffer using the user's identity key.
- Construct a response and send it back to the callback URL(s) found in the `GenericRequest.responseURIs`.
- **Reject if `responseURIs` is missing** — there is nowhere to send the signed response.

### 5.5 `FLAG_FOR_TRANSMITTAL_TO_USER` (0x10)

**What it means:** The sender is transmitting personal data **to** the user. The authentication entry identifies the intended recipient (via `RecipientConstraint`).

**Mobile app should:**
- Verify that the authenticated user matches the `RecipientConstraint.identity` from the preceding `AuthenticationRequestOrdinalVDXFObject`. If the user's identity does not match → **reject** the request.
- Display the transmitted data (`signableObjects`) to the user.
- **Save the data to the device** under the recipient identity's local storage / profile. This is personal data being delivered to the user.
- Confirm to the user: *"Data has been saved to your profile."*
- If `FLAG_HAS_SIGNATURE` is also set, verify the embedded signature before saving.

### 5.6 `FLAG_HAS_URL_FOR_DOWNLOAD` (0x20)

**What it means:** Instead of inline data, the `signableObjects` contains a URL pointing to downloadable content.

**Mobile app should:**
1. Extract the URL from the `signableObjects[0]` `DataDescriptor` → `CrossChainDataRef` → `URLRef`.
2. **Download** the content from the URL.
3. If the `URLRef` contains a `data_hash` (indicated by `URLRef.FLAG_HAS_HASH`):
   - Compute the SHA-256 hash of the downloaded content.
   - Compare it against the embedded `data_hash`.
   - **If the hash does not match → reject the download and warn the user.**
   - If the hash matches → proceed.
4. Display the downloaded data to the user.
5. If `FLAG_FOR_TRANSMITTAL_TO_USER` is also set, save the downloaded and verified data to the device.

---

## 6. Combined Flag Scenarios

Multiple flags can be set simultaneously. The mobile app must handle every combination. Key combined scenarios:

| Flags | Scenario | Mobile App Behaviour |
|-------|----------|---------------------|
| `0x00` | Bare data packet — no optional flags | Display `signableObjects` to user. No special actions. |
| `0x01` | Request ID only | Display `signableObjects` + show the `requestID`. |
| `0x03` | Request ID + Statements | Display data, show request ID, show statements for acknowledgement. |
| `0x07` | Request ID + Statements + Signature | Display data, show request ID, show statements, verify inner signature. |
| `0x08` | User signature requested | Display data, prompt user to sign, return signature via `responseURIs`. |
| `0x09` | User signature + Request ID | Same as `0x08` but include `requestID` in display and correlation. |
| `0x0B` | User signature + Request ID + Statements | Show statements, show request ID, request user signature. |
| `0x10` | Transmittal to user | Verify recipient identity, display and save data. |
| `0x11` | Transmittal + Request ID | Verify recipient, display data with request ID, save. |
| `0x13` | Transmittal + Request ID + Statements | Verify recipient, show statements, save data with request ID. |
| `0x14` | Transmittal + Signature | Verify recipient, verify inner signature, then save data. |
| `0x17` | Transmittal + Request ID + Statements + Signature | Full verification: check recipient, verify signature, show statements, save data. |
| `0x18` | User signature + Transmittal | Verify recipient, prompt user to sign, return via `responseURIs`, save. |
| `0x20` | URL download | Download from URL, verify hash if present, display downloaded data. |
| `0x30` | URL download + Transmittal | Download, verify hash, verify recipient, save downloaded data. |
| `0x38` | URL download + Transmittal + User signature | Download, verify hash, verify recipient, prompt signature, return via callback, save. |
| `0x3F` | All flags | Full flow: show request ID, show statements, verify inner signature, download from URL with hash check, verify recipient, prompt user signature, save data, return signature via callback. |

---

## 7. Validation Checklist for Mobile App Handler

Use this checklist to verify the mobile app correctly handles all cases:

### 7.1 Acceptance tests (should ACCEPT)

- [ ] Bare data packet (flags = `0x00`) with valid `signableObjects`
- [ ] Each single flag (0x01, 0x02, 0x04, 0x08, 0x10, 0x20) with correct companion data
- [ ] All 64 flag combinations (0x00–0x3F) with correct companion data and GenericRequest constraints met
- [ ] Multiple `signableObjects` entries
- [ ] URL `DataDescriptor` when `FLAG_HAS_URL_FOR_DOWNLOAD` is set
- [ ] `AuthenticationRequestOrdinalVDXFObject` preceding data packet when `FLAG_FOR_TRANSMITTAL_TO_USER` is set
- [ ] `responseURIs` present when `FLAG_FOR_USERS_SIGNATURE` is set

### 7.2 Rejection tests (should REJECT)

- [ ] `signableObjects` is empty or missing → reject
- [ ] `FLAG_HAS_REQUEST_ID` set but `requestID` missing → reject
- [ ] `FLAG_HAS_STATEMENTS` set but `statements` missing or empty → reject
- [ ] `FLAG_HAS_SIGNATURE` set but `signature` missing → reject
- [ ] `FLAG_FOR_USERS_SIGNATURE` set but `responseURIs` missing from `GenericRequest` → reject
- [ ] `FLAG_FOR_TRANSMITTAL_TO_USER` set but no `AuthenticationRequestOrdinalVDXFObject` in `details` → reject
- [ ] `FLAG_FOR_TRANSMITTAL_TO_USER` set but `AuthenticationRequestOrdinalVDXFObject` comes **after** the data packet in `details` → reject
- [ ] `FLAG_HAS_URL_FOR_DOWNLOAD` set but `signableObjects` does not contain a URL `DataDescriptor` → reject
- [ ] `FLAG_HAS_URL_FOR_DOWNLOAD` with hash present but downloaded content hash does not match → reject
- [ ] Recipient identity in `AuthenticationRequestOrdinalVDXFObject` does not match authenticated user → reject
- [ ] Invalid `requestID` (bad base58check encoding) → reject
- [ ] Invalid embedded `signature` (verification fails) → warn/reject

### 7.3 Edge cases

- [ ] Version must be exactly `1` (versions `0` or `> 1` are invalid)
- [ ] `FLAG_FOR_USERS_SIGNATURE` and `FLAG_FOR_TRANSMITTAL_TO_USER` can both be set simultaneously — the app must handle both (sign AND save)
- [ ] `FLAG_HAS_SIGNATURE` with `FLAG_FOR_USERS_SIGNATURE` — verify the sender's signature first, then request the user's signature
- [ ] `FLAG_HAS_URL_FOR_DOWNLOAD` with `FLAG_FOR_TRANSMITTAL_TO_USER` — download, verify hash, then save
- [ ] All six flags set (`0x3F`) — the maximum combination must be fully handled

---

## 8. Flag Bitmask Reference Table (All 64 Combinations)

For automated testing, loop from `0x00` to `0x3F` and for each mask check that:
1. The handler accepts the combination when all required companion data and GenericRequest constraints are satisfied.
2. The handler rejects the combination when any required companion data or constraint is missing.

```
Mask  Hex   REQ_ID  STMTS  SIG  USER_SIG  TRANSMIT  URL
0     0x00  -       -      -    -         -         -
1     0x01  X       -      -    -         -         -
2     0x02  -       X      -    -         -         -
3     0x03  X       X      -    -         -         -
4     0x04  -       -      X    -         -         -
5     0x05  X       -      X    -         -         -
6     0x06  -       X      X    -         -         -
7     0x07  X       X      X    -         -         -
8     0x08  -       -      -    X         -         -
9     0x09  X       -      -    X         -         -
10    0x0A  -       X      -    X         -         -
11    0x0B  X       X      -    X         -         -
12    0x0C  -       -      X    X         -         -
13    0x0D  X       -      X    X         -         -
14    0x0E  -       X      X    X         -         -
15    0x0F  X       X      X    X         -         -
16    0x10  -       -      -    -         X         -
17    0x11  X       -      -    -         X         -
18    0x12  -       X      -    -         X         -
19    0x13  X       X      -    -         X         -
20    0x14  -       -      X    -         X         -
21    0x15  X       -      X    -         X         -
22    0x16  -       X      X    -         X         -
23    0x17  X       X      X    -         X         -
24    0x18  -       -      -    X         X         -
25    0x19  X       -      -    X         X         -
26    0x1A  -       X      -    X         X         -
27    0x1B  X       X      -    X         X         -
28    0x1C  -       -      X    X         X         -
29    0x1D  X       -      X    X         X         -
30    0x1E  -       X      X    X         X         -
31    0x1F  X       X      X    X         X         -
32    0x20  -       -      -    -         -         X
33    0x21  X       -      -    -         -         X
34    0x22  -       X      -    -         -         X
35    0x23  X       X      -    -         -         X
36    0x24  -       -      X    -         -         X
37    0x25  X       -      X    -         -         X
38    0x26  -       X      X    -         -         X
39    0x27  X       X      X    -         -         X
40    0x28  -       -      -    X         -         X
41    0x29  X       -      -    X         -         X
42    0x2A  -       X      -    X         -         X
43    0x2B  X       X      -    X         -         X
44    0x2C  -       -      X    X         -         X
45    0x2D  X       -      X    X         -         X
46    0x2E  -       X      X    X         -         X
47    0x2F  X       X      X    X         -         X
48    0x30  -       -      -    -         X         X
49    0x31  X       -      -    -         X         X
50    0x32  -       X      -    -         X         X
51    0x33  X       X      -    -         X         X
52    0x34  -       -      X    -         X         X
53    0x35  X       -      X    -         X         X
54    0x36  -       X      X    -         X         X
55    0x37  X       X      X    -         X         X
56    0x38  -       -      -    X         X         X
57    0x39  X       -      -    X         X         X
58    0x3A  -       X      -    X         X         X
59    0x3B  X       X      -    X         X         X
60    0x3C  -       -      X    X         X         X
61    0x3D  X       -      X    X         X         X
62    0x3E  -       X      X    X         X         X
63    0x3F  X       X      X    X         X         X
```

Key: `X` = flag is set, `-` = flag is not set.

For each row where a flag is set, the corresponding data/constraint from Sections 2.1, 2.2, and 3 must be satisfied.

---

## 9. Summary of Mobile App Handler Rules

1. **Always** verify the outer `GenericRequest` signature first.
2. **Always** require at least one entry in `signableObjects`.
3. **For each data-carrying flag** (bits 0–2): require the matching data field; reject if missing.
4. **`FLAG_FOR_USERS_SIGNATURE`**: require `responseURIs`; prompt user to sign; return signature to callback.
5. **`FLAG_FOR_TRANSMITTAL_TO_USER`**: require preceding `AuthenticationRequestOrdinalVDXFObject` with `RecipientConstraint`; verify the user matches the recipient; save data to device.
6. **`FLAG_HAS_URL_FOR_DOWNLOAD`**: download from URL in `signableObjects`; verify hash if present; reject on hash mismatch.
7. **`FLAG_HAS_SIGNATURE`**: verify the embedded inner signature; display result to user.
8. Handle **all combinations** — flags are a bitmask and any subset of the six flags can be active simultaneously.
