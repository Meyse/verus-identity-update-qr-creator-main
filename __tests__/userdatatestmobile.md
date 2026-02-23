# UserDataRequestDetails — Mobile App Handler Specification

This document defines the structure, flags, types, constraints, and expected mobile-app behaviour for `UserDataRequestDetails` objects received inside a `GenericRequest`. An AI or automated test harness can use this document to verify that every valid combination is handled correctly and that invalid combinations are rejected.

---

## 1. Object Overview

A user-data request is represented by a `UserDataRequestDetails` instance which is wrapped in a `UserDataRequestOrdinalVDXFObject` and placed inside the `details` array of a `GenericRequest`.

**IMPORTANT:** A `UserDataRequestOrdinalVDXFObject` must **always** be accompanied by an `AuthenticationRequestOrdinalVDXFObject` in the `GenericRequest.details` array. Without authentication there is no verified identity to look up data for, and no callback/recipient to return data to. The `AuthenticationRequestOrdinalVDXFObject` must come **before** the `UserDataRequestOrdinalVDXFObject` (at index 0). The mobile app should process the authentication first, then skip to presenting the user-data request handler.

```
GenericRequest
 ├─ signingId          (CompactIAddressObject – who signed the request)
 ├─ signatureData      (VerifiableSignatureData – outer signature)
 ├─ responseURIs       (ResponseURI[] – callback URIs for returning data)
 └─ details[]
      ├─ [0] AuthenticationRequestOrdinalVDXFObject  (REQUIRED)
      │        └─ data: AuthenticationRequestDetails
      │              ├─ requestID
      │              └─ recipientConstraints
      └─ [1] UserDataRequestOrdinalVDXFObject
               └─ data: UserDataRequestDetails
                    ├─ version        (BN, must be 1)
                    ├─ flags          (BN, bitmask 0x0–0x7)
                    ├─ dataType       (BN, varuint: 1, 2, or 3)
                    ├─ requestType    (BN, varuint: 1, 2, or 3)
                    ├─ searchDataKey  (Array<{vdxfKey: value}>, always required)
                    ├─ signer         (CompactIAddressObject, conditional)
                    ├─ requestedKeys  (string[], conditional)
                    └─ requestID      (CompactIAddressObject, conditional)
```

---

## 2. Flags (Bitmask)

Flags control **optional fields only**. There are 3 flag bits → 8 combinations (0x0–0x7):

| Bit | Decimal | Hex    | Constant                    | Description |
|-----|---------|--------|-----------------------------|-------------|
| 0   | 1       | `0x01` | `FLAG_HAS_REQUEST_ID`       | A tracking/correlation `requestID` (i-address) is embedded. |
| 1   | 2       | `0x02` | `FLAG_HAS_SIGNER`           | A `signer` identity is specified — the server wants data signed by this specific identity. |
| 2   | 4       | `0x04` | `FLAG_HAS_REQUESTED_KEYS`   | Specific VDXF keys are listed in `requestedKeys` — used with `PARTIAL_DATA`. |

### 2.1 Flag → Data Requirements

| Flag                      | Required companion data | Rule |
|---------------------------|------------------------|------|
| `FLAG_HAS_REQUEST_ID`     | `requestID` — valid `CompactIAddressObject` | If set, `requestID` must be present. If not set, `requestID` must be absent. |
| `FLAG_HAS_SIGNER`         | `signer` — valid `CompactIAddressObject` | If set, `signer` must be present. If not set, `signer` must be absent. |
| `FLAG_HAS_REQUESTED_KEYS` | `requestedKeys` — non-empty `string[]` of VDXF key addresses | If set, `requestedKeys` must be present and non-empty. If not set, `requestedKeys` must be absent. |

---

## 3. Data Types (varuint — exactly one must be set)

`dataType` is a varuint (not a flag bit). Exactly one value must be chosen:

| Value | Constant        | Description |
|-------|-----------------|-------------|
| 1     | `FULL_DATA`     | Request the **complete** data object matching the `searchDataKey`. The entire signed object is returned to the requesting server. |
| 2     | `PARTIAL_DATA`  | Request **specific fields** from the data object. Only the keys listed in `requestedKeys` are returned as full objects; remaining fields are returned as MMR hashes for privacy. |
| 3     | `COLLECTION`    | Request **multiple** data objects. Each entry in `searchDataKey` identifies a separate object to return. All matching objects are returned in the response. |

