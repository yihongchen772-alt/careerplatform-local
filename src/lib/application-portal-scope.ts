/** Never infer ownership from the number of portals: deleting one must not reassign its applications. */
export function portalOwnsApplication(portalId: string, linkedPortalId: string | null): boolean {
  return linkedPortalId === portalId;
}
