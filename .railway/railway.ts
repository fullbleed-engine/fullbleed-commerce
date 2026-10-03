import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  if (ctx.projectId !== "ee2c5784-260b-44d7-aff3-ef46714687bc") {
    throw new Error("Link the Fullbleed Commerce staging project before applying.");
  }
  const shopifyAppVolume = volume("shopify-app-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  const shopifyApp = service("shopify-app", {
    source: github("fullbleed-engine/fullbleed-commerce", { branch: "main" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "shopify/app/Dockerfile", watchPatterns: ["/shopify/**", "/src/**", "/pro/**", "/package*.json", "/.railway/**", "/.dockerignore", "/LICENSE*"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    // Imported API value; verify the running cgroup at exactly 512 MiB.
    deploy: { drainingSeconds: 30, limitOverride: { containers: { cpu: 0.5, memoryBytes: 536870912.0000001 } }, overlapSeconds: 0, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3, sleepApplication: false, requiredMountPath: "/data" },
    volumeMounts: { "/data": shopifyAppVolume },
    // Keep values in Railway. Never use config pull --include-variables here.
    env: { DATABASE_URL: preserve(), FULLBLEED_PRIVACY_KEY: preserve(), NODE_ENV: preserve(), OPT_OUT_INSTRUMENTATION: preserve(), PORT: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), RAILWAY_RUN_UID: preserve(), SCOPES: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_PARTNER_APP_ID: preserve(), SHOPIFY_PARTNER_ORG_ID: preserve() },
  });

  return project("fullbleed-commerce-staging", {
    resources: [shopifyApp, shopifyAppVolume],
  });
});
