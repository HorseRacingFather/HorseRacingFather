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
    case 'rank':
      return arr.sort((a, b) => a.predictionRank - b.predictionRank || a.horseNumber - b.horseNumber)
    default:
      return arr
  }
}

// 予着順での並び替えは sortEntries('rank') を利用

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
          <option value="rank">予着順</option>
        </select>
      </div>
      <table className="w-full mt-3 text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 w-12">馬番</th>
            <th className="py-1">馬名</th>
            <th className="py-1 w-16 text-right">予着</th>
          </tr>
        </thead>
        <tbody>
          {sortEntries(race.entries, sort).map((e) => (
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
              <td className="py-1 text-right">{e.predictionRank}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


