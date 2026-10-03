# Authorization Matrix — social-middleware

_Last updated: 2026-09-09 (feat/sep9-middleware, after auth fixes)_

## Auth model

Single flat model — no RBAC/roles/scopes. Access = valid `app_session` cookie
(JWT, `JWT_SECRET`, 4h TTL, Redis `jti` blacklist) verified by `SessionAuthGuard`
(src/auth/session-auth.guard.ts:16), attaching `{sub (BCSC card ID), email, name,
userId (Mongo _id)}` to `req.user`. Data isolation via per-call ownership scoping.
External form-builder routes use one-time **form access tokens** (UUID, 30-min
expiry default, `FORM_ACCESS_TOKEN_EXPIRY_MINUTES`). `USE_KONG_OIDC` (default true)
selects Kong `X-Userinfo` vs direct BCSC OAuth for the login flow.

**Legend:** `S` = SessionAuthGuard · `S+own` = session + caller-ownership check ·
`T` = form-access token · `P` = public · `DEV` = mounted only when
`NODE_ENV` ∈ {dev, development, local}

## Auth — auth.controller.ts

| Route                   | Auth | Additional checks                   | Notes                                                                                                 |
| ----------------------- | ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET /auth/login         | P    | —                                   | Kong mode trusts `X-Userinfo` header (spoofable if reachable without gateway)                         |
| GET/POST /auth/callback | P    | —                                   | POST variant takes `code`+`redirect_uri` from body                                                    |
| GET /auth/status        | P    | inline `jwt.verify` of cookie → 401 |                                                                                                       |
| GET /auth/logout        | P    | —                                   |                                                                                                       |
| GET /auth/profile       | S    | user doc must exist (404)           | `TEST_RESOURCE_CASE === 'true'` gates `resource_case_active_date` + `non_key_player_caregiver` fields |

## Application packages — application-package.controller.ts (class-level S)

| Route                                                                                                                                                                                                                   | Auth  | Additional checks                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| POST/GET/PATCH/DELETE /application-package(/:id)                                                                                                                                                                        | S+own | service scoping by `userId` (404 if not owner)        |
| GET …/:id/application-form                                                                                                                                                                                              | S+own | —                                                     |
| POST …/submit, /request-info-session, /save-referral-contact, /lock-application, /submit-documents-to-icm, /submit-training-certificates, /upload-medical-assessments, /validate-household, /in-service-training/submit | S+own | —                                                     |
| POST /application-package/access-code/redeem                                                                                                                                                                            | S     | code must match session user's lastName + dateOfBirth |

## Attachments — attachments.controller.ts (class-level S)

| Route                                     | Auth  | Additional checks                            |
| ----------------------------------------- | ----- | -------------------------------------------- |
| POST /attachments                         | S     | scoped to `userId`                           |
| POST/GET /attachments/in-service-training | S     | requires `user.resource_case_id` else 400    |
| GET …/application-package/:id             | S+own | userId-scoped                                |
| GET …/household-member/:id                | S+own | `verifyUserOwnsHouseholdMemberPackage` → 403 |
| GET/DELETE /attachments/:id               | S+own | `findByIdAndUser`/`delete(id, userId)` → 404 |

## Forms (external form-builder) — forms.controller.ts

| Route                                     | Auth | Additional checks                                   | Notes                               |
| ----------------------------------------- | ---- | --------------------------------------------------- | ----------------------------------- |
| POST /forms/validateTokenAndGetParameters | T    | token lookup + expiry → 404/400                     |                                     |
| POST /forms/validateTokenAndGetSavedJson  | T    | ⚠ expiry check disabled (accepted risk)             | stale tokens return saved form data |
| POST /forms/tombstone-data                | T    | token must be most recent for the form; returns PII |                                     |

GET /forms/token — **removed 2026-09-09** (was unowned duplicate); token minting
is exclusively via GET /application-forms/token.

## Application forms — application-form.controller.ts (no class guard)

| Route                                          | Auth                                           | Additional checks                    |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| GET /application-forms/token                   | S+own                                          | `confirmOwnership` → 401             |
| GET /application-forms/:id                     | S+own                                          | `confirmOwnership` → 401             |
| POST /application-forms/submit, /saveDraft     | T                                              | token lookup; no expiry on this path |
| GET /application-forms                         | S (in-method `extractUserIdFromRequest` → 401) | caller's forms only                  |
| GET …/household/:memberId                      | S+own                                          | `verifyHouseholdMemberAccess` → 401  |
| POST …/:id/clone, /submit-to-icm; DELETE …/:id | S+own                                          | `confirmOwnership` → 401             |

## Household — household.controller.ts (class-level S, base application-package/:pkgId/household-members)

| Route                                                                | Auth  | Additional checks                                                                                            | Notes                                                           |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| POST/GET list, GET/PATCH/DELETE :memberId, GET :memberId/access-code | S+own | `verifyUserOwnsPackage` / `verifyUserOwnsHouseholdMemberPackage` → 401                                       | PATCH: member must not have redeemed code / submitted screening |
| POST :memberId/confirm-screening-package                             | S     | member must be the caller themself → 401                                                                     |                                                                 |
| POST :memberId/access-code/resend                                    | S+own | in-method rate limit (cooldown + daily cap) — only rate limiting in the app                                  |                                                                 |
| POST :memberId/mark-screening-documents-attached                     | S+own | caller must be package owner; **blocked for Spouse / Common law / Partner** (co-applicants submit their own) | fixed 2026-09-09 (was: no caller-to-member check)               |

## Household access — household-access.controller.ts

| Route                                 | Auth | Additional checks                      |
| ------------------------------------- | ---- | -------------------------------------- |
| POST /household/access-code/associate | S    | code must match lastName + dateOfBirth |
| GET /household/members                | S    | returns caller's members only          |

