## [18.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v17.0.0...mero-js-v18.0.0) (2026-09-03)

### ⚠ BREAKING CHANGES

* **admin:** installApplication takes { package, version } instead of
{ url, hash, metadata }; installFromRegistry is removed - call
installApplication with the coordinates directly. installDevApplication takes
{ path } only, following core dropping metadata from the dev request.

* test(e2e): assert the node accepts the install coordinate shape

The route-coverage sweep fires install-application through cover(), which
swallows every failure. That is right for a state 4xx, but it also swallows a
400 from a rejected request BODY - and the coverage recorder logs a path when
the request fires, before the response, so the route reads as covered while
every call to it fails.

That combination is why core's paired SDK e2e passed on the registry-only
distribution change while this SDK still sent the old url-shaped body: the one
place that exercises the route could not tell "nothing published there" from
"your request shape is wrong".

install-application now asserts instead. These coordinates have nothing
published at them, so the install cannot succeed; what is checked is that the
node got past deserialization. Deliberately not pinned to 502: install_by_coords
propagates a fetch fault as an error, so an unreachable registry is a 500, and
requiring 502 would make this depend on CI egress to the node's configured
public registry. A status is required though, so a transport fault cannot pass
the assertion vacuously.

Verified against merod 0.11.0-rc.30, which predates the change: the coordinate
body earns `400 missing field \`url\``, which fails the new assertion.

The file header claimed a covered 4xx "proves the SDK builds and sends a correct
request". It does not prove that about the body, and that sentence is what made
the hole look intentional - corrected, with a note to assert the shape on any
route where core rejects unknown fields.

* ci: take the newest release that actually has a merod asset

Both e2e jobs resolved merod with `gh release list --limit 1` and hard-failed
when that tag carried no linux binary. GitHub publishes a release object before
its binary matrix finishes uploading, so the newest tag legitimately has no
merod for a while - 0.11.0-rc.31 sat published with only its test fixture for
several minutes, and any PR whose e2e ran in that window failed on
"no merod linux asset", indistinguishable from a genuinely broken release.

Walk back through recent releases and take the first that has the asset. Both
jobs had their own copy of the download, so it moves to one script they share
rather than being fixed twice.

Checked both directions against the live release state: it skips rc.31 and
downloads rc.30, and it exits 1 when no release in the lookback window carries
the asset.

### Features

