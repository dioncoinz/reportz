export function getExportOwnerUserId() {
  return (process.env.EXPORT_OWNER_USER_ID ?? process.env.NEXT_PUBLIC_EXPORT_OWNER_USER_ID ?? "").trim();
}

export function isExportOwner(userId: string | null | undefined) {
  const ownerId = getExportOwnerUserId();
  if (!ownerId || !userId) return false;
  return ownerId === userId;
}

