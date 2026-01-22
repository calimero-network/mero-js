# Security Policy

## Supported Versions

We actively support the following versions of `@calimero-network/mero-js`:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue. Instead, please report it via one of the following methods:

1. **Email**: security@calimero.network
2. **GitHub Security Advisory**: Use the [Security tab](https://github.com/calimero-network/calimero/security/advisories/new) in the repository

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Suggested fix (if any)

### Response Time

We aim to acknowledge security reports within 48 hours and provide an initial assessment within 7 days. We will keep you informed of our progress throughout the process.

### Disclosure Policy

- We will work with you to understand and resolve the issue quickly
- Security vulnerabilities will be disclosed publicly after a fix is available
- Credit will be given to the reporter (unless they prefer to remain anonymous)

## Security Best Practices

When using `@calimero-network/mero-js`:

1. **Keep dependencies updated**: Regularly update to the latest version
2. **Use HTTPS**: Always use HTTPS endpoints for API calls
3. **Protect credentials**: Never commit tokens or credentials to version control
4. **Validate inputs**: Always validate and sanitize user inputs
5. **Use environment variables**: Store sensitive configuration in environment variables

## Known Security Considerations

- This package has **zero runtime dependencies** to minimize attack surface
- All HTTP requests use Web Standards (`fetch` API)
- Token management is handled in-memory by default (consider persistent storage for production)
