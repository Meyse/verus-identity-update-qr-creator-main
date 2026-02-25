# AppEncryptionRequestDetails — Mobile App Handler Specification

This document defines the structure, flags, constraints, and expected mobile-app behaviour for `AppEncryptionRequestDetails` objects received inside a `GenericRequest`. It covers validation, user-facing presentation, the `D_LIGHT` library integration for deriving encryption keys, and the construction of the `AppEncryptionResponseDetails` response.

---

## 1. Object Overview

An app-encryption request is represented by an `AppEncryptionRequestDetails` instance which is wrapped in an `AppEncryptionRequestOrdinalVDXFObject` and placed inside the `details` array of a `GenericRequest`.

```
GenericRequest
 ├─ signingId          (CompactIAddressObject – who signed the request)
 ├─ signatureData      (VerifiableSignatureData – outer signature over the whole request)
 ├─ responseURIs       (ResponseURI[] – callback/redirect URIs, REQUIRED)
 └─ details[]          (array of OrdinalVDXFObject wrappers)
      └─ [n] AppEncryptionRequestOrdinalVDXFObject
               └─ data: AppEncryptionRequestDetails
                    ├─ version                    (BN, must be 1)
                    ├─ flags                      (BN, bitmask)
                    ├─ encryptResponseToAddress    (SaplingPaymentAddress, conditional)
                    ├─ derivationNumber            (BN, mandatory, >= 0)
                    ├─ derivationID                (CompactIAddressObject, conditional)
                    └─ requestID                   (CompactIAddressObject, conditional)
```

### Purpose

An application is requesting that the wallet **derive a specific encryption address** (z-address) from the user's master seed, using parameters supplied in the request. The wallet then returns the derived key material to the application so it can communicate privately with that specific derived address.

This ensures the application receives only the narrow key material it needs — **never the user's master seed**.

---

## 2. Flags

Flags are a bitmask stored as a `BN` (big-number) value. Four flag bits are defined:

| Bit | Decimal | Hex    | Constant                              | Description |
|-----|---------|--------|---------------------------------------|-------------|
| 0   | 1       | `0x01` | `FLAG_HAS_REQUEST_ID`                 | A `requestID` (i-address) is embedded in this request for tracking/correlation. |
| 1   | 2       | `0x02` | `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS`| An `encryptResponseToAddress` z-address is included; the wallet must encrypt the response to this address. |
| 2   | 4       | `0x04` | `FLAG_HAS_DERIVATION_ID`              | A `derivationID` (i-address or FQN) is included; the wallet should use the z-address belonging to this ID when deriving the encryption address. |
| 3   | 8       | `0x08` | `FLAG_RETURN_ESK`                     | The application is requesting that the wallet also return the **Extended Spending Key** in addition to the standard viewing/address data. |

### 2.1 Data-carrying flags (bits 0–2)

These flags **require** specific companion data to be present in the `AppEncryptionRequestDetails`:

| Flag                                 | Required companion data | Validation rule |
|--------------------------------------|------------------------|-----------------|
| `FLAG_HAS_REQUEST_ID`                | `requestID` — a valid `CompactIAddressObject` | If the flag is set and `requestID` is missing or invalid → **reject**. If the flag is NOT set but `requestID` is present → **reject**. |
| `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS` | `encryptResponseToAddress` — a valid `SaplingPaymentAddress` (z-address) | If the flag is set and `encryptResponseToAddress` is missing or invalid → **reject**. If the flag is NOT set but `encryptResponseToAddress` is present → **reject**. |
| `FLAG_HAS_DERIVATION_ID`            | `derivationID` — a valid `CompactIAddressObject` | If the flag is set and `derivationID` is missing or invalid → **reject**. If the flag is NOT set but `derivationID` is present → **reject**. |

### 2.2 Behavioural flag (bit 3)