* **admin:** install applications by package@version ([#133](https://github.com/calimero-network/mero-js/issues/133)) ([dfd2b9e](https://github.com/calimero-network/mero-js/commit/dfd2b9e9c5b1deab94b3c7a2ba2dabed6ff6d0ff))

## [17.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v16.1.0...mero-js-v17.0.0) (2026-09-03)

### ⚠ BREAKING CHANGES

* **namespace-op:** write the endorsement slot on the envelope (#134)

### Bug Fixes

* **namespace-op:** write the endorsement slot on the envelope ([#134](https://github.com/calimero-network/mero-js/issues/134)) ([d6f99ca](https://github.com/calimero-network/mero-js/commit/d6f99ca2ea2219cd82e1287c4de31a95d7e458ec)), closes [core#3804](https://github.com/calimero-network/core/issues/3804) [core#3819](https://github.com/calimero-network/core/issues/3819) [#3804](https://github.com/calimero-network/mero-js/issues/3804) [calimero-network/core#3819](https://github.com/calimero-network/core/issues/3819)

## [16.1.0](https://github.com/calimero-network/mero-js/compare/mero-js-v16.0.0...mero-js-v16.1.0) (2026-09-01)

### Features

* **invitation:** follow core's rename to admitter_addrs ([#132](https://github.com/calimero-network/mero-js/issues/132)) ([a1e6949](https://github.com/calimero-network/mero-js/commit/a1e6949b6c89a5150c7ec6d4c35602da1d4574d5))

## [16.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v15.3.4...mero-js-v16.0.0) (2026-09-01)

### ⚠ BREAKING CHANGES

* **release:** <text>     -> major
  fix: ...                    -> patch
  feat: ...                   -> minor

Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Bug Fixes

* **release:** stop prose from being read as a breaking change ([#131](https://github.com/calimero-network/mero-js/issues/131)) ([1673df8](https://github.com/calimero-network/mero-js/commit/1673df8d72f1eb4fba67e497e9065cc28e89cc62))

## [15.3.4](https://github.com/calimero-network/mero-js/compare/mero-js-v15.3.3...mero-js-v15.3.4) (2026-08-31)

### Bug Fixes

* **namespace-op:** emit joined_at, and pick the variant from the invitation ([#129](https://github.com/calimero-network/mero-js/issues/129)) ([80cf1cb](https://github.com/calimero-network/mero-js/commit/80cf1cb077c40469d9e6dd3c523e0811845c7e2d))

## [15.3.3](https://github.com/calimero-network/mero-js/compare/mero-js-v15.3.2...mero-js-v15.3.3) (2026-08-31)

### Bug Fixes

* **device-cert:** write genesis version 2, the one core accepts ([#128](https://github.com/calimero-network/mero-js/issues/128)) ([5a2c647](https://github.com/calimero-network/mero-js/commit/5a2c647a1c4f7197d7e31e560eb1c89aefe357fc))

## [15.3.2](https://github.com/calimero-network/mero-js/compare/mero-js-v15.3.1...mero-js-v15.3.2) (2026-08-31)

### Bug Fixes

* **e2e:** assert the substitution property where it is actually enforced ([#127](https://github.com/calimero-network/mero-js/issues/127)) ([134fe8e](https://github.com/calimero-network/mero-js/commit/134fe8e3fa60969dd5fc91487ab0541ad8db5faf))

## [15.3.1](https://github.com/calimero-network/mero-js/compare/mero-js-v15.3.0...mero-js-v15.3.1) (2026-08-31)

### Bug Fixes

* **contract:** declare admitters, which every current node now sends ([#126](https://github.com/calimero-network/mero-js/issues/126)) ([f7de4f8](https://github.com/calimero-network/mero-js/commit/f7de4f8279cbd623b78b4618c7968fdb30ee4049)), closes [#124](https://github.com/calimero-network/mero-js/issues/124) [#124](https://github.com/calimero-network/mero-js/issues/124)

## [15.3.0](https://github.com/calimero-network/mero-js/compare/mero-js-v15.2.0...mero-js-v15.3.0) (2026-08-31)

### Features

* **namespace-op:** sign a membership op from the SDK, so a keyholder can join ([#125](https://github.com/calimero-network/mero-js/issues/125)) ([a15dd6e](https://github.com/calimero-network/mero-js/commit/a15dd6e2b2b34ed2ce8b7697fff0364db833c131))

## [15.2.0](https://github.com/calimero-network/mero-js/compare/mero-js-v15.1.0...mero-js-v15.2.0) (2026-08-30)

### Features

* **admin-api:** present a signed join to a designated admitter ([#124](https://github.com/calimero-network/mero-js/issues/124)) ([459f394](https://github.com/calimero-network/mero-js/commit/459f3944cb255497a0f907bedeeb528c51ffce53))

## [15.1.0](https://github.com/calimero-network/mero-js/compare/mero-js-v15.0.0...mero-js-v15.1.0) (2026-08-29)

### Features

* **device-cert:** certify a device offline from the SDK ([#123](https://github.com/calimero-network/mero-js/issues/123)) ([b20e1d6](https://github.com/calimero-network/mero-js/commit/b20e1d6466e57fd21641a260018199133ef425f4))

## [15.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v14.0.0...mero-js-v15.0.0) (2026-08-28)

### ⚠ BREAKING CHANGES

* **account:** `toAccountHex`, `toAccountBase58` and `sameAccount` are removed.
Every id core emits is 64 lowercase hex, so comparing two ids is now `===`. A
caller holding base58 account ids has data predating the migration; decode it
once rather than converting on every comparison.

Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Features

* **account:** drop the account encoding bridge ([#119](https://github.com/calimero-network/mero-js/issues/119)) ([0090ac7](https://github.com/calimero-network/mero-js/commit/0090ac7459db6c5826e66a68657c58574809d865)), closes [calimero-network/core#3696](https://github.com/calimero-network/core/issues/3696)

## [14.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v13.4.0...mero-js-v14.0.0) (2026-08-28)

### ⚠ BREAKING CHANGES

* **warrant:** the context is hex, and base58 is gone from this package (#118)

### Bug Fixes

* **warrant:** the context is hex, and base58 is gone from this package ([#118](https://github.com/calimero-network/mero-js/issues/118)) ([9298bea](https://github.com/calimero-network/mero-js/commit/9298beaeadaeb04d2eee3d12641e44e0da6914f0))

## [13.4.0](https://github.com/calimero-network/mero-js/compare/mero-js-v13.3.0...mero-js-v13.4.0) (2026-08-28)

### Features

* **warrant:** mint warrants in JS, with no dependencies ([#116](https://github.com/calimero-network/mero-js/issues/116)) ([8b9ad6a](https://github.com/calimero-network/mero-js/commit/8b9ad6a9aabaea82351fdb9777972b474b721443))

## [13.3.0](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.5...mero-js-v13.3.0) (2026-08-26)

### Features

* **admin:** bind performIntent for delegated authorship ([#113](https://github.com/calimero-network/mero-js/issues/113)) ([f51e831](https://github.com/calimero-network/mero-js/commit/f51e831e7dc3b03accf320e49febbbd9b78c1f3e)), closes [core#3636](https://github.com/calimero-network/core/issues/3636) [core#3640](https://github.com/calimero-network/core/issues/3640)

## [13.2.5](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.4...mero-js-v13.2.5) (2026-08-26)

### Bug Fixes

* **fleet:** let the pnpm probe find nothing without killing the step ([#114](https://github.com/calimero-network/mero-js/issues/114)) ([be7aa50](https://github.com/calimero-network/mero-js/commit/be7aa508e315cb336f584578916f66ef5b2e2b9f))

## [13.2.4](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.3...mero-js-v13.2.4) (2026-08-25)

### Bug Fixes

* **fleet:** record a root lockfile at its repository-relative path ([#112](https://github.com/calimero-network/mero-js/issues/112)) ([95fc7fb](https://github.com/calimero-network/mero-js/commit/95fc7fb60098141f5ef5c52e73f791d9b9665b1f))

## [13.2.3](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.2...mero-js-v13.2.3) (2026-08-25)

### Bug Fixes

* **fleet:** bump with the pnpm the repository actually uses ([#111](https://github.com/calimero-network/mero-js/issues/111)) ([cf2442d](https://github.com/calimero-network/mero-js/commit/cf2442d624b1536ab9dc4f2dea279ea5a9e215c1))

## [13.2.2](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.1...mero-js-v13.2.2) (2026-08-24)

### Bug Fixes

* **fleet:** commit only the files the bump claims ([#110](https://github.com/calimero-network/mero-js/issues/110)) ([1ac802b](https://github.com/calimero-network/mero-js/commit/1ac802bd0498aad4065c922727b44bbee751332a)), closes [#190](https://github.com/calimero-network/mero-js/issues/190) [#194](https://github.com/calimero-network/mero-js/issues/194)

## [13.2.1](https://github.com/calimero-network/mero-js/compare/mero-js-v13.2.0...mero-js-v13.2.1) (2026-08-24)

### Bug Fixes

* **admin:** read the namespace-join id under either spelling ([#108](https://github.com/calimero-network/mero-js/issues/108)) ([5d040ab](https://github.com/calimero-network/mero-js/commit/5d040ab974f5fe4beb70649c180eabd9a724a385)), closes [core#3598](https://github.com/calimero-network/core/issues/3598)

## [13.2.0](https://github.com/calimero-network/mero-js/compare/mero-js-v13.1.0...mero-js-v13.2.0) (2026-08-21)

### Features

* **account:** canonicalise account ids, and give SSE failures their reason ([#106](https://github.com/calimero-network/mero-js/issues/106)) ([82e58a5](https://github.com/calimero-network/mero-js/commit/82e58a58cfacab9971aaf667d6a41d5d653b3123))

## [13.1.0](https://github.com/calimero-network/mero-js/compare/mero-js-v13.0.0...mero-js-v13.1.0) (2026-08-18)

### Features

* **ephemeral:** add mero.ephemeral presence client (set/get/subscribe) ([#97](https://github.com/calimero-network/mero-js/issues/97)) ([d77affd](https://github.com/calimero-network/mero-js/commit/d77affdb5a5ebfe314a18a3f81cfcb0acaae8198))

## [13.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v12.1.0...mero-js-v13.0.0) (2026-08-18)

### ⚠ BREAKING CHANGES

* **admin:** `upgradePolicy` is gone from the `Namespace` and `GroupInfo`
response types. It only ever held `"LazyOnAccess"`, so no working code can
depend on its value; code that destructures it needs the name removed.

### Features

* **admin:** drop upgradePolicy from the Namespace and GroupInfo responses ([#104](https://github.com/calimero-network/mero-js/issues/104)) ([c742269](https://github.com/calimero-network/mero-js/commit/c74226950eff67f344b691ecd7dcd328acb29c1b)), closes [calimero-network/core#3485](https://github.com/calimero-network/core/issues/3485) [core#3393](https://github.com/calimero-network/core/issues/3393) [calimero-network/core#3485](https://github.com/calimero-network/core/issues/3485)

## [12.1.0](https://github.com/calimero-network/mero-js/compare/mero-js-v12.0.0...mero-js-v12.1.0) (2026-08-18)

### Features

* **events:** model the GroupMigration event family and add onMigrationEvent ([#94](https://github.com/calimero-network/mero-js/issues/94)) ([091957e](https://github.com/calimero-network/mero-js/commit/091957e239e4ee5825be16848b79c38d69c95e08))

### Bug Fixes

* **admin-api:** rename GroupUpgradeStatus/UpgradeGroupResponseData counters to localContexts* ([#93](https://github.com/calimero-network/mero-js/issues/93)) ([e76c316](https://github.com/calimero-network/mero-js/commit/e76c31612b7948b2144c0a87626d4b5657b51f2f))
* **events:** rename GroupMembershipEventData.member to memberAccount ([#95](https://github.com/calimero-network/mero-js/issues/95)) ([03dfb55](https://github.com/calimero-network/mero-js/commit/03dfb55cf35fd1373260fe63dc88384b732763a9))

## [12.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v11.1.0...mero-js-v12.0.0) (2026-08-18)

### ⚠ BREAKING CHANGES

* **admin:** `governanceOp` is gone from `JoinGroupResponseData` and
`JoinNamespaceResponseData`. It only ever held `""`, so no working code can
depend on its value; code that destructures it needs the name removed.

Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Bug Fixes

* **admin:** replace governanceOp with memberAccount on join responses ([#103](https://github.com/calimero-network/mero-js/issues/103)) ([5418ae6](https://github.com/calimero-network/mero-js/commit/5418ae648baaeb44dc72502bd63cf7b07d6f9fa3))

## [11.1.0](https://github.com/calimero-network/mero-js/compare/mero-js-v11.0.0...mero-js-v11.1.0) (2026-08-17)

### Features

* **admin:** add getNodeIdentity, deprecate getNamespaceIdentity ([#101](https://github.com/calimero-network/mero-js/issues/101)) ([bc134df](https://github.com/calimero-network/mero-js/commit/bc134dfad66c9bdf52e60c74bad26d1fb0b90ad4))

## [11.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v10.0.0...mero-js-v11.0.0) (2026-08-14)

### ⚠ BREAKING CHANGES

* **admin:** the four *ContextIdentityAlias methods on AdminApiClient are
removed, along with CreateContextIdentityAliasRequest and the
List/Create/Lookup/DeleteContextIdentityAliasResponseData types. Manage
identities without per-context aliases.

### Features

* **admin:** drop context identity alias methods ([#100](https://github.com/calimero-network/mero-js/issues/100)) ([162259c](https://github.com/calimero-network/mero-js/commit/162259cd410301dec526abd37a4757d890d79644))

## [10.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v9.0.2...mero-js-v10.0.0) (2026-08-14)

### ⚠ BREAKING CHANGES

* **admin:** drop registerGroupSigningKey (#99)

### Bug Fixes

* **admin:** drop registerGroupSigningKey ([#99](https://github.com/calimero-network/mero-js/issues/99)) ([fa76803](https://github.com/calimero-network/mero-js/commit/fa76803a5e37aa71f9f8a55f9a9840b19fc59191)), closes [calimero-network/core#3439](https://github.com/calimero-network/core/issues/3439)

## [9.0.2](https://github.com/calimero-network/mero-js/compare/mero-js-v9.0.1...mero-js-v9.0.2) (2026-08-14)

### Bug Fixes

* drop selfIdentity from the group member listing ([#98](https://github.com/calimero-network/mero-js/issues/98)) ([bf61155](https://github.com/calimero-network/mero-js/commit/bf611555544e1ead5461554aac054936ce6a83d0))

## [9.0.1](https://github.com/calimero-network/mero-js/compare/mero-js-v9.0.0...mero-js-v9.0.1) (2026-08-12)

### Bug Fixes

* **admin-api:** declare inviter_account, and address members by account in e2e ([#81](https://github.com/calimero-network/mero-js/issues/81)) ([4503845](https://github.com/calimero-network/mero-js/commit/45038451ea05ce92624af99858326bed6e6cfc74)), closes [core#3391](https://github.com/calimero-network/core/issues/3391) [core#3393](https://github.com/calimero-network/core/issues/3393)

## [9.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v8.0.0...mero-js-v9.0.0) (2026-08-11)

### ⚠ BREAKING CHANGES

* **admin-api:** CreateNamespaceRequest.upgradePolicy,
CreateGroupRequest.upgradePolicy and the UpgradePolicy type are removed.
Namespace.upgradePolicy and GroupInfo.upgradePolicy are deprecated.

### Features

* **admin-api:** drop upgradePolicy from the create requests ([#83](https://github.com/calimero-network/mero-js/issues/83)) ([2c3c835](https://github.com/calimero-network/mero-js/commit/2c3c835d16e853c4fdf543d43f626b37be792831))

## [8.0.0](https://github.com/calimero-network/mero-js/compare/mero-js-v7.3.2...mero-js-v8.0.0) (2026-08-11)

### ⚠ BREAKING CHANGES

* **admin-api:** UpdateGroupSettingsRequest, UpdateGroupSettingsResponseData,
and AdminClient.updateGroupSettings() are removed. The only field this
endpoint ever set was upgradePolicy, which no longer exists.

* feat(admin-api)!: drop residueIdentity from MemberMigrationReport
* **admin-api:** MemberMigrationReport.residueIdentity is removed. It was
hardwired to 0 in production because the wasm host exposes no committed-state
key iteration to compute it for real. authoredRemaining measures the same
fact, is self-reported, and works.

* docs(admin-api): correct toSchemaVersion doc comment

It documents the ABI state version from #[app::state(version = N)], not a
CRDT concept. The wrong wording is how the core rollup defect (comparing
bundle-semver majors instead of state versions) went unnoticed.

### Features

* **admin-api:** drop UpgradePolicy, updateGroupSettings, and residueIdentity ([#82](https://github.com/calimero-network/mero-js/issues/82)) ([a9a74e8](https://github.com/calimero-network/mero-js/commit/a9a74e8bdbe8c5fa2ab43d471c14119a885679b1))

## <small>7.3.2 (2026-07-30)</small>

* fix(types): match core's wire format and surface node errors (#79) ([ab535b1](https://github.com/calimero-network/mero-js/commit/ab535b1)), closes [#79](https://github.com/calimero-network/mero-js/issues/79)


### BREAKING CHANGE

* `AliasEntry` is removed and `ListAliasesResponseData` is now
`Record<string, string>`; `SignedGroupOpenInvitation` /
`GroupInvitationFromAdmin` use core's snake_case keys and are opaque; the
optional-on-the-wire fields of `Application`, `Context` and `Namespace` are
declared optional. Code written against the old declarations did not work
against a real node.

* fix(admin): build a real HTTP client in the admin factories

`createAdminApiClient`, `createNodeAdminApiClient` and
`createBrowserAdminApiClient` wrapped a stub whose every method threw, so the
three obvious entry points only worked for a caller who already knew to reach
for `createAdminApiClientFromHttpClient`. The transports they needed already
exist in `http-client`, so wire each to its counterpart rather than removing
public API that consumers may already import.

* feat(config): let apps react to a revoked credential via onAuthRevoked

The transport has always had the hook and `MeroJs` used it to clear its tokens,
but `MeroJsConfig` did not expose it — so an app could not tell the difference
between "logged out" and "still logged in" after the node revokes a token
family, and had no place to start a re-login. Clear first, then notify, and
swallow whatever the callback throws so a UI failure cannot mask the auth error.

`refreshToken` / `onTokenRefresh` are deliberately not exposed: MeroJs owns the
single-flight, cross-tab-locked rotation that single-use refresh tokens require,
and a `tokenStore` already observes every rotation.

* test(contract): check a live node's responses against the declared types

Items in this branch's first two commits shared one root cause: the
hand-written types drift from core's wire and nothing notices until a consumer
hits it. This closes that loop for the methods most exposed to it.

The suite provisions real resources on a booted merod and, per covered method,
asserts that every key the node sends is declared and every key the SDK
requires is present. Covered: listApplications, getContexts, listNamespaces,
createGroupInvitation (response, signed blob, and signed inner payload), and
the three alias listings. Adding one is a single SPECS entry.

Two gates, verified to fail independently: the runtime run catches a wire key
the SDK does not model (confirmed by dropping `Namespace.appVersion`), while
`typecheck:contract` — now in CI and prepublish, and extended to cover
tests/ — catches a declaration that drifts from its spec (confirmed by
reverting the alias map to a list of entries, and the invitation keys to
camelCase). Neither alone is enough: the field names in a spec are typed
`keyof T`, so a rename has to break one or the other.

* chore: stop emitting dangling sourcemaps and drop the prettier scripts

`declarationMap`/`sourceMap` made tsc write 8 maps whose `sources` point at
`../src`, which the published package (`files: ["dist"]`) never contains — every
one of them dead on arrival. The esbuild bundles that `exports` actually points
at inline `sourcesContent`, so they keep working.

`pnpm prettier` could never run: prettier is not a dependency and the repo has
no prettier config. Removing the two scripts is honest; adding the tool would
reformat a codebase that has never been prettier-formatted.

## <small>7.3.1 (2026-07-29)</small>

* fix(types): emit NodeNext-resolvable specifiers in published declarations (#78) ([dc4e735](https://github.com/calimero-network/mero-js/commit/dc4e735)), closes [#78](https://github.com/calimero-network/mero-js/issues/78)

## 7.3.0 (2026-07-29)

* feat(utils): add local node discovery helpers (#77) ([4ca6a95](https://github.com/calimero-network/mero-js/commit/4ca6a95)), closes [#77](https://github.com/calimero-network/mero-js/issues/77)

## 7.2.0 (2026-07-29)

* feat(admin): add getApplicationAbi (#76) ([c05ee81](https://github.com/calimero-network/mero-js/commit/c05ee81)), closes [#76](https://github.com/calimero-network/mero-js/issues/76)

## <small>7.1.1 (2026-07-28)</small>

* fix(e2e): give the kv-store fixture real artifact hashes (#75) ([cd460a4](https://github.com/calimero-network/mero-js/commit/cd460a4)), closes [#75](https://github.com/calimero-network/mero-js/issues/75)

## 7.1.0 (2026-07-24)

* feat(events): add group-membership event support (#73) ([606dfbf](https://github.com/calimero-network/mero-js/commit/606dfbf)), closes [#73](https://github.com/calimero-network/mero-js/issues/73)

## <small>7.0.5 (2026-07-24)</small>

* fix(admin): SemVer 2.0 compareSemver, hardened registry fetches, forceCodeOnly passthrough (#72) ([0924ea6](https://github.com/calimero-network/mero-js/commit/0924ea6)), closes [#72](https://github.com/calimero-network/mero-js/issues/72)
* ci: bump actions to Node 24 runtimes (#71) ([6b695fc](https://github.com/calimero-network/mero-js/commit/6b695fc)), closes [#71](https://github.com/calimero-network/mero-js/issues/71)

## <small>7.0.4 (2026-07-23)</small>

* docs: fix factual bugs, add missing reference pages, close depth gaps (#70) ([fd5d5a3](https://github.com/calimero-network/mero-js/commit/fd5d5a3)), closes [#70](https://github.com/calimero-network/mero-js/issues/70)

## <small>7.0.3 (2026-07-22)</small>

* docs: migrate to Astro Starlight docs site with animated diagrams (#69) ([8d2bf86](https://github.com/calimero-network/mero-js/commit/8d2bf86)), closes [#69](https://github.com/calimero-network/mero-js/issues/69) [#a5ff11](https://github.com/calimero-network/mero-js/issues/a5ff11)

## <small>7.0.2 (2026-07-20)</small>

* fix(auth): adapt e2e/CI to core rc.17 admin-creds-at-init (#68) ([4c9f619](https://github.com/calimero-network/mero-js/commit/4c9f619)), closes [#68](https://github.com/calimero-network/mero-js/issues/68) [core#3221](https://github.com/core/issues/3221) [core#3081](https://github.com/core/issues/3081) [calimero-network/core#3276](https://github.com/calimero-network/core/issues/3276)

## <small>7.0.1 (2026-07-15)</small>

* fix(auth): make token refresh single-use safe (rotation, single-flight, token_reuse) (#67) ([bdf4609](https://github.com/calimero-network/mero-js/commit/bdf4609)), closes [#67](https://github.com/calimero-network/mero-js/issues/67) [calimero-network/core#3083](https://github.com/calimero-network/core/issues/3083) [calimero-network/core#3229](https://github.com/calimero-network/core/issues/3229)

## 7.0.0 (2026-06-28)

* fix!: metadata getters return the full MetadataRecord (#65) ([6daa627](https://github.com/calimero-network/mero-js/commit/6daa627)), closes [#65](https://github.com/calimero-network/mero-js/issues/65)
* test(e2e): true round-trip + multi-node assertions (Tiers 1–3) (#63) ([2a351e1](https://github.com/calimero-network/mero-js/commit/2a351e1)), closes [#63](https://github.com/calimero-network/mero-js/issues/63)


### BREAKING CHANGE

* getGroupMetadata/getMemberMetadata/getContextMetadata now
resolve to the full MetadataRecord ({ name, data, updatedAt, updatedBy })
instead of the bare data map. Read the values under `.data`.

Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

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
