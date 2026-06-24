## Description

<!-- What changed and why. Link the issue if any. -->

## Wire contract (core gate)

mero-js types mirror core's HTTP wire DTOs by hand. If this PR touches admin/auth
types or RPC shapes:

- [ ] `npm run typecheck:contract` passes (run the wire contract test against a
      core checkout: `CALIMERO_CORE_DIR=/path/to/core npm run test:contract`)
- [ ] Linked the matching core PR if this mirrors a core wire change

To run the contract test / e2e against a specific core branch, add a line to this
body (defaults to `master`):

```
core-ref: <your-core-branch>
```

## Test plan

- [ ] `npm run test:unit`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