| Flag              | Behaviour |
|-------------------|-----------|
| `FLAG_RETURN_ESK` | No companion data is required. When set, the wallet must include the Extended Spending Key (`extendedSpendingKey`) in the response. This flag does **not** change the request structure — it only changes the response structure. |

### 2.3 `derivationNumber` always required

Regardless of which flags are set, `derivationNumber` must always be present and must be a non-negative integer (`>= 0`). If it is missing or negative the request is invalid and must be **rejected**.

---

## 3. GenericRequest-Level Constraints

The `AppEncryptionRequestOrdinalVDXFObject` lives inside a `GenericRequest.details[]` array. The following rules apply:

1. **`responseURIs` is REQUIRED** — The `GenericRequest` **must** contain at least one `ResponseURI` (redirect or POST callback). Without this, the wallet has nowhere to send the encryption response. If `responseURIs` is missing or empty → **reject the entire request**.
2. **Outer signature must be verified** — Always verify the `GenericRequest.signatureData` before processing any details.
3. **Only one `AppEncryptionRequestOrdinalVDXFObject`** — At most one should be present in the `details` array.
4. **`signingId` identifies the requesting app** — The `GenericRequest.signingId` tells you which application or delegated identity is making the request. Convert this i-address to a Fully Qualified Name (FQN) before displaying it to the user.

---

## 4. Validation — Step by Step

When the mobile wallet receives a `GenericRequest` containing an `AppEncryptionRequestOrdinalVDXFObject`, it must validate in this order:

### Step 1: Verify the outer GenericRequest signature

- Verify `GenericRequest.signatureData` against the serialized request using `verifydata` or equivalent.
- If verification fails → **reject** and show: *"This request could not be verified. It may have been tampered with."*

### Step 2: Verify `responseURIs` exist

- Check that `GenericRequest.responseURIs` contains at least one valid `ResponseURI`.
- If missing or empty → **reject** and show: *"This request is invalid — no return address was provided."*

### Step 3: Validate `AppEncryptionRequestDetails` version

- `version` must equal `1`.
- If `version` is `0` or `> 1` → **reject** and show: *"This request uses an unsupported version."*

### Step 4: Validate `derivationNumber`

- Must be present and `>= 0`.
- If missing or negative → **reject**.

### Step 5: Cross-check flags against companion data

For each data-carrying flag, apply the rules from Section 2.1. Flag/data mismatches → **reject**.

### Step 6: Validate individual fields

- If `encryptResponseToAddress` is present, it must be a valid Sapling z-address.
- If `derivationID` is present, it must be a valid i-address or FQN.
- If `requestID` is present, it must be a valid i-address.

If all steps pass, the request is valid and the wallet should proceed to present it to the user.

---

## 5. User Presentation — What to Show

The goal is to present the request in **simple, understandable terms** so the user can make an informed decision. Always convert i-addresses to Fully Qualified Names (FQNs) before displaying them.

### 5.1 Header / Summary

Display a clear summary at the top:

> **"[App Name] is requesting a private encryption address from your identity."**

Where `[App Name]` is the FQN resolved from `GenericRequest.signingId` (e.g. "myapp@" → "MyApp").

### 5.2 Request Details — What to Display for Each Field

Present the following information in a clear card/list layout:

| Field | User-Friendly Label | What to Show | When to Show |
|-------|---------------------|--------------|--------------|
| `GenericRequest.signingId` | **Requesting App** | The FQN of the requesting application (resolved from the i-address). | Always |
| `derivationNumber` | **Key Number** | The number displayed as-is. Explain: *"This number is used to generate a unique encryption key for this app."* | Always |
| `derivationID` | **Linked Identity** | The FQN of the identity whose z-address will be used for derivation. | Only when `FLAG_HAS_DERIVATION_ID` is set |
| *(no derivationID)* | **Linked Identity** | Show: *"Your signing identity will be used."* | When `FLAG_HAS_DERIVATION_ID` is NOT set |
| `encryptResponseToAddress` | **Encrypt Reply To** | The z-address (truncated with ellipsis for readability, full address available on tap). Explain: *"Your response will be encrypted so only this address can read it."* | Only when `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS` is set |
| `requestID` | **Request ID** | The FQN or i-address of the request identifier. | Only when `FLAG_HAS_REQUEST_ID` is set |
| `FLAG_RETURN_ESK` | **Extended Spending Key Requested** | Show a clear notice: *"This app is also requesting your Extended Spending Key for this derived address. This grants spending capability."* Use a warning/caution style. | Only when `FLAG_RETURN_ESK` is set |

