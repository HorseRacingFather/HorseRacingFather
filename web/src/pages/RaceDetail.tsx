import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Data, Entry, SortKey } from '../types'

function getRaceNo(raceId: string): number {
  const n = Number(raceId.slice(-2))
  return Number.isFinite(n) ? n : 0
}

function formatRaceHeader(race: Data['races'][number]): string {
  const left = `${race.course} 第${getRaceNo(race.raceId)}R`
  return left
}

function sortEntries(entries: Entry[], key: SortKey): Entry[] {
  const arr = [...entries]
  switch (key) {
    case 'number':
      return arr.sort((a, b) => a.horseNumber - b.horseNumber)
    case 'prediction':
      return arr.sort(
        (a, b) => b.predictionScore - a.predictionScore || a.horseNumber - b.horseNumber,
      )
    default:
      return arr
  }
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

export default function RaceDetail({ data }: { data: Data }) {
  const { raceId } = useParams()
  const nav = useNavigate()
  const race = useMemo(() => data.races.find((r) => r.raceId === raceId), [data, raceId])

  if (!race)
    return (
      <div className="p-4">
        該当レースが見つかりません。
        <button className="text-blue-600 underline" onClick={() => nav(-1)}>
          戻る
        </button>
      </div>
    )

  const [sort, setSort] = useState<SortKey>('number')

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="text-blue-600 hover:underline text-sm">
        ← 戻る
      </button>
      <h1 className="text-xl font-semibold">{formatRaceHeader(race)}</h1>
      {race.sources?.sp && (
        <div className="text-xs">
          <a
            href={race.sources.sp}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            netkeiba
          </a>
        </div>
      )}
      <div className="text-xs text-slate-600 dark:text-slate-300">
        並び替え：
        <select
          className="ml-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs bg-transparent"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="number">馬番順</option>
          <option value="prediction">予想勝率順</option>
        </select>
      </div>
      <table className="w-full mt-3 text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 w-12">馬番</th>
            <th className="py-1">馬名</th>
            <th className="py-1 w-24 text-right">予想勝率(%)</th>
          </tr>
        </thead>
        <tbody>
          {sortEntriesWithProb(race.entries, sort).map((e) => (
            <tr key={e.horseId} className="border-t border-slate-100 dark:border-slate-700">
              <td className="py-1">{e.horseNumber}</td>
              <td className="py-1">
                <div className="font-medium">
                  {e.horseDbUrl ? (
                    <a href={e.horseDbUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {e.name}
                    </a>
                  ) : (
                    e.name
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {e.sexAge} / {e.jockey} / {e.weight}kg
                </div>
              </td>
              <td className="py-1 text-right">{formatProb(percentProb(race.entries, e.horseId))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