### 3.1 dataType Constraints

| dataType       | `searchDataKey` | `requestedKeys` (FLAG_HAS_REQUESTED_KEYS) |
|----------------|-----------------|-------------------------------------------|
| `FULL_DATA`    | Required (1+ entries, each with key and value) | **Not used** — must be absent |
| `PARTIAL_DATA` | Required (1+ entries, each with key and value) | **Required** — must be present (flag bit 2 must be set) |
| `COLLECTION`   | Required (1+ entries, value can be empty `""`) | **Forbidden** — must be absent (flag bit 2 must NOT be set) |

---

## 4. Request Types (varuint — exactly one must be set)

`requestType` is a varuint (not a flag bit). Exactly one value must be chosen:

| Value | Constant      | Description |
|-------|---------------|-------------|
| 1     | `ATTESTATION` | Requesting a third-party attestation (signed statement about the user by another identity). |
| 2     | `CLAIM`       | Requesting a self-asserted claim (data the user themselves has published). |
| 3     | `CREDENTIAL`  | Requesting a verifiable credential (structured, cryptographically verifiable data). |

All three are valid with any `dataType`. Exactly one must be selected — values 0 or ≥4 are invalid.

---

## 5. `searchDataKey` — Always Required

`searchDataKey` is an array of objects, each mapping a VDXF key (i-address) to a human-readable label/value:

```javascript
searchDataKey: [
  { "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Attestation Name" },  // vrsc::attestation.name
  { "i3bgiLuaxTr6smF8q6xLG4jvvhF1mmrkM2": "Employment at Acme" } // valu.vrsc::claims.employment
]
```

- Each key is a base58check i-address representing a VDXF key.
- Each value is a UTF-8 string label (can be empty `""` for COLLECTION lookups).
- Must have **at least one entry** — empty `searchDataKey` is invalid.
- For `COLLECTION`, multiple entries identify all the objects to return.
- For `FULL_DATA` / `PARTIAL_DATA`, typically one entry identifying the specific object.

---

## 6. `requestedKeys` — PARTIAL_DATA Only

When `dataType = PARTIAL_DATA`, the `requestedKeys` array lists the specific VDXF keys whose values should be returned in full:

```javascript
requestedKeys: [
  "iAXYYrZaipc4DAmAKXUFYZxavsf6uBJqaj",  // vrsc::identity.over21
  "iJ4pq4DCymfbu8SAuXyNhasLeSHFNKPr23"   // vrsc::identity.email
]
```

- Each entry is a base58check i-address (VDXF key).
- Only these keys will have their full data returned.
- All other keys in the object will be returned as hashes in the MMR descriptor.
- The response includes the MMR descriptor root and the signature data stored with the object, allowing the server to verify the partial disclosure is authentic.

---

## 7. GenericRequest-Level Constraints

1. **Authentication REQUIRED** — A `UserDataRequestOrdinalVDXFObject` must **always** be preceded by an `AuthenticationRequestOrdinalVDXFObject` at index 0 in the `details` array. Without it, there is no verified identity to look up data for and no callback.
2. **responseURIs** — The `GenericRequest` should contain `responseURIs` so the mobile app knows where to send the user's data back.
3. **Ordering** — `AuthenticationRequestOrdinalVDXFObject` at index 0, `UserDataRequestOrdinalVDXFObject` at index 1.
4. **Mobile flow** — When the mobile app detects an `AuthenticationRequestOrdinalVDXFObject` followed by a `UserDataRequestOrdinalVDXFObject`, it should process authentication first (verify identity), then present the user-data request UI to the user. The auth handler should recognise the presence of a `UserDataRequestOrdinalVDXFObject` and delegate to the user-data handler.

---

## 8. Mobile App — What to Present / Do

### 8.1 General Flow