### 5.3 Permission Prompt

After displaying the details, show a clear approval prompt:

> **"Allow [App Name] to generate a private encryption address from your identity?"**
>
> [Approve] &nbsp; [Deny]

If `FLAG_RETURN_ESK` is set, add a more prominent warning:

> ⚠️ **"This request includes access to the Extended Spending Key, which allows spending. Only approve if you trust this application."**

### 5.4 i-Address to FQN Conversion

**All i-addresses must be resolved to Fully Qualified Names (FQNs) before being shown to the user.** This includes:

- `GenericRequest.signingId` → show the friendly name (e.g. `iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq` → `Verus@`)
- `derivationID` → show the friendly name (e.g. `jondoe@`)
- `requestID` → show the friendly name or, if it cannot be resolved, show the raw i-address

Use the `getidentity` RPC or equivalent wallet lookup to resolve i-addresses to FQNs.

---

## 6. D_LIGHT Library — Generating the Output

Once the user approves the request, the wallet uses the **`D_LIGHT`** library to derive the encryption address and key material from the user's master seed.

### 6.1 What is D_LIGHT?

`D_LIGHT` is a wallet library that provides Sapling (z-address) key operations:

| Function | Purpose |
|----------|---------|
| `zgetencryptionaddress` | Derives encryption address and key material from the user's master seed using the provided derivation parameters. |
| `encrypt` | Encrypts data to a given Sapling z-address. |
| `decrypt` | Decrypts data that was encrypted to a Sapling z-address the wallet controls. |

### 6.2 Deriving the Encryption Address

The wallet calls `D_LIGHT.zgetencryptionaddress` (or equivalent) with the following parameters extracted from the `AppEncryptionRequestDetails`:

| Parameter | Source | Notes |
|-----------|--------|-------|
| **Derivation number** | `derivationNumber` | The integer used to derive a unique key from the master seed. |
| **Derivation identity** | `derivationID` (if present) or the signing identity's z-address (if `derivationID` is absent) | Determines which identity's z-address is used as the derivation base. |
| **Return ESK** | `FLAG_RETURN_ESK` flag | If set, the library must also return the Extended Spending Key. |

### 6.3 Output from D_LIGHT

`D_LIGHT.zgetencryptionaddress` returns the following key material:

| Output Field | Type | Description |
|-------------|------|-------------|
| `incomingViewingKey` | `Buffer` (32 bytes) | Allows viewing incoming transactions to the derived address. |
| `extendedViewingKey` | `SaplingExtendedViewingKey` | Full extended viewing key for the derived address. |
| `address` | `SaplingPaymentAddress` | The derived Sapling z-address. |
| `extendedSpendingKey` | `SaplingExtendedSpendingKey` (optional) | Only returned when `FLAG_RETURN_ESK` was set. Grants spending capability. |

---

## 7. Building the Response

After derivation, the wallet must construct an `AppEncryptionResponseDetails`, wrap it in a `GenericResponse`, and send it back via the `responseURIs`.

### 7.1 AppEncryptionResponseDetails Structure

```
AppEncryptionResponseDetails
 ├─ version                (BN, set to 1)
 ├─ flags                  (BN, bitmask)
 ├─ requestID              (CompactIAddressObject, conditional)
 ├─ incomingViewingKey     (Buffer, 32 bytes, mandatory)
 ├─ extendedViewingKey     (SaplingExtendedViewingKey, mandatory)
 ├─ address                (SaplingPaymentAddress, mandatory)
 └─ extendedSpendingKey    (SaplingExtendedSpendingKey, conditional)
```

