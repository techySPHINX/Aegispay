# AegisPay

A production-grade payment orchestration SDK designed for high-volume payment traffic with correctness, reliability, and extensibility as first-class concerns.

## Features

- 🔒 **Idempotent Operations**: Prevents double-charging through idempotency keys
- 🔄 **State Machine**: Strict payment lifecycle management
- 🌐 **Gateway Agnostic**: Pluggable payment gateway integration
- 🔁 **Fault Tolerance**: Circuit breakers, retries, and timeout handling
- 📊 **Event-Driven**: Domain events for all major lifecycle changes
- 🎯 **Smart Routing**: Route payments based on success rate, latency, cost, or region
- 📈 **Observable**: Structured logging, metrics, and tracing-friendly design
- 🧩 **Extensible**: Add custom gateways, validators, and routing strategies

## Architecture

AegisPay follows a clean layered architecture:

```
/src
  /domain        - Pure business logic, no IO
  /orchestration - State machines, routing, retries
  /gateways      - External payment gateway integrations
  /infra         - Database, cache, message queue adapters
  /api           - Payment service API
  /config        - Configuration and routing rules
```

## Payment Lifecycle

```
INITIATED → AUTHENTICATED → PROCESSING → SUCCESS | FAILURE
```

All state transitions are validated and enforced. Invalid transitions fail fast.

## Installation

```bash
npm install aegispay
```

## Quick Start

Coming soon...

## Documentation

Detailed documentation is available in the `/docs` folder.

## License

MIT
