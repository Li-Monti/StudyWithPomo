type AcademicGoalProject = {
  type: 'hobby' | 'academic'
  goal_hours: number | null
  exam_date: string | null
}

export type AcademicDailyGoal = {
  hoursPerDay: number
  daysLeft: number
  remainingHours: number
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

export function calcAcademicDailyGoal(
  project: AcademicGoalProject,
  completedHours: number,
  nowMs: number,
): AcademicDailyGoal | null {
  if (project.type !== 'academic' || !project.exam_date || !project.goal_hours) return null

  const examDate = parseLocalDate(project.exam_date)
  if (!examDate) return null

  const daysLeft = Math.ceil((examDate.getTime() - nowMs) / 86_400_000)
  if (daysLeft <= 0) return null

  const remainingHours = Math.max(0, project.goal_hours - completedHours)

  return {
    hoursPerDay: remainingHours / daysLeft,
    daysLeft,
    remainingHours,
  }
}
