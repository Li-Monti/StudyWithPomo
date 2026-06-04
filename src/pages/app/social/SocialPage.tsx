import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Users, UserPlus, Search, UserCheck, X, ChevronDown, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { UserProfile } from '@/types/database'

// Resultado del RPC get_my_groups (grupo + conteo en una sola query)
type MyGroupRow = {
  group_id: string
  group_name: string
  created_by: string
  created_at: string
  joined_at: string
  member_count: number | string // bigint puede llegar como string desde Supabase
}

type FriendshipWithProfiles = {
  id: string
  requester_id: string
  addressee_id: string
  requester: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null
  addressee: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null
}

type FriendRequestWithProfile = {
  id: string
  requester_id: string
  requester: Pick<UserProfile, 'id' | 'username' | 'avatar_url'> | null
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

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  if (months === 1) return 'hace 1 mes'
  return `hace ${months} meses`
}

export function SocialPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<UserProfile[]>([])
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set())

  const [inviteMenuFor, setInviteMenuFor] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${debouncedSearch}%`)
      .neq('id', user?.id ?? '')
      .limit(8)
      .then(({ data }) => {
        if (cancelled) return
        setSearchResults((data ?? []) as UserProfile[])
        setSearching(false)
      })
    return () => { cancelled = true }
  }, [debouncedSearch, user?.id])

  useEffect(() => {
    if (!inviteMenuFor) return
    function onCapture(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-invite-menu]')) {
        setInviteMenuFor(null)
      }
    }
    document.addEventListener('click', onCapture, true)
    return () => document.removeEventListener('click', onCapture, true)
  }, [inviteMenuFor])

  // Una sola query atómica: grupos + conteo de miembros (sin waterfall)
  const { data: myGroups = [] } = useQuery({
    queryKey: ['myGroups', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_groups')
      if (error) throw error
      return (data ?? []) as MyGroupRow[]
    },
    enabled: !!user,
    staleTime: 30_000,
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

  const { data: friendRequests = [] } = useQuery({
    queryKey: ['friendRequests', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('friendships')
        .select('id, requester_id, requester:profiles!requester_id(id, username, avatar_url)')
        .eq('addressee_id', user!.id)
        .eq('status', 'pending')
      return (data ?? []) as FriendRequestWithProfile[]
    },
    enabled: !!user,
    staleTime: 0,
  })

  const friendUsers = friends
    .map((f) => ({
      friendshipId: f.id,
      friend: f.requester_id === user?.id ? f.addressee : f.requester,
    }))
    .filter((f) => f.friend !== null) as {
    friendshipId: string
    friend: Pick<UserProfile, 'id' | 'username' | 'avatar_url'>
  }[]

  const friendIds = new Set(friendUsers.map((f) => f.friend.id))

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!groupName.trim() || !user) return
    setCreatingGroup(true)
    // Generamos el UUID en cliente para evitar SELECT después del INSERT.
    // El SELECT post-INSERT falla con RLS porque study_groups solo es visible
    // para miembros, y el usuario aún no se agregó a study_group_members.
    const groupId = crypto.randomUUID()
    const { error: groupErr } = await supabase
      .from('study_groups')
      .insert({ id: groupId, name: groupName.trim(), created_by: user.id })
    if (groupErr) {
      toast.error('No se pudo crear el grupo.')
      setCreatingGroup(false)
      return
    }
    const { error: memberErr } = await supabase
      .from('study_group_members')
      .insert({ group_id: groupId, user_id: user.id })
    if (memberErr) {
      toast.error('Error al unirse al grupo recién creado.')
    } else {
      toast.success('Grupo creado.')
      queryClient.invalidateQueries({ queryKey: ['myGroups'] })
      setGroupName('')
      setCreateGroupOpen(false)
    }
    setCreatingGroup(false)
  }

  async function handleSendRequest(targetId: string) {
    if (!user) return
    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: user.id, addressee_id: targetId })
    if (error) {
      toast.error('No se pudo enviar la solicitud.')
    } else {
      toast.success('Solicitud enviada.')
      setSentRequests((prev) => new Set(prev).add(targetId))
    }
  }

  async function handleAcceptRequest(friendshipId: string) {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
    if (error) {
      toast.error('No se pudo aceptar la solicitud.')
    } else {
      toast.success('¡Ahora son amigos!')
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] })
    }
  }

  async function handleRejectRequest(friendshipId: string) {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
    if (error) {
      toast.error('No se pudo rechazar la solicitud.')
    } else {
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] })
    }
  }

  async function handleInviteToGroup(groupId: string, friendId: string) {
    const { error } = await supabase
      .from('study_group_members')
      .insert({ group_id: groupId, user_id: friendId })
    if (error) {
      toast.error('No se pudo invitar. ¿Ya es miembro?')
    } else {
      toast.success('Amigo invitado al grupo.')
      queryClient.invalidateQueries({ queryKey: ['myGroups'] })
      setInviteMenuFor(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Social</h1>
          <p className="text-sm text-muted-foreground">Grupos de estudio y amigos.</p>
        </div>
      </div>

      <Tabs defaultValue="grupos" className="flex-col">
        <TabsList>
          <TabsTrigger value="grupos">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Grupos
            {myGroups.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({myGroups.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="amigos">
            <UserRound className="h-3.5 w-3.5 mr-1.5" />
            Amigos
            {friendRequests.length > 0 && (
              <Badge className="ml-1.5 h-4 min-w-4 px-1 py-0 text-[10px] leading-none">
                {friendRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Grupos ── */}
        <TabsContent value="grupos" className="pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {myGroups.length === 0
                ? 'Creá o unite a un grupo de estudio.'
                : `Sos miembro de ${myGroups.length} ${myGroups.length === 1 ? 'grupo' : 'grupos'}.`}
            </p>
            <Button onClick={() => setCreateGroupOpen(true)} className="gap-2" size="sm">
              <Plus className="h-4 w-4" /> Crear grupo
            </Button>
          </div>

          {myGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed bg-muted/20 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Users className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Sin grupos todavía</p>
                <p className="text-sm text-muted-foreground">
                  Creá un grupo e invitá a tus amigos.
                </p>
              </div>
              <Button variant="outline" onClick={() => setCreateGroupOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Crear el primero
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {myGroups.map((g) => {
                const count = Number(g.member_count)
                const color = groupColor(g.group_name)
                const initial = g.group_name.charAt(0).toUpperCase()

                return (
                  <button
                    key={g.group_id}
                    onClick={() => navigate(`/app/social/groups/${g.group_id}`)}
                    className="group flex items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:bg-accent/30"
                  >
                    {/* Avatar del grupo */}
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white text-lg font-bold shadow-sm"
                      style={{ backgroundColor: color }}
                    >
                      {initial}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold group-hover:text-primary transition-colors">
                        {g.group_name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {count} {count === 1 ? 'miembro' : 'miembros'}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">
                          Unido {timeAgo(g.joined_at)}
                        </span>
                      </div>
                    </div>

                    <div className="text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Amigos ── */}
        <TabsContent value="amigos" className="pt-5 space-y-5">
          {/* Búsqueda */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar usuarios por username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {debouncedSearch.length >= 2 && (
              <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                {searching ? (
                  <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    Buscando...
                  </div>
                ) : searchResults.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    No se encontraron usuarios con ese nombre.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {searchResults.map((profile) => {
                      const isFriend = friendIds.has(profile.id)
                      const isSent = sentRequests.has(profile.id)
                      return (
                        <li key={profile.id} className="flex items-center gap-3 px-4 py-3">
                          <Avatar>
                            <AvatarImage src={profile.avatar_url ?? undefined} />
                            <AvatarFallback>
                              {profile.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex-1 font-medium">{profile.username}</span>
                          {isFriend ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                              <UserCheck className="h-3.5 w-3.5" /> Amigos
                            </span>
                          ) : isSent ? (
                            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                              Solicitud enviada
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => void handleSendRequest(profile.id)}
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Agregar
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Solicitudes entrantes */}
          {friendRequests.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Solicitudes recibidas
                </h2>
                <Badge className="h-4 min-w-4 px-1 py-0 text-[10px] leading-none">
                  {friendRequests.length}
                </Badge>
              </div>
              <div className="rounded-xl border bg-primary/5 border-primary/20 overflow-hidden divide-y divide-primary/10">
                {friendRequests.map((req) => {
                  const profile = req.requester
                  if (!profile) return null
                  return (
                    <div key={req.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar>
                        <AvatarImage src={profile.avatar_url ?? undefined} />
                        <AvatarFallback>
                          {profile.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{profile.username}</p>
                        <p className="text-xs text-muted-foreground">quiere ser tu amigo</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => void handleAcceptRequest(req.id)}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Aceptar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRejectRequest(req.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Lista de amigos */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Amigos{friendUsers.length > 0 && ` · ${friendUsers.length}`}
            </h2>

            {friendUsers.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/20 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <UserRound className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Buscá un usuario arriba para agregar amigos.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {friendUsers.map(({ friendshipId, friend }) => (
                  <div
                    key={friendshipId}
                    className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                  >
                    <Avatar>
                      <AvatarImage src={friend.avatar_url ?? undefined} />
                      <AvatarFallback>{friend.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 font-medium truncate">{friend.username}</span>

                    {myGroups.length > 0 && (
                      <div data-invite-menu className="relative">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setInviteMenuFor(inviteMenuFor === friend.id ? null : friend.id)
                          }
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                        {inviteMenuFor === friend.id && (
                          <div className="absolute right-0 top-full z-20 mt-1 min-w-52 rounded-xl border bg-popover p-1.5 shadow-lg">
                            <p className="px-2.5 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
                              Invitar al grupo:
                            </p>
                            {myGroups.map((g) => (
                              <button
                                key={g.group_id}
                                onClick={() => void handleInviteToGroup(g.group_id, friend.id)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                              >
                                <div
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white text-[10px] font-bold"
                                  style={{ backgroundColor: groupColor(g.group_name) }}
                                >
                                  {g.group_name.charAt(0).toUpperCase()}
                                </div>
                                {g.group_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog crear grupo */}
      <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo grupo de estudio</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Nombre del grupo</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Ej: Matemáticas I"
                required
                autoFocus
              />
              {groupName.trim() && (
                <div className="flex items-center gap-2 pt-1">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold"
                    style={{ backgroundColor: groupColor(groupName.trim()) }}
                  >
                    {groupName.trim().charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-muted-foreground">Vista previa del avatar</span>
                </div>
              )}
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={creatingGroup} />}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={creatingGroup || !groupName.trim()}>
                {creatingGroup ? 'Creando...' : 'Crear grupo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