### 7.2 Response Flags

| Bit | Decimal | Constant                        | When to Set |
|-----|---------|----------------------------------|-------------|
| 0   | 1       | `FLAG_HAS_REQUEST_ID`            | Set if the request contained a `requestID`. Echo it back for correlation. |
| 1   | 2       | `FLAG_HAS_EXTENDED_SPENDING_KEY` | Set if the request had `FLAG_RETURN_ESK` and the ESK is being returned. |

### 7.3 Mapping Request to Response

| Request Field / Flag | Response Action |
|---------------------|-----------------|
| `requestID` (with `FLAG_HAS_REQUEST_ID`) | Copy `requestID` into the response. Set `FLAG_HAS_REQUEST_ID` on response flags. |
| `FLAG_RETURN_ESK` | Include `extendedSpendingKey` from `D_LIGHT` output. Set `FLAG_HAS_EXTENDED_SPENDING_KEY` on response flags. |
| `encryptResponseToAddress` (with `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS`) | Encrypt the entire response payload to this z-address before placing it in the `GenericResponse`. |
| `incomingViewingKey` | Always include — taken directly from `D_LIGHT` output. |
| `extendedViewingKey` | Always include — taken directly from `D_LIGHT` output. |
| `address` | Always include — taken directly from `D_LIGHT` output. |

### 7.4 Wrapping in GenericResponse

The `AppEncryptionResponseDetails` is placed inside a `GenericResponse`:

```
GenericResponse
 └─ details[]
      └─ AppEncryptionResponseOrdinalVDXFObject
               └─ data: AppEncryptionResponseDetails
```

### 7.5 Encrypting the Response (when `encryptResponseToAddress` is present)

If the request included `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS`:

1. Serialize the `AppEncryptionResponseDetails` to a buffer.
2. Use `D_LIGHT.encrypt` to encrypt the buffer to the `encryptResponseToAddress` z-address.
3. Place the **encrypted** payload into the `GenericResponse`.

This ensures only the holder of the corresponding z-address viewing key can decrypt the response.

### 7.6 Sending the Response

Use the `responseURIs` from the original `GenericRequest` to send back the `GenericResponse`:

- **Type 1 (Redirect):** Redirect the user's browser/app to the URI with the response as a deeplink parameter.
- **Type 2 (POST):** POST the serialized `GenericResponse` to the URI endpoint.

---

## 8. Combined Flag Scenarios

Multiple flags can be set simultaneously. The mobile app must handle every valid combination. With 4 flags, there are 16 possible combinations (0x00 – 0x0F):

| Flags | Hex    | Scenario | Mobile App Behaviour |
|-------|--------|----------|---------------------|
| `0`   | `0x00` | Bare request — derivation number only | Derive using signing identity's z-address. Return viewing key, extended viewing key, and address. |
| `1`   | `0x01` | Request ID only | Same as 0x00 but echo `requestID` in response. |
| `2`   | `0x02` | Encrypt response to z-address | Derive keys, then encrypt the response to the specified z-address. |
| `3`   | `0x03` | Request ID + Encrypt response | Derive, encrypt response, echo request ID. |
| `4`   | `0x04` | Custom derivation ID | Use the specified identity's z-address for derivation instead of the signing ID's. |
| `5`   | `0x05` | Derivation ID + Request ID | Custom derivation identity with request tracking. |
| `6`   | `0x06` | Derivation ID + Encrypt response | Custom derivation identity, encrypt the response. |
| `7`   | `0x07` | Derivation ID + Encrypt response + Request ID | Custom derivation, encrypted response, with tracking. |
| `8`   | `0x08` | Return ESK only | Derive keys and also return the Extended Spending Key. Show ESK warning to user. |
| `9`   | `0x09` | Return ESK + Request ID | ESK with tracking. |
| `10`  | `0x0A` | Return ESK + Encrypt response | ESK, encrypted response. |
| `11`  | `0x0B` | Return ESK + Encrypt response + Request ID | ESK, encrypted, tracked. |
| `12`  | `0x0C` | Return ESK + Derivation ID | ESK with custom derivation identity. |
| `13`  | `0x0D` | Return ESK + Derivation ID + Request ID | ESK, custom derivation, tracked. |
| `14`  | `0x0E` | Return ESK + Derivation ID + Encrypt response | ESK, custom derivation, encrypted. |
| `15`  | `0x0F` | All flags | Full flow: custom derivation, encrypted response, ESK returned, request tracked. |