1. **Verify outer signature** on the `GenericRequest`.
2. **Process authentication** from the `AuthenticationRequestOrdinalVDXFObject`.
3. **Extract** the `UserDataRequestDetails` from the `UserDataRequestOrdinalVDXFObject`.
4. **Validate** version, flags, dataType, requestType, searchDataKey (see Section 10).
5. **Present** the request to the user based on dataType and flags.
6. **On approval**, construct the response and send it back via `responseURIs`.

### 8.2 Display by `dataType`

#### `FULL_DATA` (value = 1)

**What it means:** The server is requesting the **entire** data object identified by `searchDataKey`.

**Mobile app should:**
- Look up the data object on the device matching the `searchDataKey` VDXF key(s).
- Display the object's full contents to the user.
- **Show a clear warning:** *"The requesting application wants to receive ALL data in this object. Review the contents carefully before approving."*
- If `FLAG_HAS_SIGNER` is set, verify the stored data was signed by the specified `signer` identity. If the signer does not match → warn the user or reject.
- On approval, return the complete data object in the `GenericResponse`.

#### `PARTIAL_DATA` (value = 2)

**What it means:** The server is requesting only **specific fields** from the data object. This is the privacy-preserving option.

**Mobile app should:**
- Look up the data object on the device matching `searchDataKey`.
- Display **only** the fields listed in `requestedKeys` to the user.
- Show which fields will be shared vs. which will be sent as hashes.
- *"The requesting application wants only the following fields: [list requestedKeys labels]. Other fields will be sent as cryptographic hashes only."*
- If `FLAG_HAS_SIGNER` is set, verify the signer matches.
- On approval, return:
  - Full data for the `requestedKeys` fields.
  - MMR hashes for all other fields.
  - The MMR descriptor root.
  - The `VerifiableSignatureData` stored with the object on the phone.

#### `COLLECTION` (value = 3)

**What it means:** The server is requesting **multiple** data objects — one for each entry in `searchDataKey`.

**Mobile app should:**
- For each entry in `searchDataKey`, look up the matching data object(s) on the device.
- Display a list of all objects that will be returned.
- *"The requesting application wants [N] data objects. Review each before approving."*
- `requestedKeys` is **not used** with COLLECTION — if present, reject.
- On approval, return all matching objects in the `GenericResponse` `DataDescriptor`.

### 8.3 Display by Flags

#### `FLAG_HAS_REQUEST_ID` (0x01)

- Display the `requestID` as a reference/tracking identifier.
- Include it in the response for correlation.
- No special user action required.

#### `FLAG_HAS_SIGNER` (0x02)

- The server is requesting data that was signed by a **specific identity** (`signer`).
- Display the signer's identity to the user: *"Data signed by: [signer address]"*.
- When looking up data on the device, filter to objects signed by this identity.
- If no matching signed data is found → inform the user: *"No data signed by [signer] was found."*

#### `FLAG_HAS_REQUESTED_KEYS` (0x04)

- Only valid with `PARTIAL_DATA`.
- Display the list of requested keys to the user so they can see exactly which fields will be shared.
- If this flag is set with `FULL_DATA` or `COLLECTION` → reject as invalid.

### 8.4 `requestType` Display

| requestType   | Display to User |
|---------------|-----------------|
| `ATTESTATION` | *"Requesting an attestation (third-party signed statement about you)"* |
| `CLAIM`       | *"Requesting a claim (your self-asserted data)"* |
| `CREDENTIAL`  | *"Requesting a verifiable credential"* |

---

## 9. Combined Scenarios (Real-World Examples)

### 9.1 Full KYC Attestation Request

```
dataType:      FULL_DATA (1)
requestType:   ATTESTATION (1)
searchDataKey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Valu Proof of Humanity" }]
signer:        "iKjrTCwoPFRk44fAi2nYNbPG16ZUQjv1NB" (Valu Attestations)
flags:         0x02 (FLAG_HAS_SIGNER)
```

**Mobile:** Look up the "Valu Proof of Humanity" attestation signed by the Valu identity. Show all data. Warn user all data will be sent. On approval, return full object.

### 9.2 Partial Credential (Age + Email Only)

