import { useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import RaceDetail from './pages/RaceDetail'
import RaceList from './pages/RaceList'

type Entry = {
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

type Race = {
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

type Data = {
  generatedAt: string
  week: string
  races: Race[]
}

//

function useWeeklyData() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const base = (import.meta as any).env?.BASE_URL ?? '/'

        // ローカル日付で YYYY-MM-DD を作る（UTCずれ回避）
        const fmt = (date: Date) => {
          const y = date.getFullYear()
          const m = String(date.getMonth() + 1).padStart(2, '0')
          const dd = String(date.getDate()).padStart(2, '0')
          return `${y}-${m}-${dd}`
        }

        const now = new Date()
        const yyyy = now.getFullYear()
        const today = fmt(new Date())
        const sat = new Date()
        const day = sat.getDay() // 0 Sun ... 6 Sat
        const satOffset = (6 - day + 7) % 7
        sat.setDate(sat.getDate() + satOffset)
        const saturday = fmt(sat)

        // ±1日フォールバック（念のため）
        const satMinus1 = (() => { const d = new Date(sat); d.setDate(d.getDate()-1); return fmt(d) })()
        const satPlus1  = (() => { const d = new Date(sat); d.setDate(d.getDate()+1); return fmt(d) })()

        const originAbs = (path: string) => new URL(path, window.location.origin).toString()
        const withBase = (d: string) => originAbs(`${base}data/${yyyy}/${d}.json`)
        const absRoot  = (d: string) => originAbs(`${base}data/${yyyy}/${d}.json`)
        const current  = originAbs(`${base}data/current.json`)

        // dev: 絶対 /data を優先、本番: base 付きを優先
        const order = [withBase, absRoot]

        const candidates = dedupe([
          current,
          ...[today, saturday, satMinus1, satPlus1].flatMap((d) => order.map((f) => f(d))),
        ])

        const json = await fetchJsonFromCandidates<Data>(candidates)
        setData(json)
      } catch (e: any) {
        setError(e.message ?? String(e))
      }
    }
    load()
  }, [])

  return { data, error }
}

async function fetchJsonFromCandidates<T>(urls: string[]): Promise<T> {
  const tried: string[] = []
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        tried.push(`${url} [${res.status}]`)
        continue
      }
      // Content-Typeに依存せずまずJSONとして解釈を試みる（開発サーバでtext/plainの場合がある）
      try {
        return (await res.json()) as T
      } catch (e) {
        tried.push(`${url} [invalid JSON]`)
        continue
      }
    } catch (err) {
      tried.push(`${url} [exception]`)
      continue
    }
  }
  throw new Error(`データ取得に失敗しました。試行URL: ${tried.join(', ')}`)
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function App() {
  const { data, error } = useWeeklyData()

  const grouped = useMemo(() => {
    if (!data) return {}
    return data.races.reduce<Record<string, Race[]>>((acc, r) => {
      const key = `${r.date} ${r.course}`
      acc[key] ||= []
      acc[key].push(r)
      return acc
    }, {})
  }, [data])

  if (error) return <div className="p-6 text-red-500">{error}</div>
  if (!data) return <div className="p-6">読み込み中...</div>

  return (
    <div className="min-h-screen flex flex-col px-[5%] py-4">
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<RaceList grouped={grouped} />} />
          <Route path="/race/:raceId" element={<RaceDetail data={data} />} />
        </Routes>
      </main>
      <footer className="mt-6 text-xs text-slate-500 dark:text-slate-400">更新: {new Date(data.generatedAt).toLocaleString()}</footer>
    </div>
  )
}

//

export default App

//
