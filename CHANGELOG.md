## 6.1.0 (2026-06-27)

* feat(sdk): add getBlobInfo (HEAD /blobs/:id) (#62) ([7d440ee](https://github.com/calimero-network/mero-js/commit/7d440ee)), closes [#62](https://github.com/calimero-network/mero-js/issues/62)
* test(e2e): method-aware coverage recorder + getTeeAdmissionPolicy (pairs core #2960) (#61) ([ccae44b](https://github.com/calimero-network/mero-js/commit/ccae44b)), closes [#2960](https://github.com/calimero-network/mero-js/issues/2960) [#61](https://github.com/calimero-network/mero-js/issues/61)

## <small>6.0.4 (2026-06-26)</small>

* fix(sdk): WsClient type parity + getBlob raw bytes + resync empty-body (#60) ([b112aca](https://github.com/calimero-network/mero-js/commit/b112aca)), closes [#60](https://github.com/calimero-network/mero-js/issues/60)
* ci: run e2e against released merod on every PR (replaces #25) (#59) ([22b298e](https://github.com/calimero-network/mero-js/commit/22b298e)), closes [#25](https://github.com/calimero-network/mero-js/issues/25) [#59](https://github.com/calimero-network/mero-js/issues/59)

## <small>6.0.3 (2026-06-25)</small>

* chore(deps-dev): bump vitest from 2.1.9 to 3.2.6 (#43) ([e3a0b01](https://github.com/calimero-network/mero-js/commit/e3a0b01)), closes [#43](https://github.com/calimero-network/mero-js/issues/43)

## <small>6.0.2 (2026-06-25)</small>

* chore(deps-dev): bump esbuild from 0.25.12 to 0.28.1 (#48) ([9f29edd](https://github.com/calimero-network/mero-js/commit/9f29edd)), closes [#48](https://github.com/calimero-network/mero-js/issues/48)

## <small>6.0.1 (2026-06-25)</small>

* docs(pr): add wire-contract (core gate) PR template (#58) ([1cd4c18](https://github.com/calimero-network/mero-js/commit/1cd4c18)), closes [#58](https://github.com/calimero-network/mero-js/issues/58) [#56](https://github.com/calimero-network/mero-js/issues/56)
* test(e2e): full-flow e2e coverage + recorder; fix 8 SDK wire bugs found live (#57) ([dbe404b](https://github.com/calimero-network/mero-js/commit/dbe404b)), closes [#57](https://github.com/calimero-network/mero-js/issues/57)

## 6.0.0 (2026-06-23)

* fix(admin)!: align group reparent + createContext label with core wire contract (#53) ([269c412](https://github.com/calimero-network/mero-js/commit/269c412)), closes [#53](https://github.com/calimero-network/mero-js/issues/53)
* test(auth): cover success:false payloads in revokeTokens/createRootKey (#54) ([100828a](https://github.com/calimero-network/mero-js/commit/100828a)), closes [#54](https://github.com/calimero-network/mero-js/issues/54)


### BREAKING CHANGE

* `AdminApiClient.nestGroup`/`unnestGroup` are removed in favor of
`reparentGroup`; `CreateContextRequest.groupName` is renamed to `name`. Downstream
`mero-react` exposes `useNestGroup`/`useUnnestGroup` hooks that need a
corresponding `useReparentGroup` (those hooks already 404 against current core).

Verified: 219 unit tests pass (2 new reparent tests RED→green), typecheck, lint,
build all clean.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

* style(admin): trim verbose explainer comments on reparent/createContext

Reduce the narrative comments (wire path/body, "core renamed X") to terse
one-liners; the contract lives in the PR/commit, not inline.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

## 5.0.0 (2026-06-23)

* fix(auth)!: align auth-api key/token/health methods with core wire contract (#52) ([bc1ceda](https://github.com/calimero-network/mero-js/commit/bc1ceda)), closes [#52](https://github.com/calimero-network/mero-js/issues/52) [#51](https://github.com/calimero-network/mero-js/issues/51)


### BREAKING CHANGE

* AuthApiClient.getChallenge() and isAuthed() removed (use
AdminApiClient.isAuthed()). Changed request/response types: RevokeTokenRequest
({client_id}), CreateKeyRequest/CreateKeyResponse, GenerateClientKeyRequest,
MockTokenRequest (snake_case); listRootKeys/listClientKeys now return
RootKey[]/ClientKey[] (RootKeysResponse/ClientKeysResponse, ChallengeResponse and
AuthStatus types removed); HealthResponse/IdentityResponse field changes.

Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## 4.0.0 (2026-06-22)

* fix(admin,auth)!: correct 4 wire-contract drifts vs core (alias, blob, context hash, key permissions ([4ad230a](https://github.com/calimero-network/mero-js/commit/4ad230a)), closes [#51](https://github.com/calimero-network/mero-js/issues/51)


### BREAKING CHANGE

* CreateAliasRequest is replaced by CreateContextAliasRequest /
CreateApplicationAliasRequest / CreateContextIdentityAliasRequest;
UploadBlobRequest gains optional hash/contextId; Context.rootHash is renamed to
Context.contextStateHash.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

* fix(auth)!: send { add, remove } delta for updateKeyPermissions

updateKeyPermissions sent `{ permissions }`, which core ignores — the call was a
silent no-op that echoed the old permissions back with 200. Core expects an
{ add, remove } delta (remove applied first, then add). The method now takes an
UpdateKeyPermissionsRequest delta and sends the correct body. Adds a
body-asserting test (the first guard on this endpoint's request shape).
* updateKeyPermissions(keyId, permissions: string[]) is now
updateKeyPermissions(keyId, { add?, remove? }).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

* refactor(admin): drop unsafe BodyInit cast in uploadBlob; cover ArrayBuffer path

Addresses meroreviewer warnings on uploadBlob:
- Pass request.data (Uint8Array | ArrayBuffer | Blob) directly as the body. All
  three are valid BodyInit, so the `as BodyInit` cast (which silenced type
  errors) is removed and the type is now compiler-enforced. fetch honors a
  Uint8Array view's byteOffset/byteLength, so the manual buffer slice (and its
  SharedArrayBuffer edge) is no longer needed.
- Add a test exercising the ArrayBuffer body path (the Blob path is the same
  verbatim pass-through), asserting the exact body object is streamed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## <small>3.0.1 (2026-06-17)</small>

* fix(admin): correct migrations-v2 response envelopes + AppVersionChanged event (#50) ([1038bb2](https://github.com/calimero-network/mero-js/commit/1038bb2)), closes [#50](https://github.com/calimero-network/mero-js/issues/50) [calimero-network/core#2773](https://github.com/calimero-network/core/issues/2773)

## 3.0.0 (2026-06-15)

* feat(admin)!: align admin SDK with migrations-v2 core API (#49) ([1766888](https://github.com/calimero-network/mero-js/commit/1766888)), closes [#49](https://github.com/calimero-network/mero-js/issues/49)


### BREAKING CHANGE

* `migrateMethod` is removed from `UpdateContextApplicationRequest`
and `UpgradeGroupRequest`. Callers must stop passing it; the node derives the
migrate method from the bundle ABI.

Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## <small>2.5.1 (2026-06-10)</small>

* fix(admin): tolerate a bare-null body in the metadata getters (#47) ([8ef7cfc](https://github.com/calimero-network/mero-js/commit/8ef7cfc)), closes [#47](https://github.com/calimero-network/mero-js/issues/47) [#36](https://github.com/calimero-network/mero-js/issues/36) [#45](https://github.com/calimero-network/mero-js/issues/45)

## 2.5.0 (2026-06-10)

* feat(admin): cascade flag on UpgradeGroupRequest (#46) ([86c9fa6](https://github.com/calimero-network/mero-js/commit/86c9fa6)), closes [#46](https://github.com/calimero-network/mero-js/issues/46)

## <small>2.4.1 (2026-06-09)</small>

* fix(admin): tolerate null metadata payload in metadata getters (#45) ([4491675](https://github.com/calimero-network/mero-js/commit/4491675)), closes [#45](https://github.com/calimero-network/mero-js/issues/45)

## 2.4.0 (2026-06-09)

* feat(admin): failed migration state + BundleMigration type + installFromRegistry (#2539) (#44) ([e72a3a5](https://github.com/calimero-network/mero-js/commit/e72a3a5)), closes [#2539](https://github.com/calimero-network/mero-js/issues/2539) [#44](https://github.com/calimero-network/mero-js/issues/44) [#2539](https://github.com/calimero-network/mero-js/issues/2539) [#2539](https://github.com/calimero-network/mero-js/issues/2539)

## 2.3.0 (2026-06-08)

* feat: migration-UX SDK surfaces — migration/cascade status, typed SSE, migrateMyEntries (6g, #2539)  ([3b1cc18](https://github.com/calimero-network/mero-js/commit/3b1cc18)), closes [#2539](https://github.com/calimero-network/mero-js/issues/2539) [#42](https://github.com/calimero-network/mero-js/issues/42)

## <small>2.2.1 (2026-05-22)</small>

* fix(admin): listSubgroups reads `subgroups` field from server response (#38) ([8772557](https://github.com/calimero-network/mero-js/commit/8772557)), closes [#38](https://github.com/calimero-network/mero-js/issues/38)

## 2.2.0 (2026-05-15)

* feat(admin): add joinSubgroupInheritance method (#37) ([7479e2c](https://github.com/calimero-network/mero-js/commit/7479e2c)), closes [#37](https://github.com/calimero-network/mero-js/issues/37) [calimero-network/core#2357](https://github.com/calimero-network/core/issues/2357)

## 2.1.0 (2026-05-12)

* feat: generic metadata records + capability constants (#35) ([d19bb64](https://github.com/calimero-network/mero-js/commit/d19bb64)), closes [#35](https://github.com/calimero-network/mero-js/issues/35) [#2338](https://github.com/calimero-network/mero-js/issues/2338)

## <small>2.0.1 (2026-05-09)</small>

* fix(admin): align listGroupMembers response shape with merod (#34) ([29be1b5](https://github.com/calimero-network/mero-js/commit/29be1b5)), closes [#34](https://github.com/calimero-network/mero-js/issues/34)

## 2.0.0 (2026-04-27)

* feat(admin)!: rename DefaultVisibility → SubgroupVisibility to match core (#33) ([ecd2101](https://github.com/calimero-network/mero-js/commit/ecd2101)), closes [#33](https://github.com/calimero-network/mero-js/issues/33) [calimero-network/core#2261](https://github.com/calimero-network/core/issues/2261) [#33](https://github.com/calimero-network/mero-js/issues/33)


### BREAKING CHANGE

* setDefaultVisibility, SetDefaultVisibilityRequest,
SetDefaultVisibilityResponseData, and GroupInfo.defaultVisibility have
been renamed to setSubgroupVisibility, SetSubgroupVisibilityRequest,
SetSubgroupVisibilityResponseData, and GroupInfo.subgroupVisibility
respectively. The HTTP route moved to /settings/subgroup-visibility and
the request body field is now subgroupVisibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

* test(admin): cover SetSubgroupVisibilityRequest.requester forwarding

## <small>1.4.1 (2026-04-16)</small>

* fix: cleanup cards ([928326c](https://github.com/calimero-network/mero-js/commit/928326c))
* Add simple docs (#31) ([75b4a7a](https://github.com/calimero-network/mero-js/commit/75b4a7a)), closes [#31](https://github.com/calimero-network/mero-js/issues/31)
* Create static.yml ([0bb6bf9](https://github.com/calimero-network/mero-js/commit/0bb6bf9))

## 1.4.0 (2026-04-07)

* feat: align mero-js with core namespace model (#28) ([fb4b2ae](https://github.com/calimero-network/mero-js/commit/fb4b2ae)), closes [#28](https://github.com/calimero-network/mero-js/issues/28) [#29](https://github.com/calimero-network/mero-js/issues/29)

## 1.3.0 (2026-04-01)

* feat: add CloudClient with enableHA/disableHA methods (#27) ([8a4ae41](https://github.com/calimero-network/mero-js/commit/8a4ae41)), closes [#27](https://github.com/calimero-network/mero-js/issues/27)

## <small>1.2.1 (2026-03-30)</small>

* fix: skip npm publish when no new release is created (#24) ([424bba7](https://github.com/calimero-network/mero-js/commit/424bba7)), closes [#24](https://github.com/calimero-network/mero-js/issues/24)
* ci: comment out E2E tests until core releases X-Auth-Error fix (#23) ([adf2e9b](https://github.com/calimero-network/mero-js/commit/adf2e9b)), closes [#23](https://github.com/calimero-network/mero-js/issues/23)

## 1.2.0 (2026-03-30)

* feat: complete SDK — TokenStore, auth callback, RPC, SSE, WebSocket (#22) ([ba62a19](https://github.com/calimero-network/mero-js/commit/ba62a19)), closes [#22](https://github.com/calimero-network/mero-js/issues/22)

## 1.1.0 (2026-01-23)

* feat: add automatic token refresh and remove Tauri workarounds (#19) ([08761e9](https://github.com/calimero-network/mero-js/commit/08761e9)), closes [#19](https://github.com/calimero-network/mero-js/issues/19)

## <small>1.0.2 (2026-01-22)</small>

* fix: use node 24 for better npm OIDC support ([3df75fc](https://github.com/calimero-network/mero-js/commit/3df75fc))

## <small>1.0.1 (2026-01-22)</small>

* fix: publish to npm directly in workflow for OIDC support ([eba1ee2](https://github.com/calimero-network/mero-js/commit/eba1ee2))
* fix: use @semantic-release/npm plugin for OIDC support (#18) ([3dcf4de](https://github.com/calimero-network/mero-js/commit/3dcf4de)), closes [#18](https://github.com/calimero-network/mero-js/issues/18)

## 1.0.0 (2026-01-22)

* fix: add --provenance flag to npm publish for OIDC trusted publishing (#16) ([e7bbf13](https://github.com/calimero-network/mero-js/commit/e7bbf13)), closes [#16](https://github.com/calimero-network/mero-js/issues/16)
* fix: add missing conventional-changelog-conventionalcommits dependency (#15) ([2e9efed](https://github.com/calimero-network/mero-js/commit/2e9efed)), closes [#15](https://github.com/calimero-network/mero-js/issues/15)
* fix: add semantic-release plugins as dev dependencies ([6195a04](https://github.com/calimero-network/mero-js/commit/6195a04))
* fix: configure CI to run on feature branches and PRs only ([2a08a8c](https://github.com/calimero-network/mero-js/commit/2a08a8c))
* fix: ensure E2E tests only run on PRs to main/master ([c82cac0](https://github.com/calimero-network/mero-js/commit/c82cac0))
* fix: make npm version command idempotent (#17) ([10e47cd](https://github.com/calimero-network/mero-js/commit/10e47cd)), closes [#17](https://github.com/calimero-network/mero-js/issues/17)
* fix: remove explicit pnpm version from CI workflow ([ac5b998](https://github.com/calimero-network/mero-js/commit/ac5b998))
* fix: run CI on all branches including main/master ([004f7bf](https://github.com/calimero-network/mero-js/commit/004f7bf))
* fix: run unit tests only in release workflow ([62131e3](https://github.com/calimero-network/mero-js/commit/62131e3))
* fix: use @semantic-release/exec for OIDC trusted publishing (#13) ([13a7c9f](https://github.com/calimero-network/mero-js/commit/13a7c9f)), closes [#13](https://github.com/calimero-network/mero-js/issues/13)
* fix: use pnpm exec for semantic-release in CI ([7bcc042](https://github.com/calimero-network/mero-js/commit/7bcc042))
* fix: wrap fetch calls to prevent illegal invocation error (#11) ([0375a00](https://github.com/calimero-network/mero-js/commit/0375a00)), closes [#11](https://github.com/calimero-network/mero-js/issues/11)
* chore: remove main branch references (#10) ([637eb1e](https://github.com/calimero-network/mero-js/commit/637eb1e)), closes [#10](https://github.com/calimero-network/mero-js/issues/10)
* chore: update package.json ([afc3e1d](https://github.com/calimero-network/mero-js/commit/afc3e1d))
* chore: use master branch (#12) ([4e54ff3](https://github.com/calimero-network/mero-js/commit/4e54ff3)), closes [#12](https://github.com/calimero-network/mero-js/issues/12)
* chore(release): 1.0.0 [skip ci] ([3fd0176](https://github.com/calimero-network/mero-js/commit/3fd0176))
* Merge setup/ci-config: production-ready CI/CD setup ([daaeae5](https://github.com/calimero-network/mero-js/commit/daaeae5))
* feat: production-ready mero-js SDK ([b2cf046](https://github.com/calimero-network/mero-js/commit/b2cf046))
* feat: professional CI workflow setup ([c2281f7](https://github.com/calimero-network/mero-js/commit/c2281f7))

## 1.0.0 (2026-01-22)

* fix: add missing conventional-changelog-conventionalcommits dependency (#15) ([2e9efed](https://github.com/calimero-network/mero-js/commit/2e9efed)), closes [#15](https://github.com/calimero-network/mero-js/issues/15)
* fix: add semantic-release plugins as dev dependencies ([6195a04](https://github.com/calimero-network/mero-js/commit/6195a04))
* fix: configure CI to run on feature branches and PRs only ([2a08a8c](https://github.com/calimero-network/mero-js/commit/2a08a8c))
* fix: ensure E2E tests only run on PRs to main/master ([c82cac0](https://github.com/calimero-network/mero-js/commit/c82cac0))
* fix: remove explicit pnpm version from CI workflow ([ac5b998](https://github.com/calimero-network/mero-js/commit/ac5b998))
* fix: run CI on all branches including main/master ([004f7bf](https://github.com/calimero-network/mero-js/commit/004f7bf))
* fix: run unit tests only in release workflow ([62131e3](https://github.com/calimero-network/mero-js/commit/62131e3))
* fix: use @semantic-release/exec for OIDC trusted publishing (#13) ([13a7c9f](https://github.com/calimero-network/mero-js/commit/13a7c9f)), closes [#13](https://github.com/calimero-network/mero-js/issues/13)
* fix: use pnpm exec for semantic-release in CI ([7bcc042](https://github.com/calimero-network/mero-js/commit/7bcc042))
* fix: wrap fetch calls to prevent illegal invocation error (#11) ([0375a00](https://github.com/calimero-network/mero-js/commit/0375a00)), closes [#11](https://github.com/calimero-network/mero-js/issues/11)
* chore: remove main branch references (#10) ([637eb1e](https://github.com/calimero-network/mero-js/commit/637eb1e)), closes [#10](https://github.com/calimero-network/mero-js/issues/10)
* chore: update package.json ([afc3e1d](https://github.com/calimero-network/mero-js/commit/afc3e1d))
* chore: use master branch (#12) ([4e54ff3](https://github.com/calimero-network/mero-js/commit/4e54ff3)), closes [#12](https://github.com/calimero-network/mero-js/issues/12)
* Merge setup/ci-config: production-ready CI/CD setup ([daaeae5](https://github.com/calimero-network/mero-js/commit/daaeae5))
* feat: production-ready mero-js SDK ([b2cf046](https://github.com/calimero-network/mero-js/commit/b2cf046))
* feat: professional CI workflow setup ([c2281f7](https://github.com/calimero-network/mero-js/commit/c2281f7))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of @calimero-network/mero-js
- Pure JavaScript SDK for Calimero using Web Standards
- HTTP client with retry logic and signal composition
- Auth API client
- Admin API client
- Zero dependencies - uses native Web APIs only
