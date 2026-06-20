module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
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
        path: "^apps/server/src",
      },
      to: {
        path: "^apps/client/src",
      },
    },
    {
      name: "no-client-to-server",
      severity: "error",
      comment:
        "Frontend code should use API contracts instead of backend files.",
      from: {
        path: "^apps/client/src",
      },
      to: {
        path: "^apps/server/src",
      },
    },
  ],
  options: {
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
