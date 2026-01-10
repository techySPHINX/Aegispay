# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please report (suspected) security vulnerabilities to the repository maintainers. You will receive a response within 48 hours. If the issue is confirmed, we will release a patch as soon as possible depending on complexity.

**Please do not report security vulnerabilities through public GitHub issues.**

### What to Include

When reporting a security issue, please include:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Security Best Practices

When using AegisPay in production:

1. **Never store sensitive payment data**: Card numbers, CVV should never be persisted
2. **Use environment variables**: Store API keys and secrets in environment variables
3. **Enable webhook signature verification**: Always verify webhook signatures from payment gateways
4. **Implement rate limiting**: Protect your payment endpoints from abuse
5. **Use HTTPS**: Always use encrypted connections for payment data
6. **Keep dependencies updated**: Regularly update dependencies to get security patches
7. **Enable audit logging**: Track all payment operations for security monitoring
8. **Implement idempotency**: Use idempotency keys to prevent duplicate charges
9. **Validate input**: Always validate and sanitize payment method data
10. **Use distributed locking**: Prevent race conditions in payment processing

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine the affected versions
2. Audit code to find any potential similar problems
3. Prepare fixes for all supported releases
4. Release new security fix versions as soon as possible

## Comments on this Policy

If you have suggestions on how this process could be improved, please submit a pull request.
