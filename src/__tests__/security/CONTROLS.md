# PolyGraph — NIST 800-53 Rev 5 Security Control Mapping

*This document maps NIST SP 800-53 Rev 5 controls to PolyGraph's security test suite.*

## Applicability Statement

PolyGraph is an **embedded library**, not a standalone information system. Many 800-53
controls are inherited from the host application and its operating environment. This
mapping explicitly identifies:

1. **Controls PolyGraph directly satisfies** — testable assertions in the library itself
2. **Controls PolyGraph supports** — the library provides mechanisms the host must configure
3. **Controls inherited from the host** — not applicable at the library level

This transparency is intentional. An assessor should never have to guess whether a
control applies to PolyGraph or to the system embedding it.

---

## Control Mapping

### AC — Access Control

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| AC-3 | Access Enforcement | **Supports** | `ac-access-control.sec.test.ts` |
| AC-4 | Information Flow Enforcement | **Supports** | `ac-access-control.sec.test.ts` |
| AC-6 | Least Privilege | **Directly Satisfies** | `ac-access-control.sec.test.ts` |

**Notes:** PolyGraph has no built-in auth/RBAC (by design — the host application owns identity).
Tests verify that the API enforces referential integrity, that operations fail predictably
on invalid references, and that no implicit privilege escalation is possible through the API.

### AU — Audit and Accountability

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| AU-2 | Event Logging | **Supports** | `au-audit.sec.test.ts` |
| AU-3 | Content of Audit Records | **Supports** | `au-audit.sec.test.ts` |
| AU-12 | Audit Record Generation | **Supports** | `au-audit.sec.test.ts` |

**Notes:** Every node and relationship has a unique, immutable ID. Stats accurately reflect
the current state. Tests verify state consistency and that all mutations produce traceable
artifacts. Full audit logging (timestamps, actor attribution) is a host responsibility.

### CM — Configuration Management

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| CM-7 | Least Functionality | **Directly Satisfies** | `cm-configuration.sec.test.ts` |
| CM-7(1) | Periodic Review | **Supports** | (dependency audit) |

**Notes:** PolyGraph exposes only the API surface documented in its type definitions. No hidden
endpoints, no debug modes, no undocumented configuration. Tests verify the public API surface
matches expectations and that no unexpected exports exist.

### SC — System and Communications Protection

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| SC-4 | Information in Shared Resources | **Directly Satisfies** | `sc-protection.sec.test.ts` |
| SC-28 | Protection of Information at Rest | **Supports** | `sc-protection.sec.test.ts` |
| SC-13 | Cryptographic Protection | **Inherited** | (host/storage layer) |

**Notes:** Tests verify that separate graph instances share no state, that deleted data is not
recoverable through the API, and that serialized data does not leak internal structure.
Encryption at rest is a storage adapter responsibility (RocksDB encryption, filesystem
encryption) — PolyGraph's adapter pattern makes this pluggable.

### SI — System and Information Integrity

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| SI-10 | Information Input Validation | **Directly Satisfies** | `si-integrity.sec.test.ts` |
| SI-16 | Memory Protection | **Directly Satisfies** | `si-integrity.sec.test.ts` |
| SI-7 | Software & Information Integrity | **Supports** | `si-integrity.sec.test.ts` |

**Notes:** Tests verify that PolyGraph handles adversarial inputs safely — prototype pollution
attempts, oversized properties, malicious key patterns, injection via property names/values,
and deeply nested objects. No input should cause code execution, memory corruption, or
information leakage.

### SA — System and Services Acquisition

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| SA-11 | Developer Testing | **Directly Satisfies** | (entire test suite) |
| SA-11(1) | Static Code Analysis | **Supports** | (TypeScript strict mode) |

**Notes:** TypeScript strict mode provides compile-time type safety. The full test suite
(166+ unit/integration tests, security tests, edge case tests) constitutes the developer
testing evidence. Coverage reports provide quantitative evidence.

### SR — Supply Chain Risk Management

| Control | Title | Applicability | Test File |
|---------|-------|--------------|-----------|
| SR-3 | Supply Chain Controls | **Directly Satisfies** | `sr-supply-chain.sec.test.ts` |
| SR-4 | Provenance | **Supports** | `sr-supply-chain.sec.test.ts` |

**Notes:** PolyGraph has minimal dependencies by design. Tests enumerate all runtime
dependencies, verify their licenses are compatible (no GPL contamination), check for
known vulnerabilities, and confirm no unnecessary transitive dependencies.

---

## Controls Explicitly Not Applicable (Inherited)

The following control families are **entirely inherited** from the host application
and operating environment. PolyGraph makes no claims about them:

| Family | Reason |
|--------|--------|
| AT — Awareness and Training | Organizational, not software |
| CA — Assessment and Authorization | System-level process |
| CP — Contingency Planning | Operational, not software |
| IA — Identification and Authentication | Host application owns identity |
| IR — Incident Response | Organizational process |
| MA — Maintenance | Operational |
| MP — Media Protection | Physical/operational |
| PE — Physical and Environmental | Physical |
| PL — Planning | Organizational |
| PM — Program Management | Organizational |
| PS — Personnel Security | Organizational |
| PT — PII Processing | Host application responsibility |
| RA — Risk Assessment | System-level process |

---

*This mapping follows the approach recommended by NIST SP 800-53A Rev 5 for
component-level security assessment. The explicit identification of inherited
controls reduces assessment scope and accelerates authorization.*