---

## 9. Validation Checklist for Mobile App Handler

Use this checklist to verify the mobile app correctly handles all cases:

### 9.1 Acceptance tests (should ACCEPT)

- [ ] Bare request (flags = `0x00`) with valid `derivationNumber` (0)
- [ ] Each single flag (0x01, 0x02, 0x04, 0x08) with correct companion data
- [ ] All 16 flag combinations (0x00–0x0F) with correct companion data and GenericRequest constraints met
- [ ] `derivationNumber` of 0 (valid minimum)
- [ ] `derivationNumber` of large values (e.g. 999999)
- [ ] `responseURIs` with Type 1 (redirect) only
- [ ] `responseURIs` with Type 2 (POST) only
- [ ] `responseURIs` with both Type 1 and Type 2

### 9.2 Rejection tests (should REJECT)

- [ ] `responseURIs` missing from `GenericRequest` → reject
- [ ] `responseURIs` empty array → reject
- [ ] `version` is 0 → reject
- [ ] `version` is > 1 → reject
- [ ] `derivationNumber` missing → reject
- [ ] `derivationNumber` negative → reject
- [ ] `FLAG_HAS_REQUEST_ID` set but `requestID` missing → reject
- [ ] `FLAG_HAS_REQUEST_ID` NOT set but `requestID` present → reject
- [ ] `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS` set but `encryptResponseToAddress` missing → reject
- [ ] `FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS` NOT set but `encryptResponseToAddress` present → reject
- [ ] `FLAG_HAS_DERIVATION_ID` set but `derivationID` missing → reject
- [ ] `FLAG_HAS_DERIVATION_ID` NOT set but `derivationID` present → reject
- [ ] `encryptResponseToAddress` is present but not a valid z-address → reject
- [ ] `derivationID` is present but not a valid i-address or FQN → reject
- [ ] `requestID` is present but not a valid i-address → reject
- [ ] Outer `GenericRequest` signature verification fails → reject

### 9.3 Edge cases

- [ ] `FLAG_RETURN_ESK` does not require companion data — it only changes the response
- [ ] `derivationID` absent → wallet defaults to using the z-address from the user's signing identity
- [ ] `encryptResponseToAddress` absent → response is returned unencrypted (only protected by the transport/deeplink layer)
- [ ] All four flags set (`0x0F`) — the maximum combination must be fully handled
- [ ] Response `requestID` must exactly match the request `requestID` when echoed back

---

## 10. Flag Bitmask Reference Table (All 16 Combinations)

For automated testing, loop from `0x00` to `0x0F` and for each mask check that:
1. The handler accepts the combination when all required companion data and GenericRequest constraints are satisfied.
2. The handler rejects the combination when any required companion data or constraint is missing.

```
Mask  Hex   REQ_ID  ENCRYPT_TO  DERIV_ID  RETURN_ESK
0     0x00  -       -           -         -
1     0x01  X       -           -         -
2     0x02  -       X           -         -
3     0x03  X       X           -         -
4     0x04  -       -           X         -
5     0x05  X       -           X         -
6     0x06  -       X           X         -
7     0x07  X       X           X         -
8     0x08  -       -           -         X
9     0x09  X       -           -         X
10    0x0A  -       X           -         X
11    0x0B  X       X           -         X
12    0x0C  -       -           X         X
13    0x0D  X       -           X         X
14    0x0E  -       X           X         X
15    0x0F  X       X           X         X
```

