# PomoPal — Contexto del Proyecto

> Documentación técnica completa: arquitectura, lógica, flujos, estado actual y roadmap.
> Actualizado: 2026-06-11

## Actualización 2026-06-11

- `profiles` dejó de ser públicamente legible: la búsqueda social usa RPC `search_profiles(p_query)` y solo devuelve `id`, `username`, `avatar_url`.
- Los grupos son cerrados por invitación: la creación usa RPC `create_study_group(p_name)` y se eliminó el self-join directo por RLS.
- `sessions` queda append-only para clientes: owner puede `SELECT` e `INSERT`, no `UPDATE`/`DELETE`.
- `active_sessions` ahora guarda `total_ms`, `elapsed_ms` y `last_started_at` para medir tiempo efectivo sin contar pausas.
- Al presionar `Detener` en una sesión de trabajo se muestra un diálogo y, si se confirma, se guarda una sesión parcial con el tiempo efectivo transcurrido.
- Completar una sesión usa RPC `finish_active_work_session(true)`; detener manualmente usa `finish_active_work_session(false)` para guardar y limpiar de forma atómica.

---

## 1. Resumen General

App web de tipo Pomodoro para PC. Permite registrar sesiones de trabajo/estudio clasificadas por proyecto, tarea y etiqueta. Incluye estadísticas, sistema social con amigos y grupos de estudio con leaderboard en tiempo real.

**URL de desarrollo:** `http://localhost:5173`  
**Supabase proyecto:** `hbamecikpourbayilyen.supabase.co`

---

## 2. Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework UI | React + TypeScript + Vite | React 19, TS ~6.0, Vite 8 |
| Estilos | Tailwind CSS v4 + shadcn/ui (style: base-nova) | TW 4.3 |
| Componentes base | @base-ui/react | 1.5.0 |
| Estado local/UI | Zustand | 5.0 |
| Estado servidor | TanStack Query | 5.100 |
| Backend/DB/Auth | Supabase (PostgreSQL + Auth + Realtime) | JS SDK 2.106 |
| Routing | React Router DOM | 7.16 |
| Gráficos | Recharts | 3.8 ✅ en uso (StatsPage) |
| Iconos | lucide-react | 1.17 |
| Toasts | sonner | 2.0 |
| Animaciones | tailwindcss-animate | 1.0.7 |
| Temas | next-themes | 0.4.6 ✅ dark mode implementado |
| Timer background | Web Worker (nativo browser) | — |

