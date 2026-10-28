/**
 * What a member may do in an organization beyond their role, as core's
 * `caps` bits (`setCapabilities`, `setTeamMember`'s `capabilities`). A team's
 * lead and an organization's admin hold them all.
 */
export const ORG_CAPABILITIES = {
  /** Create an app in the organization (on its team, or org-wide). */
  CREATE_APP: 1 << 0,
  /** Mint invites (org-wide, or on each team the invite names). */
  INVITE_MEMBERS: 1 << 1,
  /** Inherited into open teams; denying it keeps a member out of them. */
  JOIN_OPEN_TEAMS: 1 << 2,
  MANAGE_MEMBERS: 1 << 3,
  /** Upgrade the organization's apps, start org upgrade runs, approve outbound hosts (org-wide). */
  MANAGE_APPLICATION: 1 << 4,
  /** Create a top-level team without being an admin. */
  CREATE_TEAM: 1 << 5,
  /** Delete a team, and what it holds, without being an admin. */
  DELETE_TEAM: 1 << 6,
  MANAGE_VISIBILITY: 1 << 7,
  MANAGE_METADATA: 1 << 8,
} as const;

export type OrgCapability = keyof typeof ORG_CAPABILITIES;

/** What a member holds unless an admin says otherwise. */
export const DEFAULT_ORG_CAPABILITIES = ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/** The bitmask of `names`. */
export function orgCapabilities(...names: OrgCapability[]): number {
  return names.reduce((mask, name) => mask | ORG_CAPABILITIES[name], 0);
}
