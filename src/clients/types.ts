export type RouteOverrideKey = "dashboard";

export type TerminologyMap = Record<string, string>;

export type ClientConfig = {
  slug: string;
  name: string;
  logo: string;
  primaryColor: string;
  terminology: TerminologyMap;
  routeOverrides?: Partial<Record<RouteOverrideKey, boolean>>;
};