### Configuraciones críticas
- `vite.config.ts`: alias `@/` → `./src/`, plugins React + Tailwind
- `tsconfig.app.json`: `"ignoreDeprecations": "6.0"` (baseUrl deprecado en TS 7), paths `@/*`
- `components.json`: style `"base-nova"` (usa `@base-ui/react` en lugar de Radix)
- `.env.local`: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`

---

## 3. Estructura de Carpetas

```
src/
├── components/
│   ├── layout/
│   │   └── AppShell.tsx          # Sidebar + Outlet
│   ├── timer/
│   │   ├── CircularTimerRing.tsx  # SVG del anillo del timer
│   │   └── TagSelector.tsx        # Chips de selección de tags
│   └── ui/                        # Componentes shadcn/ui
│       ├── button.tsx, badge.tsx, card.tsx, dialog.tsx
│       ├── input.tsx, label.tsx, select.tsx, slider.tsx
│       ├── separator.tsx, tabs.tsx, avatar.tsx, progress.tsx
│       └── ...
├── hooks/
│   ├── useAuth.ts                 # Supabase auth state
│   ├── useTimer.ts                # Lógica del timer (Worker + DB)
│   └── useSession.ts              # Completar y guardar sesiones
├── lib/
│   ├── supabase.ts                # Cliente Supabase (sin generic type)
│   └── utils.ts                   # cn() = clsx + tailwind-merge
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx          # ✅ Implementado
│   │   └── SignupPage.tsx         # ✅ Implementado
│   └── app/
│       ├── timer/TimerPage.tsx    # ✅ Implementado
│       ├── projects/
│       │   ├── ProjectsPage.tsx   # ✅ Implementado
│       │   └── ProjectDetailPage.tsx # ✅ Implementado
│       ├── stats/StatsPage.tsx    # ✅ Implementado
│       ├── social/
│       │   ├── SocialPage.tsx     # ✅ Implementado
│       │   └── StudyGroupPage.tsx # ✅ Implementado
│       └── settings/SettingsPage.tsx # ✅ Implementado
├── store/
│   └── timerStore.ts              # Zustand store global
├── types/
│   └── database.ts                # Interfaces TypeScript del schema
├── workers/
│   └── timerWorker.ts             # Web Worker del timer
├── App.tsx                        # Router tree
├── main.tsx                       # Bootstrap (QueryClient + ThemeProvider + Router)
└── index.css                      # Tailwind + CSS variables OKLCH
```

---

## 4. Base de Datos (Supabase / PostgreSQL)

### Migraciones aplicadas
- `001_initial_schema.sql` — Schema base ✅
- `002_tags_and_breaks.sql` — Tags + columnas pausa ✅
- `003_social_features.sql` — RLS para invitar amigos a grupos + policy cross-read de sessions + RPC `get_group_leaderboard` ✅
- `004_fix_rls_recursion.sql` — Función `auth_is_group_member(uuid)` SECURITY DEFINER; reemplaza policies recursivas en `study_group_members` y `study_groups` ✅
- `005_get_my_groups.sql` — RPC `get_my_groups()` que retorna grupos + conteo de miembros en una sola query ✅
- `006_fix_leaderboard_rpc.sql` — Ajusta `get_group_leaderboard` con `VOLATILE` y `SET search_path` ✅
- `007_privacy_groups_timer_integrity.sql` — Perfiles privados con RPC de búsqueda, grupos cerrados, timer efectivo y `sessions` append-only ✅
- `008_active_sessions_compat_hotfix.sql` — Compatibilidad para sesiones activas creadas por clientes previos a `007` ✅
- `009_data_integrity_constraints.sql` — Triggers/constraints para ownership cruzado, friendships inversas y rangos válidos ✅
- `010_invite_friend_to_group_rpc.sql` — RPC `invite_friend_to_group` para centralizar invitaciones a grupos ✅

### RPC Functions (SECURITY DEFINER)
| Función | Descripción |
|---|---|
| `get_group_leaderboard(p_group_id uuid)` | Horas de trabajo por miembro desde `joined_at`. Valida membresía antes de devolver datos. |
| `get_my_groups()` | Grupos del usuario actual con conteo de miembros. Elimina el waterfall de dos queries en SocialPage. |
| `auth_is_group_member(p_group_id uuid)` | Helper interno. `true` si `auth.uid()` es miembro del grupo. Usado en policies RLS. |
| `search_profiles(p_query text)` | Búsqueda social privada. Devuelve solo `id`, `username`, `avatar_url`, con mínimo 2 caracteres y límite 8. |
| `create_study_group(p_name text)` | Crea grupo y membresía del creador de forma atómica. |
| `finish_active_work_session(p_save_full bool)` | Finaliza sesión de trabajo activa de forma atómica. Completa guarda `total_ms`; stop manual guarda tiempo efectivo. |
| `invite_friend_to_group(p_group_id uuid, p_user_id uuid)` | Invita a un amigo aceptado a un grupo si quien invita ya es miembro. |

### Tablas

#### `profiles`
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | = auth.users.id |
| email | text | Email del usuario |
| username | text UNIQUE | Nombre de usuario |
| avatar_url | text | URL del avatar |
| created_at | timestamptz | — |

**Trigger:** `on_auth_user_created` → auto-crea perfil + timer_config al registrarse.

---

#### `timer_configs`
| Columna | Tipo | Default |
|---|---|---|
| user_id | uuid PK | — |
| work_min | int | 25 |
| short_break_min | int | 5 |
| long_break_min | int | 15 |
| pomodoros_per_cycle | int | 4 |

---

#### `tags` *(migración 002)*
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid FK nullable | null = tag del sistema |
| name | text | — |
| color | text | Hex color |
| is_default | bool | true = tag del sistema |
| created_at | timestamptz | — |

**Tags del sistema (is_default=true, user_id=null):**
- Estudio → `#3b82f6`
- Deporte → `#22c55e`
- Ocio → `#f59e0b`
- Trabajo → `#8b5cf6`

**RLS:** usuarios solo ven sus tags + los del sistema; no pueden editar/borrar tags del sistema.

---

#### `projects`
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid FK | — |
| name | text | — |
| type | text | `'hobby'` \| `'academic'` |
| color | text | Hex, default `#6366f1` |
| goal_hours | numeric | Meta de horas (opcional) |
| exam_date | date | Para tipo academic (opcional) |
| archived_at | timestamptz | null = activo |
| default_tag_id | uuid FK *(002)* | Tag por defecto |
| created_at | timestamptz | — |

---

#### `tasks`
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| project_id | uuid FK | — |
| user_id | uuid FK | — |
| title | text | — |
| completed_at | timestamptz | null = pendiente |
| created_at | timestamptz | — |

---

#### `active_sessions`
*Una fila por usuario (UNIQUE en user_id). Persiste el timer en curso.*

| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid UNIQUE FK | — |
| project_id | uuid FK | null = sin proyecto |
| task_id | uuid FK | null = sin tarea |
| tag_id | uuid FK *(002)* | null = sin tag |
| started_at | timestamptz | Inicio de la sesión |
| ends_at | timestamptz | Fin planificado |
| session_type | text | `'work'` \| `'short_break'` \| `'long_break'` |
| paused_remaining_ms | int *(002)* | ms restantes al pausar |
| total_ms | int *(007)* | Duración planificada de la sesión |
| elapsed_ms | int *(007)* | Tiempo efectivo acumulado antes de pausas |
| last_started_at | timestamptz *(007)* | Inicio del tramo activo actual; null si está pausada |