## Admin / infrastructure surfaces

| Surface                                                                   | Auth                    | Status                                                                                        |
| ------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| /admin/queues (Bull Board)                                                | DEV-gated               | fixed 2026-09-09: module + mount only in development/local                                    |
| /dev-tools/\* (clear-user-data, reset-application-package, trigger-stage) | DEV-gated + runtime 403 | fixed 2026-09-09: registration dev-only; `isDev()` check now actually invokes (was no-op bug) |
| /api (Swagger)                                                            | NONE                    | unauthenticated docs (gateway-protected); accepted risk                                       |
| GET /health                                                               | P                       | intentional                                                                                   |
| /siebel/auth/\*                                                           | n/a                     | controller registration commented out — dead code                                             |

## Findings register — authorization test workstream (2026-09-09)

| # | Finding | Status |
|---|---|---|
| 8 | SessionUtil threw raw JsonWebTokenError/TokenExpiredError → 500 on invalid/expired tokens for unguarded routes | FIXED — try/catch → 401 (session.util.ts) |
| 9 | GET /application-forms relied on in-method SessionUtil only; bypassed the logout blacklist (post-logout access up to 4h) | FIXED — @UseGuards(SessionAuthGuard) added (application-form.controller.ts) |
| 10 | AttachmentsService.findByIdAndUser queried nonexistent `userId` field → owner downloads always 404 | FIXED — queries `uploadedBy` (attachments.service.ts) |
| 11 | POST /attachments and in-service-training upload accepted body references (applicationPackageId/householdMemberId/applicationFormId) to other applicants' resources — no ownership validation; enabled data injection into a victim's household-member attachment view | FIXED — assertAttachmentTargetOwnership on both create routes (attachments.controller.ts) |
| 12 | uploadMedicalAssessments / submitTrainingCertificates / submitDocumentsToICM looked up the package without userId scoping — cross-applicant requests reached business logic (submit-documents even returned 200 success) | FIXED — userId added to the findOne filters (application-package.service.ts) |
| 13 | updateApplicationPackage swallowed its own NotFoundException into 500 for cross-applicant PATCHes | FIXED — NotFoundException rethrown (application-package.service.ts) |
| 14 | hasPartner/hasHousehold/hasSupportNetwork are @IsBoolean() in the DTO but string in the schema — Mongoose silently stringifies | LOGGED ONLY — needs schema type change + data migration decision |
| 15 | /auth/profile for a deleted user suspected to null-deref | NOT A DEFECT — UserService.findOne already 404s; test artifact (forged session used a UUID where an ObjectId is required → CastError). Verified by the auth authorization spec. |

Also fixed in this workstream (pre-existing matrix gaps): household create-member wrote the body's
applicationPackageId (URL/body mismatch bypass — server now rejects mismatches with 401);
mark-screening-documents-attached now owner-only with co-applicants (Spouse/Partner/Common law) blocked.

## Matrix row updates (2026-09-09)

- GET /application-forms — now `S` (SessionAuthGuard; was in-method SessionUtil only) — also enforces the logout blacklist
- GET /application-forms/household/:householdMemberId — **member-self only** (householdMember.userId === caller); package owners are rejected
- GET /application-forms (screening list) — returns forms only for the caller's non-primary household memberships; primary applicants correctly receive an empty list
- POST /attachments + POST /attachments/in-service-training — `S+own`: ownership validated on every body resource reference
- GET /attachments/:attachmentId — now functional for owners (`uploadedBy` query fix)
- POST …/upload-medical-assessments, /submit-training-certificates, /submit-documents-to-icm — cross-applicant now 404 (userId-scoped lookups)
- PATCH /application-package/:applicationPackageId — cross-applicant now 404 (was 500)
- POST …/household-members — body applicationPackageId must match the URL package (401 on mismatch)
- GET /auth/profile — 404 for sessions whose user record no longer exists
- POST /application-forms/submit — malformed token → 400 (ValidationPipe @IsUUID), well-formed unknown token → 404

## Authorization test suite

Integration specs driving the real module graph (real guards, real ValidationPipe with production
options, real service layer + Mongoose models against mongodb-memory-server; only true external
effects are stubbed: Siebel API, Redis blacklist (in-memory Set), Bull queues). Two independently
authenticated applicants (plus a linked household member's own login) seeded per spec; every
protected operation tested as owner / other applicant / unauthenticated, with DB-state and
zero-external-side-effect assertions on rejected writes.

Files (src/auth/tests/):
- authorization-harness.smoke.spec.ts — boots the graph; cookie variants (none/tampered/blacklisted)
- household.authorization.spec.ts — incl. AC4 URL/body mismatch, AC5 relationship rules
- attachments.authorization.spec.ts — incl. create-ownership + in-service injection vectors
- application-package.authorization.spec.ts — full route surface incl. ICM submissions
- application-form.authorization.spec.ts — token minting, form routes, /forms token-gated routes
- auth.authorization.spec.ts — profile isolation, TEST_RESOURCE_CASE flag gating, deleted-user 404

Run: `npm test -- --runInBand` (the harness forces TEST_RESOURCE_CASE=false for determinism).
CI: the Tekton pipeline runs `npm-test` (node:22, npm ci + jest --runInBand) between set-env-config
and buildah — a failing test blocks image build and deploy. First run downloads a Mongo binary
(fastdl.mongodb.org egress required, or set MONGOMS_DOWNLOAD_MIRROR).

Still-open accepted risks (unchanged): validateTokenAndGetSavedJson expiry disabled; User.status
not enforced until token expiry; Swagger at /api unauthenticated; no global rate limiting;
Kong X-Userinfo trust boundary.