module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make module boundaries harder to change.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-server-to-client",
      severity: "error",
      comment: "Backend code must not import frontend implementation files.",
      from: {
        path: "(^|/)apps/server/src",
      },
      to: {
        path: "(^|/)apps/client/src",
      },
    },
    {
      name: "no-client-to-server",
      severity: "error",
      comment:
        "Frontend code should use API contracts instead of backend files.",
      from: {
        path: "(^|/)apps/client/src",
      },
      to: {
        path: "(^|/)apps/server/src",
      },
    },
    {
      name: "no-client-foundation-to-features",
      severity: "error",
      comment:
        "Frontend foundation modules must stay reusable and cannot depend on product feature implementations.",
      from: {
        path: "(^|/)apps/client/src/(?:lib|types|components/ui)(?:/|$)",
      },
      to: {
        path: "(^|/)apps/client/src/features(?:/|$)",
      },
    },
    {
      name: "no-unresolved-internal-imports",
      severity: "error",
      comment:
        "Repository-owned aliases must resolve so architecture checks cannot miss internal edges.",
      from: {},
      to: {
        couldNotResolve: true,
        path: "^(@/|src/|@docmost/(?:db|transactional|api-contract|editor-ext)(?:/|$))",
      },
    },
    {
      name: "no-database-to-core",
      severity: "error",
      comment:
        "Persistence adapters must not depend on feature or transport implementation.",
      from: {
        path: "(^|/)apps/server/src/database",
      },
      to: {
        path: "(^|/)apps/server/src/core",
      },
    },
    {
      name: "no-core-to-collaboration-runtime",
      severity: "error",
      comment:
        "API feature code must use the collaboration document port instead of hosting Yjs runtime components.",
      from: {
        path: "(^|/)apps/server/src/core",
      },
      to: {
        path: "(^|/)apps/server/src/collaboration/(?:collaboration\\.(?:gateway|module)|extensions|processors|server)(?:[./]|$)",
      },
    },
    {
      name: "no-dictionary-to-ai-implementation",
      severity: "error",
      comment:
        "Dictionary must use the narrow AI text-generation port instead of depending on AI implementation details.",
      from: {
        path: "(^|/)apps/server/src/core/dictionary",
      },
      to: {
        path: "(^|/)apps/server/src/core/ai/(?!ports/ai-text-generation\\.port(?:\\.|$)|ai-provider\\.module(?:\\.|$))",
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "tsconfig.architecture.json",
    },
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)(dist|coverage|\\.nx|node_modules)(/|$)",
    },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    },
    tsPreCompilationDeps: true,
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