---

#### `sessions` *(log inmutable)*
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| user_id | uuid FK | — |
| project_id | uuid FK | — |
| task_id | uuid FK | — |
| tag_id | uuid FK *(002)* | — |
| started_at | timestamptz | — |
| ended_at | timestamptz | — |
| duration_seconds | int | — |
| session_type | text | — |

**Regla:** append-only. Nunca se edita ni borra. Realtime habilitado para leaderboard.

---

#### `friendships`
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid PK | — |
| requester_id | uuid FK | Quien envió la solicitud |
| addressee_id | uuid FK | Quien la recibe |
| status | text | `'pending'` \| `'accepted'` \| `'blocked'` |
| created_at | timestamptz | — |

Constraint: `requester_id ≠ addressee_id`, `UNIQUE(requester_id, addressee_id)`.

---

#### `study_groups` + `study_group_members`
- `study_groups`: id, name, created_by, created_at
- `study_group_members`: PK (group_id, user_id), joined_at

---

### Row Level Security
Todas las tablas tienen RLS habilitado. Política general: `user_id = auth.uid()`. Excepciones:
- `profiles`: lectura pública por username (para búsqueda de amigos)
- `tags`: lectura de tags del sistema (`is_default = true`) + propios
- `sessions`: Realtime activado (para leaderboard en grupos)
- `study_groups/members`: acceso basado en membresía

---

## 5. Routing

```
/login                    LoginPage           público
/signup                   SignupPage          público
/app                      AppShell            protegido (redirige a /login si no auth)
  /app/timer              TimerPage           ✅
  /app/projects           ProjectsPage        ✅
  /app/projects/:id       ProjectDetailPage   ✅
  /app/stats              StatsPage           ✅
  /app/social             SocialPage          ⏳ stub
  /app/social/groups/:id  StudyGroupPage      ⏳ stub
  /app/settings           SettingsPage        ✅
*                         → /app/timer (auth) o /login (guest)
```

---

## 6. Estado Global — Zustand (`timerStore`)

```ts
TimerStatus = 'idle' | 'running' | 'paused' | 'completed'
```

| Campo | Tipo | Descripción |
|---|---|---|
| status | TimerStatus | Estado actual del timer |
| sessionType | SessionType | 'work' \| 'short_break' \| 'long_break' |
| endsAt | number \| null | Timestamp ms de fin |
| remaining | number | ms restantes (actualizado por tick) |
| totalMs | number | Duración total de la sesión actual |
| pausedRemainingMs | number \| null | ms restantes al pausar |
| activeProjectId | string \| null | — |
| activeTaskId | string \| null | — |
| activeTagId | string \| null | — |
| activeSessionId | string \| null | ID de active_sessions en DB |

**Acciones:** `setRunning`, `setTick`, `setCompleted`, `setIdle`, `setPaused`, `setResumed`, `setTotalMs`, `setActiveProject`, `setActiveTag`, `setSessionType`

**UI state en localStorage:**
- `timerSidebarOpen` → persiste el estado del sidebar colapsable entre navegaciones

---

## 7. Hooks

### `useAuth()`
- Retorna: `{ user, session, loading }`
- Escucha `supabase.auth.onAuthStateChange` en toda la vida del app.

### `useTimer()`
Retorna: `{ status, sessionType, remaining, totalMs, pausedRemainingMs, start, startBreakPaused, pause, resume, stop, setSessionType }`

**Web Worker:**
- Se crea en mount: `new Worker(new URL('@/workers/timerWorker.ts', import.meta.url), { type: 'module' })`
- Recibe: `{ type: 'start', endsAt }` o `{ type: 'stop' }`
- Emite: `{ type: 'tick', remaining }` cada 1s, o `{ type: 'complete' }`

**On mount — restauración desde DB:**
1. Fetch `active_sessions` del usuario actual
2. Si `paused_remaining_ms != null` → restaurar como paused (con `setTotalMs`)
3. Si `ends_at > now` → restaurar como running (iniciar Worker)
4. Si `ends_at ≤ now` y es work → llamar `finishExpiredSession()` (guarda en sessions)
5. Si `ends_at ≤ now` y es break → borrar y ir a idle

**Visibilitychange:** al volver a la pestaña, recalcula `remaining = endsAt - Date.now()`.

**Funciones:**
- `start(durationMs)`: upsert en active_sessions (con tag_id, project_id), inicia Worker, llama `setRunning`
- `startBreakPaused(durationMs, type)`: upsert con `paused_remaining_ms = durationMs`, estado paused
- `pause()`: para Worker, actualiza `paused_remaining_ms` en DB, llama `setPaused`
- `resume()`: calcula nuevo `ends_at = now + pausedRemainingMs`, actualiza DB, reinicia Worker
- `stop()`: para Worker, borra active_session, llama `setIdle`

