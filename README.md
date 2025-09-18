# Mero.js Monorepo

This is the monorepo for **Mero.js** - Pure JavaScript SDK for Calimero.

## 📦 Packages

- **`@calimero-network/mero-js`** - The main SDK package
- **`@calimero-network/mero-js-browser-example`** - Browser-specific usage example
- **`@calimero-network/mero-js-node-example`** - Node.js-specific usage example
- **`@calimero-network/mero-js-universal-example`** - Universal usage example (works in both browser and Node.js)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (or Node.js 16+ with undici)
- pnpm (recommended) or npm

### Installation

```bash
# Install all dependencies
pnpm install

# Build the main package
pnpm build:package
```

### Running Examples

```bash
# Run all examples
pnpm example:all

# Run specific examples
pnpm example:browser    # Browser example
pnpm example:node       # Node.js example
pnpm example:universal  # Universal example
```

## 📁 Project Structure

```
mero-js/
├── packages/
│   └── mero-js/           # Main SDK package
│       ├── src/           # Source code
│       ├── dist/          # Built output
│       ├── package.json   # Package configuration
│       └── README.md      # Package documentation
├── examples/
│   ├── browser-example/   # Browser-specific example
│   ├── node-example/      # Node.js-specific example
│   └── universal-example/ # Universal example
├── package.json           # Root workspace configuration
├── pnpm-workspace.yaml    # pnpm workspace configuration
└── README.md             # This file
```

## 🛠️ Development

### Available Scripts

```bash
# Build all packages (excluding examples)
pnpm build

# Build only the main package
pnpm build:package

# Build only examples
pnpm build:examples

# Run tests
pnpm test

# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Clean all build artifacts
pnpm clean

# Run development mode (watch mode)
pnpm dev

# Install all dependencies
pnpm install:all
```

### Working with Examples

Each example is an independent package that depends on the main SDK:

1. **Build the main package first**: `pnpm build:package`
2. **Run the example**: `pnpm example:<name>`

Examples are designed to be:

- **Independent**: Each has its own package.json and dependencies
- **Self-contained**: Can be run individually
- **Environment-specific**: Browser example for browsers, Node.js example for Node.js, etc.

## 📚 Documentation

- **Main Package**: See `packages/mero-js/README.md` for detailed SDK documentation
- **Examples**: Each example directory contains its own documentation and usage patterns

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting: `pnpm test && pnpm lint`
5. Submit a pull request

## 📄 License

MIT

## 🔗 Links

- [Main Package Documentation](./packages/mero-js/README.md)
- [Calimero Network](https://calimero.network)
- [GitHub Repository](https://github.com/calimero-network/mero-js)
