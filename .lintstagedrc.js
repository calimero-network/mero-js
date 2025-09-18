module.exports = {
  // Format and lint TypeScript/JavaScript files (excluding node_modules)
  'packages/**/*.{ts,tsx,js,jsx}': ['prettier --write', 'eslint --fix'],
  'examples/**/*.{ts,tsx,js,jsx}': ['prettier --write'],
  '*.{ts,tsx,js,jsx}': ['prettier --write'],

  // Format JSON files (excluding node_modules)
  'packages/**/*.json': ['prettier --write'],
  'examples/**/*.json': ['prettier --write'],
  '*.json': ['prettier --write'],

  // Format Markdown files
  '*.md': ['prettier --write'],

  // Format YAML files
  '*.{yml,yaml}': ['prettier --write'],

  // Format other text files
  '*.{css,scss,html}': ['prettier --write'],
};