⚠️ **Requiere migración 002** para las columnas `tag_id` y `paused_remaining_ms`. Sin ellas el upsert falla y el timer no inicia (muestra toast de error).

### `useSession()`
- `completeSession()` *(sin parámetros)*:
  1. Fetch `active_session` actual del usuario
  2. Usa RPC `finish_active_work_session(true)` para guardar y limpiar atómicamente
  3. La duración completa se guarda desde `active_sessions.total_ms`
  4. INSERT en `sessions` usa valores del DB (`project_id`, `task_id`, `tag_id`)
  5. DELETE de `active_sessions` ocurre dentro de la RPC
  6. Invalida queries: `['sessions']`, `['stats']`, `['projectHours']`, `['todayProjectHours']`, `['projectStats', project_id]`, `['projectSessions', project_id]`
  7. Llama `setIdle()`

**⚠️ Decisión clave:** usa valores del DB (no del store) para garantizar integridad si el store divergió o si la página fue recargada (en cuyo caso `startedAtRef` sería null).

---

## 8. Componentes del Timer

### `CircularTimerRing`
SVG 256×256px. Centro en (128,128).

**Geometría:**
- `RING_R = 112` — Radio del anillo
- `RING_W = 10` — Grosor del trazo
- `CLOCK_R = 94` — Radio de la cara del reloj (fill card)
- `HANDLE_R = 9` — Radio del circulito arrastrable

**Modos:**

*Idle:*
- El handle (circulito) está en el extremo del arco de duración
- `5 min = 0° (12 en punto)`, `120 min = 360° (misma posición, vuelta completa)`
- Arco en opacity 0.35 (preview de duración)
- Arrastrar el handle cambia la duración en pasos de 5 min
- **Anti-wrap:** `prevAngleRef` detecta si el drag cruza el tope en dirección incorrecta y bloquea en min/max
- Muestra label de duración bajo el tiempo

*Running:*
- Arco lleno (opacity 1) que se llena progresivamente (`elapsed/total`)
- Transición CSS `stroke-dashoffset 1s linear` sincronizada con los ticks del Worker
- Sin handle arrastrable

*Paused:*
- Arco congelado en el momento de pausa

**Drag implementation:**
- `prevAngleRef` se inicializa en `startDrag` con el ángulo correspondiente a `durationMin` actual
- Listeners globales `mousemove/mouseup` y `touchmove/touchend` en window
- `angleToMin(clientX, clientY)` convierte coordenadas → duración en minutos (snapped a múltiplos de 5)

### `TagSelector`
Chips horizontales con `flex-wrap`.
- "Sin tag": seleccionado = `bg-primary text-primary-foreground`; no seleccionado = `bg-muted/40`
- Tags: seleccionado = `backgroundColor/borderColor = tag.color`, dot blanco; no seleccionado = `bg-muted/40`, dot de color
- Toggle: click en el seleccionado lo deselecciona

---

## 9. Páginas Implementadas

### `TimerPage` (`/app/timer`)

**Estado local:**
- `customWorkMin` — Duración custom (override del config)
- `showTagMenu` / `showProjectMenu` — Popovers de selección
- `sidebarOpen` — Sidebar desktop abierto/cerrado (persiste en `localStorage`)

**Query keys:**
- `['timerConfig', userId]` — Config del timer
- `['tags', userId]` — Tags disponibles
- `['projects', 'timer', userId]` — Proyectos activos con campos extendidos (`id, name, color, type, goal_hours, exam_date`). Key separada de `['projects', userId]` para evitar conflicto de cache con ProjectsPage
- `['projectHours', userId]` — Horas totales por proyecto (comparte cache con ProjectsPage)
- `['todayProjectHours', userId]` — Horas de HOY por proyecto (para "Pendientes hoy")
- `['sessions', 'today', userId]` — Sesiones de hoy (work, last 20)

**Pills de Tag y Proyecto:**
- `const pillLocked = !isIdle` — Solo interactivos cuando `status === 'idle'`
- Durante running, paused, break → opacity-60, cursor-default, no abren popover
- Tag pill: muestra `SESSION_LABELS[sessionType]` + nombre del tag en su color
- Proyecto pill: muestra punto de color + nombre del proyecto
- Popovers con `animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`

**Sidebar desktop (w-72, colapsable):**
- Estado persiste en `localStorage.getItem('timerSidebarOpen')`
- **Sección "Pendientes hoy"** (si hay proyectos con meta diaria sin cumplir):
  - Cards con el mismo diseño que ProjectsPage: dot de color, nombre, badge Académico/Hobby, banner "X hs/día necesarias" (amber), barra de progreso, "X hs completadas / Y hs meta"
  - `getDailyGoal(project)`: academic → `goal_hours / daysLeft`; hobby → null (no aplica)
  - Se actualiza al completar sesiones (query invalidada por useSession)
- **Sección "Hoy"**: total horas en badge, lista de sesiones recientes con color de proyecto y duración en minutos