```
dataType:      PARTIAL_DATA (2)
requestType:   CREDENTIAL (3)
searchDataKey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Valu Proof of Humanity" }]
signer:        "iKjrTCwoPFRk44fAi2nYNbPG16ZUQjv1NB"
requestedKeys: ["iAXYYrZaipc4DAmAKXUFYZxavsf6uBJqaj", "iJ4pq4DCymfbu8SAuXyNhasLeSHFNKPr23"]
flags:         0x06 (FLAG_HAS_SIGNER | FLAG_HAS_REQUESTED_KEYS)
```

**Mobile:** Look up the credential. Show only "over21" and "email" fields. All other fields will be MMR hashes. Warn user which specific fields are being shared. On approval, return partial data with MMR proof.

### 9.3 Collection of Employment Claims

```
dataType:      COLLECTION (3)
requestType:   CLAIM (2)
searchDataKey: [{ "i3bgiLuaxTr6smF8q6xLG4jvvhF1mmrkM2": "" }]
signer:        "iKjrTCwoPFRk44fAi2nYNbPG16ZUQjv1NB"
flags:         0x02 (FLAG_HAS_SIGNER)
```

**Mobile:** Find all employment claim objects signed by the specified identity. Show the list. On approval, return all matching objects.

### 9.4 Full Attestation with Request ID

```
dataType:      FULL_DATA (1)
requestType:   ATTESTATION (1)
searchDataKey: [{ "iEEjVkvM9Niz4u2WCr6QQzx1zpVSvDFub1": "Attestation Name" }]
signer:        "iKjrTCwoPFRk44fAi2nYNbPG16ZUQjv1NB"
requestID:     "iD4CrjbJBZmwEZQ4bCWgbHx9tBHGP9mdSQ"
flags:         0x03 (FLAG_HAS_REQUEST_ID | FLAG_HAS_SIGNER)
```

**Mobile:** Show request ID for reference. Look up attestation by signer. Display full data. On approval, return with request ID in response.

---

## 10. Validation Checklist for Mobile App Handler

### 10.1 Acceptance Tests (should ACCEPT)

- [ ] Bare minimum: no flags, FULL_DATA, any requestType, valid searchDataKey
- [ ] Each flag individually with correct companion data
- [ ] All 8 flag combinations (0x0–0x7) when constraints are met
- [ ] All 3 dataTypes with valid companion data
- [ ] All 3 requestTypes
- [ ] All 72 valid combinations (8 flags × 3 dataTypes × 3 requestTypes) adjusted for constraints
- [ ] PARTIAL_DATA with FLAG_HAS_REQUESTED_KEYS and valid requestedKeys
- [ ] COLLECTION with multiple searchDataKey entries
- [ ] UserDataRequestOrdinalVDXFObject preceded by AuthenticationRequestOrdinalVDXFObject

### 10.2 Rejection Tests (should REJECT)

- [ ] `searchDataKey` is empty or missing → reject
- [ ] `FLAG_HAS_REQUEST_ID` set but `requestID` missing → reject
- [ ] `FLAG_HAS_SIGNER` set but `signer` missing → reject
- [ ] `FLAG_HAS_REQUESTED_KEYS` set but `requestedKeys` missing or empty → reject
- [ ] `PARTIAL_DATA` without `requestedKeys` → reject
- [ ] `COLLECTION` with `requestedKeys` present → reject
- [ ] `dataType` is 0 or ≥ 4 → reject
- [ ] `requestType` is 0 or ≥ 4 → reject
- [ ] Version is 0 or > 1 → reject
- [ ] `UserDataRequestOrdinalVDXFObject` without preceding `AuthenticationRequestOrdinalVDXFObject` → reject
- [ ] No `responseURIs` in GenericRequest → reject (nowhere to send data back)
- [ ] `FLAG_HAS_REQUESTED_KEYS` set with `FULL_DATA` or `COLLECTION` → reject

### 10.3 Edge Cases

- [ ] `searchDataKey` value can be empty string `""` (valid for COLLECTION lookups)
- [ ] `signer` identity not found on device → inform user, do not crash
- [ ] No matching data found on device for `searchDataKey` → inform user gracefully
- [ ] Multiple entries in `searchDataKey` with `FULL_DATA` (unusual but serialization-valid)

