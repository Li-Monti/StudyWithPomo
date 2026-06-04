import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Users, UserPlus, LogOut, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { StudyGroup, LeaderboardEntry, UserProfile } from '@/types/database'

function formatHoursMinutes(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
}

const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

function groupColor(name: string): string {
  let h = 0
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) & 0xffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}

// Top-3 rank styles
const RANK_STYLES = [
  { border: 'border-yellow-400/60', bg: 'bg-yellow-50/60 dark:bg-yellow-900/10', ring: 'ring-yellow-400/40', label: 'text-yellow-600 dark:text-yellow-400' },
  { border: 'border-slate-300/80', bg: 'bg-slate-50/60 dark:bg-slate-800/20', ring: 'ring-slate-300/40', label: 'text-slate-500 dark:text-slate-400' },
  { border: 'border-orange-300/60', bg: 'bg-orange-50/60 dark:bg-orange-900/10', ring: 'ring-orange-300/40', label: 'text-orange-500 dark:text-orange-400' },
]

const RANK_LABELS = ['1°', '2°', '3°']

type FriendshipWithProfiles = {
  id: string
  requester_id: string
  addressee_id: string
  requester: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null
  addressee: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null
}

export function StudyGroupPage() {
  const { id: groupId } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId || !user) return
    let cancelled = false

    const channel = supabase
      .channel(`group-${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        () => {
          if (!cancelled)
            queryClient.invalidateQueries({ queryKey: ['groupLeaderboard', groupId] })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [groupId, user, queryClient])

  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ['groupDetails', groupId],
    queryFn: async () => {
      const { data } = await supabase
        .from('study_groups')
        .select('id, name, created_by, created_at')
        .eq('id', groupId!)
        .maybeSingle()
      return data as StudyGroup | null
    },
    enabled: !!groupId && !!user,
    staleTime: 30_000,
  })

  const { data: leaderboard = [], isLoading: leaderboardLoading, isError: leaderboardError } = useQuery({
    queryKey: ['groupLeaderboard', groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_group_leaderboard', { p_group_id: groupId! })
      if (error) {
        console.error('[leaderboard]', error)
        throw error
      }
      return (data ?? []) as LeaderboardEntry[]
    },
    enabled: !!groupId && !!user,
    staleTime: 0,
    retry: false,
  })

  const { data: groupMembers = [] } = useQuery({
    queryKey: ['groupMembers', groupId],
    queryFn: async () => {
      const { data } = await supabase
        .from('study_group_members')
        .select('user_id')
        .eq('group_id', groupId!)
      return (data ?? []) as { user_id: string }[]
    },
    enabled: !!groupId && !!user && inviteOpen,
    staleTime: 0,
  })

  const { data: friends = [] } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('friendships')
        .select(`
          id, requester_id, addressee_id,
          requester:profiles!requester_id(id, username, avatar_url),
          addressee:profiles!addressee_id(id, username, avatar_url)
        `)
        .or(`requester_id.eq.${user!.id},addressee_id.eq.${user!.id}`)
        .eq('status', 'accepted')
      return (data ?? []) as FriendshipWithProfiles[]
    },
    enabled: !!user,
    staleTime: 30_000,
  })

  const memberIds = new Set(groupMembers.map((m) => m.user_id))
  const invitableFriends = friends
    .map((f) => ({
      friendshipId: f.id,
      friend: f.requester_id === user?.id ? f.addressee : f.requester,
    }))
    .filter((f) => f.friend !== null && !memberIds.has(f.friend.id)) as {
    friendshipId: string
    friend: Pick<UserProfile, 'id' | 'username' | 'avatar_url'>
  }[]

  const maxSeconds = Number(leaderboard[0]?.total_seconds ?? 0)

  async function handleInvite(friendId: string) {
    if (!groupId) return
    setInvitingId(friendId)
    const { error } = await supabase
      .from('study_group_members')
      .insert({ group_id: groupId, user_id: friendId })
    if (error) {
      toast.error('No se pudo invitar al usuario.')
    } else {
      toast.success('Amigo invitado al grupo.')
      queryClient.invalidateQueries({ queryKey: ['groupMembers', groupId] })
      queryClient.invalidateQueries({ queryKey: ['groupLeaderboard', groupId] })
    }
    setInvitingId(null)
  }

  async function handleLeave() {
    if (!groupId || !user) return
    setLeaving(true)
    const { error } = await supabase
      .from('study_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id)
    if (error) {
      toast.error('No se pudo salir del grupo.')
      setLeaving(false)
    } else {
      queryClient.invalidateQueries({ queryKey: ['myGroups', user.id] })
      navigate('/app/social')
    }
  }

  if (groupLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        <div className="h-6 w-24 rounded-lg bg-muted/50 animate-pulse" />
        <div className="h-32 rounded-2xl bg-muted/30 animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/30" />
          ))}
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/app/social')}>
          <ArrowLeft className="h-4 w-4" /> Volver
        </Button>
        <p className="text-sm text-muted-foreground">Grupo no encontrado o no tenés acceso.</p>
      </div>
    )
  }

  const color = groupColor(group.name)
  const initial = group.name.charAt(0).toUpperCase()

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Volver */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 gap-1.5 text-muted-foreground"
        onClick={() => navigate('/app/social')}
      >
        <ArrowLeft className="h-4 w-4" /> Social
      </Button>

      {/* Header del grupo */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-4">
          {/* Avatar del grupo */}
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-white text-2xl font-bold shadow-md"
            style={{ backgroundColor: color }}
          >
            {initial}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{group.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {leaderboard.length} {leaderboard.length === 1 ? 'miembro' : 'miembros'}
              </span>
              {/* Indicador live */}
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Radio className="h-3 w-3" />
                En tiempo real
              </span>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invitar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => setLeaveOpen(true)}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Leaderboard</h2>
          <Badge variant="outline" className="text-xs font-normal">
            horas desde que te uniste
          </Badge>
        </div>

        {leaderboardLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border bg-muted/30" />
            ))}
          </div>
        ) : leaderboardError ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-10 text-center">
            <p className="text-sm text-muted-foreground">No se pudo cargar el leaderboard.</p>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 py-10 text-center">
            <p className="text-sm text-muted-foreground">No hay miembros en este grupo todavía.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((entry, idx) => {
              // Coerción explícita: bigint de PostgreSQL puede llegar como string
              const seconds = Number(entry.total_seconds)
              const hours = seconds / 3600
              const progressPct = maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0
              const hasTime = seconds > 0
              const isCurrentUser = entry.user_id === user?.id
              const isTop3 = idx < 3
              const rankStyle = isTop3 ? RANK_STYLES[idx] : null

              return (
                <div
                  key={entry.user_id}
                  className={cn(
                    'rounded-xl border px-4 py-4 transition-all',
                    isTop3 && rankStyle ? cn(rankStyle.border, rankStyle.bg) : 'bg-card',
                    isCurrentUser && !isTop3 && 'border-primary/30 bg-primary/5',
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Posición */}
                    <div className="w-8 shrink-0 text-center">
                      {isTop3 ? (
                        <span className={cn('text-base font-bold', rankStyle?.label)}>
                          {RANK_LABELS[idx]}
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-muted-foreground">{idx + 1}</span>
                      )}
                    </div>

                    {/* Avatar */}
                    <Avatar size={isTop3 ? 'default' : 'sm'}>
                      <AvatarImage src={entry.avatar_url ?? undefined} />
                      <AvatarFallback className={cn(isTop3 && rankStyle && `ring-2 ${rankStyle.ring}`)}>
                        {entry.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'truncate font-medium',
                          isTop3 ? 'text-base' : 'text-sm',
                        )}>
                          {entry.username}
                        </span>
                        {isCurrentUser && (
                          <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] shrink-0">
                            Tú
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Unido {timeAgo(entry.joined_at)}
                      </p>
                    </div>

                    {/* Horas */}
                    <div className="shrink-0 text-right">
                      {hasTime ? (
                        <p className={cn(
                          'tabular-nums font-bold',
                          isTop3 ? 'text-lg' : 'text-sm',
                          isTop3 && rankStyle?.label,
                        )}>
                          {formatHoursMinutes(hours)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Sin sesiones</p>
                      )}
                    </div>
                  </div>

                  {/* Barra de progreso — solo cuando alguien tiene tiempo */}
                  {maxSeconds > 0 && hasTime && (
                    <div className="mt-3 pl-11">
                      <Progress
                        value={progressPct}
                        className={cn('h-1.5', isTop3 && 'h-2')}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Dialog invitar amigo */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Invitar amigo al grupo</DialogTitle>
          </DialogHeader>
          {invitableFriends.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {friends.length === 0
                ? 'No tenés amigos todavía. Agregá amigos desde la sección Social.'
                : 'Todos tus amigos ya están en el grupo.'}
            </p>
          ) : (
            <ul className="space-y-2 py-1">
              {invitableFriends.map(({ friend }) => (
                <li key={friend.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                  <Avatar size="sm">
                    <AvatarImage src={friend.avatar_url ?? undefined} />
                    <AvatarFallback>{friend.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 font-medium truncate">{friend.username}</span>
                  <Button
                    size="sm"
                    className="h-7 shrink-0"
                    disabled={invitingId === friend.id}
                    onClick={() => void handleInvite(friend.id)}
                  >
                    {invitingId === friend.id ? 'Invitando...' : 'Invitar'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cerrar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar salir */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Salir del grupo?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Saldrás de{' '}
            <span className="font-semibold text-foreground">{group.name}</span>. Tu historial de
            sesiones se conserva, pero perderás acceso al leaderboard.
          </p>
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={leaving} />}>
              Cancelar
            </DialogClose>
            <Button variant="destructive" disabled={leaving} onClick={() => void handleLeave()}>
              {leaving ? 'Saliendo...' : 'Salir del grupo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