**Flujo al completar un pomodoro:**
```
status === 'completed' + sessionType === 'work'
  → await completeSession()    // fuente de verdad: DB. guarda session, setIdle()
  → toast "Pomodoro completado"
  → startBreakPaused(breakMs, breakType)  // aparece como paused
  → muestra break con botones: "Iniciar descanso" + "Saltar"
```
*(Secuenciado con async IIFE para evitar race condition entre setIdle y setPaused)*

**Controles según estado:**

| Estado | Botones mostrados |
|---|---|
| idle + work | Iniciar |
| running + work | Pausar + Detener |
| paused + work | Reanudar + Detener |
| paused + break | Iniciar descanso + Saltar |
| running + break | Pausar + Saltar |

---

### `ProjectsPage` (`/app/projects`)

**Queries:**
- `['projects', userId]` — `select('*')`, orden desc por created_at
- `['projectHours', userId]` — horas totales por proyecto (agrupadas en cliente)
- `['tags', userId]` — para el selector default_tag_id en el form

**Estado local:** `tab` (active/archived), `dialogOpen`, `editingProject`, `openMenuId`, `saving`, `form`

**Form:** nombre, tipo (hobby/academic toggle), color picker (`<Input type="color">`), `goal_hours` (con NaN guard: `!isNaN(parsed) && parsed > 0`), `exam_date` (solo si academic), `default_tag_id`

**Cards:** dot de color, nombre, badge tipo, barra de progreso, banner "X hs/día necesarias" (amber) solo si academic + daysLeft > 0, menú 3 puntos (editar / archivar / restaurar)

**Helper:** `calcHoursPerDay(project, completedHours)` → `(goal_hours - completedHours) / daysLeft`

---

### `ProjectDetailPage` (`/app/projects/:id`)

**Queries:**
- `['project', id]` — datos del proyecto
- `['tasks', id]` — lista de tareas del proyecto
- `['projectSessions', id]` — sesiones con tag (`.limit(50)`) para display
- `['projectStats', id]` — solo `duration_seconds, started_at` **sin limit** para stats correctas

**Stats:** `totalHours` y `sessionsThisWeek` se calculan sobre `['projectStats']` (sin limit), no sobre `['projectSessions']` (que tiene limit 50).

**Tareas:** crear (Enter), completar (toggle), eliminar. `handleCreateTask` usa `try/finally` para resetear `savingTask` aunque falle.

---

### `StatsPage` (`/app/stats`)

**Queries:**
- `['stats', userId, period]` — sesiones del período con joins a projects y tags
- `['allSessionDays', userId]` — fechas de todas las sesiones para calcular racha

**Período:** `'day' | 'week' | 'month'`, selector con tabs inline.

**Gráfico:** `LineChart` de Recharts con datos ACUMULADOS (no por día):
- `buildChartData()` suma `cumulative` progresivamente día a día
- `dot={false}`, `activeDot={{ r: 5 }}` — punto aparece solo al hover
- `stroke={lineColor}` donde `lineColor` se lee vía `getComputedStyle(document.documentElement).getPropertyValue('--primary')` (necesario porque las CSS vars son OKLCH y no se resuelven como atributos SVG)
- Se recalcula con `resolvedTheme` de `next-themes` al cambiar tema

**Desglose:** por proyecto y por categoría/tag, con barras proporcionales coloreadas y duración en formato `Xh Ym` (`formatHoursMinutes(hours)`).

**Racha:** `calcStreak(days)` — cuenta días consecutivos hacia atrás desde hoy.

---

### `SettingsPage` (`/app/settings`)

**Card "Apariencia":** toggle Claro / Oscuro / Sistema con `useTheme()` de next-themes.

**Card "Timer":** configuración de `work_min`, `short_break_min`, `long_break_min`, `pomodoros_per_cycle`. Upsert con `onConflict: 'user_id'`.

---

### `LoginPage` / `SignupPage`

- Login: `supabase.auth.signInWithPassword()`
- Signup: `supabase.auth.signUp()` con username en metadata → trigger auto-crea perfil
- Signup muestra pantalla de confirmación de email tras registrarse

---

## 10. Páginas Sociales

### `SocialPage` ✅ (`/app/social`)

**Tabs:** "Grupos" | "Amigos"

**Tab Grupos:**
- Cards de grupos con avatar colorido (color generado deterministicamente del nombre con `groupColor(name)`)
- Conteo de miembros en tiempo real vía RPC `get_my_groups()` (una sola query, sin waterfall)
- "Crear grupo" → dialog con preview del avatar, UUID generado en cliente
- Click en card → navega a `/app/social/groups/:id`

**Tab Amigos:**
- Búsqueda debounced (400ms, mínimo 2 chars) por username en `profiles`
- Resultados con estado: Agregar / Solicitud enviada / Amigos
- Solicitudes recibidas: fondo azulado con badge de conteo
- Lista de amigos aceptados en grid 2 columnas
- Botón "Invitar" con popover dropdown para elegir grupo

