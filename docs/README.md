# nexus-core Documentation

Welcome to the nexus-core documentation. This documentation follows the [Diátaxis framework](https://diataxis.fr/), organizing content into four distinct categories based on user needs.

## Documentation Structure

### 📚 [Tutorials](./tutorials/)
**Learning-oriented guides** - Step-by-step instructions for beginners

- [Getting Started](./tutorials/getting-started.md) - Your first steps with nexus-core
- [Building Your First Event-Driven Application](./tutorials/building-first-app.md) - Complete walkthrough

### 🔧 [How-to Guides](./how-to/)
**Problem-oriented guides** - Task-based instructions for specific goals

- [Setting Up PostgreSQL with Extensions](./how-to/setup-postgres.md) - Database setup and configuration
- [Emitting Events](./how-to/emit-events.md) - How to publish events
- [Handling Events](./how-to/handle-events.md) - How to consume and process events
- [Scheduling Recurring Tasks](./how-to/schedule-tasks.md) - Setting up cron-based tasks
- [Monitoring and Debugging](./how-to/monitoring.md) - Observability and troubleshooting
- [Handling Dead Letter Queue](./how-to/dead-letter-queue.md) - Managing failed messages
- [Deploying to Production](./how-to/production-deployment.md) - Production best practices
- [Using Worker-Optional Mode](./how-to/worker-optional-mode.md) - Enhanced vs standalone mode

### 📖 [Reference](./reference/)
**Information-oriented** - Technical specifications and API details

- [API Reference](./reference/api-reference.md) - Complete API documentation
- [Technical Specification](./reference/technical-specification.md) - Comprehensive technical specification
- [Database Schema](./reference/database-schema.md) - Schema reference
- [Configuration Options](./reference/configuration.md) - All configuration options
- [Event Envelope Structure](./reference/event-envelope.md) - Event format specification
- [Error Codes](./reference/errors.md) - Error reference

### 💡 [Explanation](./explanation/)
**Understanding-oriented** - Concepts and architectural decisions

- [Architecture Overview](./explanation/architecture.md) - System architecture and design
- [How Event Processing Works](./explanation/event-processing.md) - Event flow and mechanisms
- [Namespace Isolation](./explanation/namespaces.md) - Multi-tenancy and isolation
- [Worker-Optional Architecture](./explanation/worker-optional.md) - Enhanced vs standalone modes
- [Multi-Worker Architecture](./explanation/multi-worker-architecture.md) - Multi-worker design proposal
- [Client SDK Architecture](./explanation/client-sdk-architecture.md) - Client SDK architecture proposal
- [Transactional Guarantees](./explanation/transactions.md) - ACID properties and guarantees
- [Performance Considerations](./explanation/performance.md) - Performance tuning and optimization

## Quick Links

- [Main README](../README.md) - Project overview
- [Setting Up PostgreSQL](./how-to/setup-postgres.md) - Complete setup guide (includes Docker)
- [Technical Specification](./reference/technical-specification.md) - Comprehensive technical specification

## Contributing

Found an issue or want to improve the documentation? Please open an issue or submit a pull request.

