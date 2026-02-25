import { defaultClientConfig } from "@/clients/default/config";
import { exampleClientConfig } from "@/clients/example-client/config";
import type { ClientConfig } from "@/clients/types";

const clientConfigRegistry: Record<string, ClientConfig> = {
  default: defaultClientConfig,
  "example-client": exampleClientConfig,
};

export function getClientSlug() {
  return (process.env.CLIENT_SLUG ?? process.env.NEXT_PUBLIC_CLIENT_SLUG ?? "default").trim().toLowerCase();
}

export function getClientConfig() {
  const slug = getClientSlug();
  return clientConfigRegistry[slug] ?? clientConfigRegistry.default;
}

export function listClientSlugs() {
  return Object.keys(clientConfigRegistry);
}

