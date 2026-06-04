export type SessionType = 'work' | 'short_break' | 'long_break'
export type ProjectType = 'hobby' | 'academic'
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked'

export interface UserProfile {
  id: string
  email: string
  username: string
  avatar_url: string | null
  created_at: string
}

export interface TimerConfig {
  user_id: string
  work_min: number
  short_break_min: number
  long_break_min: number
  pomodoros_per_cycle: number
}

export interface Tag {
  id: string
  user_id: string | null
  name: string
  color: string
  is_default: boolean
  created_at: string
}

export interface Project {
  id: string
  user_id: string
  name: string
  type: ProjectType
  color: string
  goal_hours: number | null
  exam_date: string | null
  archived_at: string | null
  default_tag_id: string | null
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  user_id: string
  title: string
  completed_at: string | null
  created_at: string
}

export interface ActiveSession {
  id: string
  user_id: string
  project_id: string | null
  task_id: string | null
  tag_id: string | null
  started_at: string
  ends_at: string
  session_type: SessionType
  paused_remaining_ms: number | null
}

export interface Session {
  id: string
  user_id: string
  project_id: string | null
  task_id: string | null
  tag_id: string | null
  started_at: string
  ended_at: string
  duration_seconds: number
  session_type: SessionType
}

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: FriendshipStatus
  created_at: string
}

export interface StudyGroup {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface StudyGroupMember {
  group_id: string
  user_id: string
  joined_at: string
}

export interface LeaderboardEntry {
  user_id: string
  username: string
  avatar_url: string | null
  joined_at: string
  total_seconds: number
}