**Query keys:**
- `['myGroups', userId]` — RPC `get_my_groups()`, staleTime: 30s
- `['friends', userId]` — amigos aceptados con perfil, staleTime: 30s
- `['friendRequests', userId]` — solicitudes pendientes, staleTime: 0

**Decisión clave:** la creación de grupo usa `crypto.randomUUID()` en cliente y hace INSERT sin `.select()`. Si usáramos `.insert().select('id')`, el RETURNING fallaría porque la policy SELECT de `study_groups` usa `auth_is_group_member()` y el usuario aún no está en `study_group_members` al momento del RETURNING.

---

### `StudyGroupPage` ✅ (`/app/social/groups/:id`)

**Header:** avatar del grupo con inicial + color, nombre, conteo de miembros, indicador "En tiempo real".

**Leaderboard:**
- RPC `get_group_leaderboard(p_group_id)` — horas de trabajo desde `joined_at` de cada miembro
- Top 3: fondos dorado/plateado/bronce, texto más grande, horas en color del metal
- Resto: filas compactas con posición numérica
- Si `total_seconds === 0`: muestra "Sin sesiones" en itálica
- Barra de progreso relativa al primer lugar (solo cuando el líder tiene tiempo > 0)
- `Number(entry.total_seconds)` — coerción explícita (bigint de PostgreSQL puede llegar como string)

**Realtime:** suscripción `postgres_changes` INSERT en `sessions` → invalida `['groupLeaderboard', groupId]`. Con la policy "sessions: group members can read", Realtime entrega eventos de todos los miembros del grupo.

**Invite dialog:** lista de amigos que NO están ya en el grupo (filtra por `groupMembers` query, enabled solo cuando el dialog está abierto).

**Query keys:**
- `['groupDetails', groupId]` — nombre + created_by, staleTime: 30s
- `['groupLeaderboard', groupId]` — RPC, staleTime: 0
- `['groupMembers', groupId]` — user_ids del grupo (solo con invite abierto), staleTime: 0

---

## 11. Flujos de Datos Clave

### Flujo del Timer (completo)

```
Usuario presiona "Iniciar"
  → handleStart() → useTimer.start(durationMs)
    → supabase.upsert active_sessions (project_id, tag_id, onConflict: user_id)
    → timerStore.setRunning(endsAt, sessionId, durationMs)
    → Worker.postMessage({ type: 'start', endsAt })

Worker tick cada 1s:
  → timerStore.setTick(remaining)
  → React re-render con nuevo tiempo

Worker completa:
  → timerStore.setCompleted()
  → TimerPage useEffect detecta status === 'completed'
    → await completeSession()           // lee todo de DB, no del store
      → supabase.insert sessions (project_id = active.project_id, etc.)
      → supabase.delete active_sessions
      → timerStore.setIdle()
    → toast "Pomodoro completado"
    → startBreakPaused(breakMs, breakType)
      → supabase.upsert active_sessions (paused_remaining_ms = breakMs)
      → timerStore.setPaused(breakMs)
```

### Flujo de Pausa/Reanudación

```
Pausar:
  → Worker.postMessage({ type: 'stop' })
  → supabase.update active_sessions SET paused_remaining_ms = remaining
  → timerStore.setPaused(remaining)

Reanudar:
  → newEndsAt = Date.now() + pausedRemainingMs
  → supabase.update active_sessions SET ends_at = newEndsAt, paused_remaining_ms = null
  → timerStore.setResumed(newEndsAt)
  → Worker.postMessage({ type: 'start', endsAt: newEndsAt })
```

### Restauración al recargar la página

```
useTimer mount:
  → fetch active_sessions WHERE user_id = auth.uid()
  → Si paused_remaining_ms != null → setPaused (break o trabajo pausado)
  → Si ends_at > now → setRunning + iniciar Worker
  → Si ends_at ≤ now + session_type = 'work' → finishExpiredSession()
  → Si ends_at ≤ now + session_type = break → delete, setIdle
```

---

## 12. Decisiones Arquitectónicas

1. **Todo en Supabase, no localStorage.** Permite abrir desde otro dispositivo/pestaña y retomar el estado exacto. Excepción: `timerSidebarOpen` en localStorage (preferencia UI pura, no datos).

2. **Web Worker para el timer.** Los navegadores throttlean `setInterval` en pestañas inactivas (hasta 1 tick/min). El Worker no está sujeto a esto. El tiempo real siempre se calcula como `ends_at - Date.now()`.

3. **`active_sessions` como persistencia del timer.** La sesión activa existe en DB desde que se presiona "Iniciar". Si se cierra la pestaña y se vuelve, se retoma desde `ends_at`.

4. **`sessions` como log inmutable.** Append-only. Toda estadística se calcula sobre este log. Nunca se edita una sesión completada.

5. **No usar el generic `createClient<Database>()`** debido a un bug de TypeScript donde el generic retorna `never`. Se usa `as TypeName` explícito en los hooks.

