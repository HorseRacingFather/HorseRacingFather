import { useEffect, useMemo, useState } from 'react'

type Entry = {
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

type SortKey = 'number' | 'prediction' | 'popularity'

function useWeeklyData() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const base = (import.meta as any).env?.BASE_URL ?? '/'
        const isDev = (import.meta as any).env?.DEV ?? false

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
        const absRoot  = (d: string) => originAbs(`/data/${yyyy}/${d}.json`)
        const current  = originAbs(`/data/current.json`)

        // dev: 絶対 /data を優先、本番: base 付きを優先
        const order = isDev ? [absRoot, withBase] : [withBase, absRoot]

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
  const [sort, setSort] = useState<SortKey>('number')

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
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">今週のレース</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">更新: {new Date(data.generatedAt).toLocaleString()}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
          {([
            ['number', '馬番順'],
            ['prediction', '予想勝率順'],
            ['popularity', '人気順'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-3 py-1 rounded text-sm ${sort === k ? 'bg-white dark:bg-slate-700 shadow' : 'opacity-70'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-8">
        {Object.entries(grouped).map(([group, races]) => (
          <section key={group}>
            <h2 className="text-xl font-semibold mb-3">{group}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {races.map((race) => (
                <article key={race.raceId} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 backdrop-blur p-4 shadow-sm">
                  <div className="flex items-center">
                    <h3 className="font-semibold text-sm sm:text-base">{formatRaceHeader(race)}</h3>
                    {race.sources?.sp && (
                      <a href={race.sources.sp} target="_blank" rel="noreferrer" className="ml-auto text-xs text-blue-600 hover:underline">netkeiba</a>
                    )}
                  </div>
                  <table className="w-full mt-3 text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 w-12">馬番</th>
                        <th className="py-1">馬名</th>
                        <th className="py-1 w-24 text-right">予想勝率(%)</th>
                        <th className="py-1 w-16 text-right">人気</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortEntriesWithProb(race.entries, sort).map((e) => (
                        <tr key={e.horseId} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-1">{e.horseNumber}</td>
                          <td className="py-1">
                            <div className="font-medium">
                              {e.horseDbUrl ? (
                                <a href={e.horseDbUrl} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a>
                              ) : e.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {e.sexAge} / {e.jockey} / {e.weight}kg
                              {e.horseBrief?.lastResultName && (
                                <>
                                  {' '}· 最終: {e.horseBrief.lastResultDate ?? ''} {e.horseBrief.lastResultName} {e.horseBrief.lastFinish ? `${e.horseBrief.lastFinish}着` : ''}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-1 text-right">{formatProb(percentProb(race.entries, e.horseId))}</td>
                          <td className="py-1 text-right">{e.popularity ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function sortEntries(entries: Entry[], key: SortKey): Entry[] {
  const arr = [...entries]
  switch (key) {
    case 'number':
      return arr.sort((a, b) => a.horseNumber - b.horseNumber)
    case 'prediction':
      return arr.sort((a, b) => (b.predictionScore - a.predictionScore) || (a.horseNumber - b.horseNumber))
    case 'popularity':
      return arr.sort((a, b) => {
        if (a.popularity == null && b.popularity == null) return a.horseNumber - b.horseNumber
        if (a.popularity == null) return 1
        if (b.popularity == null) return -1
        return a.popularity - b.popularity
      })
    default:
      return arr
  }
}

export default App

function getRaceNo(raceId: string): number {
  const n = Number(raceId.slice(-2))
  return Number.isFinite(n) ? n : 0
}

function formatRaceHeader(race: Race): string {
  const left = `${race.course} 第${getRaceNo(race.raceId)}R`
  const distance = race.distance ? `${race.distance}m` : ''
  const turn = race.turn || ''
  const surface = race.surface || ''
  const right = [surface, distance, turn].filter(Boolean).join('')
  return right ? `${left}（${right}）` : left
}

function percentProb(entries: Entry[], horseId: string): number {
  const sum = entries.reduce((s, e) => s + Math.max(0, e.predictionScore || 0), 0)
  if (!sum) return 0
  const e = entries.find((x) => x.horseId === horseId)
  if (!e) return 0
  return (Math.max(0, e.predictionScore || 0) / sum) * 100
}

function formatProb(p: number): string {
  return p.toFixed(1)
}

function sortEntriesWithProb(entries: Entry[], key: SortKey): Entry[] {
  if (key !== 'prediction') return sortEntries(entries, key)
  const sum = entries.reduce((s, e) => s + Math.max(0, e.predictionScore || 0), 0)
  if (!sum) return sortEntries(entries, 'number')
  const arr = [...entries]
  return arr.sort((a, b) => {
    const pa = Math.max(0, a.predictionScore || 0) / sum
    const pb = Math.max(0, b.predictionScore || 0) / sum
    if (pb !== pa) return pb - pa
    return a.horseNumber - b.horseNumber
  })
}
