export type ApSessionRole = "owner" | "producer" | "artist" | "listener";
export type ApSessionStatus = "active" | "paused" | "ended";

export type ApSession = {
  id: string;
  project_id: string;
  created_by: string;
  name: string;
  status: ApSessionStatus;
  transport: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApSessionMember = {
  id: string;
  session_id: string;
  user_id: string;
  role: ApSessionRole;
  last_seen_at: string;
  is_recording: boolean;
  is_playing: boolean;
  joined_at: string;
  left_at: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

export type ApSessionInvite = {
  id: string;
  session_id: string;
  token: string;
  role: ApSessionRole;
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number;
  use_count: number;
  created_at: string;
};

/** Permission matrix (server-enforced) */
export const ROLE_PERMS = {
  owner: {
    manageSession: true,
    invite: true,
    removeMember: true,
    editProject: true,
    record: true,
    reviewContributions: true,
    chat: true,
  },
  producer: {
    manageSession: false,
    invite: true,
    removeMember: false,
    editProject: true,
    record: true,
    reviewContributions: true,
    chat: true,
  },
  artist: {
    manageSession: false,
    invite: false,
    removeMember: false,
    editProject: false,
    record: true,
    reviewContributions: false,
    chat: true,
  },
  listener: {
    manageSession: false,
    invite: false,
    removeMember: false,
    editProject: false,
    record: false,
    reviewContributions: false,
    chat: true,
  },
} as const;

export type RolePermKey = keyof (typeof ROLE_PERMS)["owner"];

export function roleCan(role: ApSessionRole, perm: RolePermKey): boolean {
  return Boolean(ROLE_PERMS[role]?.[perm]);
}