6. **Race condition en break:** `completeSession()` llama `setIdle()` y `startBreakPaused()` llama `setPaused()`. Se secuencian con `await` en un IIFE para garantizar que `setIdle` ocurra antes de `setPaused`.

7. **Shadcn con Windows path bug.** Al instalar componentes con `npx shadcn add`, los archivos se crean en `@\components\ui\`. Solución: `Copy-Item "@\components\ui\*.tsx" "src\components\ui\"`.

8. **`useSession.completeSession()` sin parámetros.** Lee toda la información de la `active_session` en DB para evitar que valores stale del store o un `startedAtRef` null (tras reload de página) corrompan los datos.

9. **Query key separada para proyectos en TimerPage.** `['projects', 'timer', userId]` vs `['projects', userId]` en ProjectsPage — ambos seleccionan campos distintos, tener la misma key haría que una query sobreescriba el cache de la otra con datos incompletos.

10. **CSS variables OKLCH en Recharts.**
11. **RLS recursión en tablas de grupos.** Las policies SELECT de `study_group_members` y `study_groups` eran auto-referenciales → infinita recursión. Fix: función `auth_is_group_member(uuid)` con `SECURITY DEFINER` que bypasea RLS para el check de membresía (migración 004).

12. **INSERT de grupos sin RETURNING.** La creación de grupos usa `crypto.randomUUID()` en cliente y NO hace `.select()` después del INSERT. Si usáramos INSERT+RETURNING, el SELECT post-INSERT fallaría: la policy SELECT de `study_groups` llama a `auth_is_group_member()` pero el usuario aún no está en `study_group_members` al momento del RETURNING, bloqueando el resultado con `42501`.

13. **`@base-ui/react/tabs` layout.** El componente `Tabs` de shadcn/base-ui necesita `className="flex-col"` explícito para que la lista de tabs quede arriba y el contenido abajo. Sin eso renderiza en `flex-row` (lista a la izquierda, contenido a la derecha) porque el selector CSS interno usa `data-horizontal:flex-col` pero el atributo DOM que setea base-ui es `data-orientation="horizontal"`.

14. **Bigint de PostgreSQL en cliente JS.** Los campos `bigint` de RPCs (e.g. `total_seconds`) pueden llegar como `string` en el cliente JavaScript. Siempre coercionar con `Number(value)` antes de operar aritméticamente.

 Las variables de tema están definidas como `--primary: oklch(0.985 0 0)` (con la función ya incluida). Pasar `stroke="hsl(var(--primary))"` a Recharts genera CSS inválido. Solución: leer el valor real con `getComputedStyle(document.documentElement).getPropertyValue('--primary')` y pasarlo directamente. Se recalcula con `resolvedTheme` de next-themes al cambiar tema.

---

## 13. Variables de Entorno

```env
VITE_SUPABASE_URL=https://hbamecikpourbayilyen.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_p9lfcKX7SYUPsBmrqTcXhA_93bke16q
```

⚠️ No agregar `/rest/v1/` al final de la URL (error conocido previo).

---

## 14. Estado de Implementación

### ✅ Implementado y funcional

- [x] Auth: login, signup, logout, sesión persistente
- [x] Timer Pomodoro con Web Worker (sin throttling en background)
- [x] Persistencia del timer en Supabase (`active_sessions`)
- [x] Restauración del timer al recargar / cambiar de pestaña
- [x] Pausa y reanudación del timer (con persistencia en DB)
- [x] Flujo de descanso: break aparece pausado, usuario decide iniciar/saltar
- [x] Break con pausa/reanudación/skip
- [x] Anillo SVG circular con progreso y handle arrastrable (5–120 min, snap a 5 min)
- [x] Tag system: tags del sistema + tags de usuario
- [x] Pills de Tag y Proyecto con color tintado, popovers animados
- [x] Pills bloqueados (`!isIdle`) — solo editables cuando el timer está detenido
- [x] Sidebar colapsable con animación width (desktop), estado persistido en localStorage
- [x] Sidebar "Pendientes hoy": cards con progreso de proyectos con meta diaria sin cumplir
- [x] Historial de sesiones de hoy
- [x] ProjectsPage: lista de proyectos activos/archivados, CRUD modal, progreso vs meta, banner "X hs/día"
- [x] ProjectDetailPage: tareas CRUD, historial de sesiones, stats con query sin limit
- [x] StatsPage: LineChart acumulado (Recharts), formatHoursMinutes, desglose por proyecto y tag, racha
- [x] Dark mode: ThemeProvider (next-themes), toggle Claro/Oscuro/Sistema en Settings
- [x] Settings: configuración de duración, ciclos y tema
- [x] **SocialPage**: tabs Grupos + Amigos, crear grupos, buscar usuarios por username, solicitudes de amistad, invitar amigos a grupos (2026-06-03)
- [x] **StudyGroupPage**: leaderboard en tiempo real (Supabase Realtime), top 3 con estilos metálicos, invitar amigos, salir del grupo (2026-06-03)

### ⏳ Pendiente de implementar

