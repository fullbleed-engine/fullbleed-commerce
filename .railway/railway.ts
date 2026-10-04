import { bucket, defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  if (ctx.projectId === "6337f5dc-6602-48a3-acba-0286271471ea") {
    if (ctx.environmentId !== "432435d8-c0d2-4ad5-80ae-0c1444e7e1d1") {
      throw new Error("Link the declared Fullbleed Commerce production environment before applying.");
    }
    const productionData = volume("shopify-app-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 1024 });
    const productionRecovery = bucket("privacy-recovery", { region: "sjc" });
    // Provision storage and runtime settings without connecting a repository,
    // publishing a domain, or admitting merchants. Shopify credentials and the
    // production agreement are separate launch work; do not copy staging data.
    const productionApp = service("shopify-app", {
      build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "shopify/app/Dockerfile" },
      healthcheck: "/health",
      healthcheckTimeout: 120,
      replicas: { "us-west2": 1 },
      deploy: { drainingSeconds: 30, limitOverride: { containers: { cpu: 0.5, memoryBytes: 536870912 } }, overlapSeconds: 0, restartPolicyMaxRetries: 3 },
      volumeMounts: { "/data": productionData },
      env: {
        DATABASE_URL: "file:/data/commerce.sqlite",
        FULLBLEED_BACKUPS_ENABLED: "true",
        FULLBLEED_PRIVACY_KEY: preserve(),
        FULLBLEED_MONITOR_TOKEN: preserve(),
        FULLBLEED_RECOVERY_KEY: preserve(),
        FULLBLEED_RECOVERY_DATASET: preserve(),
        FULLBLEED_RECOVERY_ENDPOINT: preserve(),
        FULLBLEED_RECOVERY_REGION: preserve(),
        FULLBLEED_RECOVERY_BUCKET: preserve(),
        FULLBLEED_RECOVERY_ACCESS_KEY_ID: preserve(),
        FULLBLEED_RECOVERY_SECRET_ACCESS_KEY: preserve(),
        NODE_ENV: "production",
        OPT_OUT_INSTRUMENTATION: "true",
        PORT: "3000",
        RAILWAY_DOCKERFILE_PATH: "shopify/app/Dockerfile",
        RAILWAY_RUN_UID: "0",
        SCOPES: "read_orders",
      },
    });
    return project("fullbleed-commerce-production", { resources: [productionApp, productionData, productionRecovery] });
  }
  if (ctx.projectId !== "ee2c5784-260b-44d7-aff3-ef46714687bc" || ctx.environmentId !== "b3892972-504b-493b-8fc4-a6fb26b14d90") {
    throw new Error("Link a declared Fullbleed Commerce project and environment before applying.");
  }
  const shopifyAppVolume = volume("shopify-app-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  const privacyRecovery = bucket("privacy-recovery", { region: "sjc" });
  const shopifyApp = service("shopify-app", {
    source: github("fullbleed-engine/fullbleed-commerce", { branch: "main" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "shopify/app/Dockerfile", watchPatterns: ["/shopify/**", "/src/**", "/pro/**", "/package*.json", "/.railway/**", "/.dockerignore", "/LICENSE*"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    // Keep integer bytes: a floating-point API conversion broke bucket CLI parsing.
    deploy: { drainingSeconds: 30, limitOverride: { containers: { cpu: 0.5, memoryBytes: 536870912 } }, overlapSeconds: 0, restartPolicyMaxRetries: 3 },
    volumeMounts: { "/data": shopifyAppVolume },
    // Keep values in Railway. Never use config pull --include-variables here.
    env: { DATABASE_URL: preserve(), FULLBLEED_BACKUPS_ENABLED: preserve(), FULLBLEED_PRIVACY_KEY: preserve(), FULLBLEED_MONITOR_TOKEN: preserve(), FULLBLEED_RECOVERY_KEY: preserve(), FULLBLEED_RECOVERY_DATASET: preserve(), FULLBLEED_RECOVERY_ENDPOINT: preserve(), FULLBLEED_RECOVERY_REGION: preserve(), FULLBLEED_RECOVERY_BUCKET: preserve(), FULLBLEED_RECOVERY_ACCESS_KEY_ID: preserve(), FULLBLEED_RECOVERY_SECRET_ACCESS_KEY: preserve(), NODE_ENV: preserve(), OPT_OUT_INSTRUMENTATION: preserve(), PORT: preserve(), RAILWAY_DOCKERFILE_PATH: preserve(), RAILWAY_RUN_UID: preserve(), SCOPES: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_APP_HANDLE: preserve(), SHOPIFY_PARTNER_APP_ID: preserve(), SHOPIFY_PARTNER_ORG_ID: preserve(), SHOPIFY_PARTNER_API_ACCESS_TOKEN: preserve(), SHOPIFY_PLAN_HANDLES: preserve() },
  });

  return project("fullbleed-commerce-staging", {
    resources: [shopifyApp, shopifyAppVolume, privacyRecovery],
  });
});
