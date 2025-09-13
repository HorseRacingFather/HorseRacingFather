export type Entry = {
  horseId: string
  horseNumber: number
  name: string
  sexAge: string
  jockey: string
  weight: number
  odds: number | null
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
  distance: number
  surface: string
  turn: string
  going?: string | null
  sources?: { sp?: string; pc?: string }
  entries: Entry[]
}

export type Data = {
  generatedAt: string
  week: string
  races: Race[]
}

export type SortKey = 'number' | 'prediction'

