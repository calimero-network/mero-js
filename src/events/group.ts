/** Parsed group-membership event (core's untagged `NodeEvent` group variant). */
export interface GroupMembershipEventData {
  groupId: string;
  type: 'MemberJoined' | 'MemberAdded' | 'MemberRemoved';
  data: {
    member: string;
    role?: string;
  };
}