- [ ] **PWA** — `vite-plugin-pwa` para manifest + service worker

---

## 15. TO DO inmediato

### Alta prioridad

1. **Aplicar migraciones 003, 004, 005** si no se aplicaron (ver sección 4). Todas las features sociales dependen de ellas.

### Baja prioridad

2. **PWA / instalar como app** — `vite-plugin-pwa`
3. **OAuth (Google)** — `supabase.auth.signInWithOAuth()`
4. **Mobile UX** — Sidebar debajo del timer en mobile ocupa mucho espacio

---

## 16. Mejoras Técnicas Identificadas

| Área | Mejora | Prioridad |
|---|---|---|
| Bundle size | Usar `React.lazy` para páginas — bundle ~1.07MB sin splitting | Media |
| Mobile UX | Sidebar en mobile ocupa mucho espacio — considerar accordion | Media |
| Errores de Supabase | Los errores de queries no se muestran al usuario (solo start() tiene toast) | Media |
| `active_sessions` | Podría almacenar `totalMs` para evitar calcular desde `ends_at - started_at` | Baja |
| Timer ring | La transición idle→running tiene un "flash" visual al resetear el arco | Baja |
| Auth | No hay OAuth (Google). `supabase.auth.signInWithOAuth()` disponible | Baja |
| Stats | Milestones/logros (primera sesión, 10 horas, 100 sesiones) | Baja |

---

## 17. Comandos Útiles

```bash
# Dev server
npm run dev

# Build de producción
npm run build

# TypeScript check
npx tsc --noEmit

# Agregar componente shadcn (en Windows: luego mover de @\components\ui\ a src\components\ui\)
npx shadcn@4.7.0 add <component>

# Preview del build
npm run preview
```

---

## 18. Notas de Windows / Entorno

- **shadcn en Windows:** `npx shadcn add` crea archivos en `@\components\ui\` por el alias `@/`. Siempre moverlos manualmente:
  ```powershell
  Copy-Item "@\components\ui\*.tsx" "src\components\ui\"
  Remove-Item "@\" -Recurse
  ```

- **Puerto dev:** `5173` (Vite default)
- **Launch config:** `.claude/launch.json` → `pomo-dev` en puerto 5173

---

## 19. Notas Técnicas Importantes

### CSS Variables OKLCH en SVG (Recharts)

Las variables de tema en `index.css` usan OKLCH con función incluida:
```css
:root { --primary: oklch(0.205 0 0); }
.dark { --primary: oklch(0.985 0 0); }
```

**Problema:** Pasar `stroke="hsl(var(--primary))"` a Recharts como prop resulta en el SVG attribute `stroke="hsl(oklch(...))"` — CSS inválido, línea invisible.

**Solución correcta:**
```ts
const { resolvedTheme } = useTheme()
const lineColor = useMemo(
  () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  [resolvedTheme]
)
// → "oklch(0.985 0 0)" — ya es un color CSS válido
```

Misma restricción aplica para `fill` en `<Bar>`, `cursor.fill` en `<Tooltip>`, etc. Usar siempre `rgba()` o colores hex para props de Recharts que terminan como atributos SVG.

### Cache keys de TanStack Query — evitar colisiones

| Key | Archivo | staleTime | Descripción |
|---|---|---|---|
| `['projects', userId]` | ProjectsPage | 30s | `select('*')` |
| `['projects', 'timer', userId]` | TimerPage | 30s | `select('id,name,color,type,goal_hours,exam_date')` |
| `['projectHours', userId]` | TimerPage + ProjectsPage | 0 | compartida |
| `['projectSessions', id]` | ProjectDetailPage | 0 | `*, tags(...)` con `.limit(50)` |
| `['todayProjectHours', userId]` | TimerPage | 0 | horas de hoy por proyecto |
| `['sessions', 'today', userId]` | TimerPage sidebar | 0 | — |
| `['stats', userId, period]` | StatsPage | 0 | — |
| `['allSessionDays', userId]` | StatsPage | 0 | streak |
| `['timerConfig', userId]` | TimerPage + SettingsPage | Infinity | — |
| `['tags', userId]` | TimerPage + ProjectsPage + SettingsPage | Infinity | — |
| `['project', id]` | ProjectDetailPage | 30s | — |
| `['tasks', id]` | ProjectDetailPage | 30s | — |
| `['myGroups', userId]` | SocialPage | 30s | RPC `get_my_groups()` — grupos + member_count |
| `['friends', userId]` | SocialPage + StudyGroupPage | 30s | amigos aceptados con perfil |
| `['friendRequests', userId]` | SocialPage | 0 | solicitudes pendientes entrantes |
| `['groupDetails', groupId]` | StudyGroupPage | 30s | nombre + created_by del grupo |
| `['groupLeaderboard', groupId]` | StudyGroupPage | 0 | RPC `get_group_leaderboard()` |
| `['groupMembers', groupId]` | StudyGroupPage | 0 | solo cuando invite dialog está abierto |
