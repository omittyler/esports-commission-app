import "@shopify/shopify-api/adapters/cf-worker";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import database from "./database.server";

function createApp() {
  return shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.October26,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(database),
    distribution: AppDistribution.SingleMerchant,
    future: { expiringOfflineAccessTokens: true },
  });
}
let app: ReturnType<typeof createApp> | undefined;
// Session storage checks its table in the constructor. Construct inside a
// request/scheduled event so the request-scoped D1 binding is available.
const getApp = () => (app ??= createApp());
export const apiVersion = ApiVersion.October26;
export const authenticate = {
  admin: (
    ...args: Parameters<ReturnType<typeof createApp>["authenticate"]["admin"]>
  ) => getApp().authenticate.admin(...args),
  webhook: (
    ...args: Parameters<ReturnType<typeof createApp>["authenticate"]["webhook"]>
  ) => getApp().authenticate.webhook(...args),
};
export const unauthenticated = {
  admin: (
    ...args: Parameters<
      ReturnType<typeof createApp>["unauthenticated"]["admin"]
    >
  ) => getApp().unauthenticated.admin(...args),
};
export const login = (
  ...args: Parameters<ReturnType<typeof createApp>["login"]>
) => getApp().login(...args);
export const addDocumentResponseHeaders = (
  ...args: Parameters<
    ReturnType<typeof createApp>["addDocumentResponseHeaders"]
  >
) => getApp().addDocumentResponseHeaders(...args);
export const registerWebhooks = (
  ...args: Parameters<ReturnType<typeof createApp>["registerWebhooks"]>
) => getApp().registerWebhooks(...args);
export const sessionStorage = new Proxy(
  {} as ReturnType<typeof createApp>["sessionStorage"],
  {
    get: (_, key) => {
      const storage = getApp().sessionStorage;
      const member = storage[key as keyof typeof storage];
      return typeof member === "function" ? member.bind(storage) : member;
    },
  },
);
export default {
  authenticate,
  unauthenticated,
  login,
  addDocumentResponseHeaders,
  registerWebhooks,
  sessionStorage,
};
