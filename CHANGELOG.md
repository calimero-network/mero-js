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
