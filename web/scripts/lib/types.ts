export type Entry = {
  horseId: string
  horseNumber: number
  name: string
  sexAge: string
  jockey: string
  weight: number
  odds: number | null
  popularity: number | null
  predictionScore: number
  predictionRank?: number
  horseDbUrl?: string
  horseBrief?: {
    lastResultDate?: string
    lastResultName?: string
    lastFinish?: string
  }
}

export type Race = {
  raceId: string
  date: string
  course: string
  grade: string | null
  name: string
  distance: number | null
  surface: string | null
  turn: string | null
  going?: string | null
  sources?: { sp?: string; pc?: string }
  entries: Entry[]
}

export type WeekPayload = {
  generatedAt: string
  week: string
  sources: { netkeibaCalendar: string }
  races: Race[]
}

