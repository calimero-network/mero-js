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