---

## 11. Flag Bitmask Reference Table (All 8 Combinations)

```
Mask  Hex   REQ_ID  SIGNER  REQ_KEYS
0     0x0   -       -       -
1     0x1   X       -       -
2     0x2   -       X       -
3     0x3   X       X       -
4     0x4   -       -       X
5     0x5   X       -       X
6     0x6   -       X       X
7     0x7   X       X       X
```

Key: `X` = flag is set, `-` = flag is not set.

**Cross-reference with dataType:**

- Masks 0x4, 0x5, 0x6, 0x7 (FLAG_HAS_REQUESTED_KEYS set) are only valid with `PARTIAL_DATA`.
- Masks 0x0, 0x1, 0x2, 0x3 (FLAG_HAS_REQUESTED_KEYS not set) are valid with `FULL_DATA` or `COLLECTION`.
- For `PARTIAL_DATA`: masks must include bit 2 (0x4–0x7). Masks 0x0–0x3 without requestedKeys are invalid for PARTIAL_DATA.

---

## 12. Full Combination Matrix

For automated testing, iterate over all valid combinations:

| # | Mask | dataType     | requestType  | Valid? | Notes |
|---|------|-------------|--------------|--------|-------|
|   | 0x0  | FULL_DATA    | ATTESTATION  | YES    | Bare minimum |
|   | 0x0  | FULL_DATA    | CLAIM        | YES    | |
|   | 0x0  | FULL_DATA    | CREDENTIAL   | YES    | |
|   | 0x0  | PARTIAL_DATA | *            | **NO** | Missing requestedKeys |
|   | 0x0  | COLLECTION   | *            | YES    | |
|   | 0x1  | FULL_DATA    | *            | YES    | + requestID |
|   | 0x1  | PARTIAL_DATA | *            | **NO** | Missing requestedKeys |
|   | 0x1  | COLLECTION   | *            | YES    | + requestID |
|   | 0x2  | FULL_DATA    | *            | YES    | + signer |
|   | 0x2  | PARTIAL_DATA | *            | **NO** | Missing requestedKeys |
|   | 0x2  | COLLECTION   | *            | YES    | + signer |
|   | 0x3  | FULL_DATA    | *            | YES    | + requestID + signer |
|   | 0x3  | PARTIAL_DATA | *            | **NO** | Missing requestedKeys |
|   | 0x3  | COLLECTION   | *            | YES    | + requestID + signer |
|   | 0x4  | FULL_DATA    | *            | **NO** | requestedKeys on FULL_DATA |
|   | 0x4  | PARTIAL_DATA | *            | YES    | + requestedKeys |
|   | 0x4  | COLLECTION   | *            | **NO** | requestedKeys on COLLECTION |
|   | 0x5  | PARTIAL_DATA | *            | YES    | + requestID + requestedKeys |
|   | 0x6  | PARTIAL_DATA | *            | YES    | + signer + requestedKeys |
|   | 0x7  | PARTIAL_DATA | *            | YES    | + all flags |

Where `*` means all three requestTypes (ATTESTATION, CLAIM, CREDENTIAL) are valid.

**Total valid programmatic combinations tested:** 72 (after buildFromMask adjusts constraints).

---

## 13. Summary of Mobile App Handler Rules

1. **Always** require an `AuthenticationRequestOrdinalVDXFObject` before the `UserDataRequestOrdinalVDXFObject`.
2. **Always** require at least one `searchDataKey` entry.
3. **Always** check `dataType` is 1, 2, or 3 and `requestType` is 1, 2, or 3.
4. **For each flag bit**: require the matching data field; reject if mismatched.
5. **`FULL_DATA`**: warn user all data will be sent; show full object.
6. **`PARTIAL_DATA`**: require `requestedKeys`; show only requested fields; send MMR hashes for rest.
7. **`COLLECTION`**: forbid `requestedKeys`; find and show all matching objects.
8. **`FLAG_HAS_SIGNER`**: filter data to objects signed by the specified identity.
9. **`FLAG_HAS_REQUEST_ID`**: display and include in response for tracking.
10. **Return data** via `responseURIs` from the `GenericRequest`.
