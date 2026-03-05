export type AppRole = "contributor" | "supervisor" | "manager" | "owner";

export function hasManagerAccess(role: AppRole | null | undefined) {
  return role === "manager" || role === "owner";
}

export function isOwner(role: AppRole | null | undefined) {
  return role === "owner";
}

export function canManageBranding(role: AppRole | null | undefined) {
  return role === "owner";
}

export function canAccessExportSettings(role: AppRole | null | undefined) {
  return role === "owner";
}

export function canExportPowerPoint(role: AppRole | null | undefined) {
  return role === "supervisor" || role === "manager";
}

export function canAccessUserAdmin(role: AppRole | null | undefined) {
  return role === "supervisor" || role === "manager" || role === "owner";
}

export function canAssignRole(actorRole: AppRole | null | undefined, targetRole: AppRole) {
  if (actorRole === "owner") return true;
  if (actorRole === "manager") return targetRole !== "owner";
  if (actorRole === "supervisor") return targetRole === "contributor";
  return false;
}
