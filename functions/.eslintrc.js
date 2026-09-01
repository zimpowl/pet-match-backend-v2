module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/lib-test/**/*", // Ignore compiled tests.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  // Le style du socle L0 : 100 colonnes, accolades espacées, et l'intention
  // documentée en prose au-dessus des fonctions qui en ont besoin plutôt qu'en
  // JSDoc obligatoire partout.
  rules: {
    "quotes": ["error", "double"],
    "indent": ["error", 2],
    "max-len": ["error", { code: 100, ignoreUrls: true }],
    "object-curly-spacing": ["error", "always"],
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    "import/no-unresolved": 0,
  },
};