Key: `X` = flag is set, `-` = flag is not set.

For each row where a flag is set, the corresponding data/constraint from Sections 2.1 and 2.2 must be satisfied.

---

## 11. Complete Flow — End to End

```
┌─────────────────────────────────────────────────────────────────┐
│  APPLICATION                                                     │
│  1. Creates AppEncryptionRequestDetails with desired parameters  │
│  2. Wraps in AppEncryptionRequestOrdinalVDXFObject               │
│  3. Places in GenericRequest with responseURIs + signature       │
│  4. Encodes as deeplink URI / QR code                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  MOBILE WALLET                                                   │
│                                                                  │
│  VALIDATE:                                                       │
│  5. Verify outer GenericRequest signature                        │
│  6. Verify responseURIs exist                                    │
│  7. Validate version = 1                                         │
│  8. Validate derivationNumber >= 0                               │
│  9. Cross-check flags ↔ companion data                           │
│                                                                  │
│  PRESENT TO USER:                                                │
│  10. Resolve all i-addresses to FQNs                             │
│  11. Show: "App [FQN] requests a private encryption address"     │
│  12. Display Key Number, Linked Identity, Encrypt Reply To       │
│  13. If FLAG_RETURN_ESK: show ESK warning                        │
│  14. Prompt: [Approve] / [Deny]                                  │
│                                                                  │
│  ON APPROVE:                                                     │
│  15. Determine derivation identity:                              │
│      • If FLAG_HAS_DERIVATION_ID → use derivationID's z-address  │
│      • Otherwise → use signing identity's z-address              │
│  16. Call D_LIGHT.zgetencryptionaddress with:                    │
│      • derivationNumber                                          │
│      • derivation identity z-address                             │
│      • returnESK = FLAG_RETURN_ESK is set                        │
│  17. Build AppEncryptionResponseDetails from D_LIGHT output      │
│  18. If FLAG_HAS_REQUEST_ID → copy requestID into response       │
│  19. If FLAG_RETURN_ESK → include extendedSpendingKey             │
│  20. If FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS →                   │
│      encrypt response to encryptResponseToAddress via D_LIGHT    │
│  21. Wrap in GenericResponse                                     │
│  22. Send via responseURIs (redirect or POST)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. Summary of Mobile App Handler Rules

1. **Always** verify the outer `GenericRequest` signature first.
2. **Always** require `responseURIs` — the wallet needs a return address to send the encryption response.
3. **Always** require `derivationNumber` (`>= 0`).
4. **For each data-carrying flag** (bits 0–2): require the matching data field; reject if missing or mismatched.
5. **`FLAG_HAS_ENCRYPT_RESPONSE_TO_ADDRESS`**: encrypt the response payload to the specified z-address using `D_LIGHT.encrypt`.
6. **`FLAG_HAS_DERIVATION_ID`**: use the specified identity's z-address for derivation instead of the signing identity's z-address.
7. **`FLAG_RETURN_ESK`**: include `extendedSpendingKey` in the response; warn the user prominently that spending capability is being shared.
8. **`FLAG_HAS_REQUEST_ID`**: echo `requestID` back in the response for correlation.
9. **Always resolve i-addresses to FQNs** before displaying to the user.
10. **Use simple language** — show "private encryption address", "Key Number", "Linked Identity" rather than technical terms like "derivation", "Sapling", or "CompactIAddressObject".
11. Handle **all 16 combinations** — flags are a bitmask and any subset of the four flags can be active simultaneously.
12. Use the **`D_LIGHT`** library (`zgetencryptionaddress`, `encrypt`, `decrypt`) for all Sapling key derivation and encryption operations.
