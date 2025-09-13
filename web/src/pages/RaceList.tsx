import { Link } from 'react-router-dom'
import type { Race } from '../types'

export default function RaceList({ grouped }: { grouped: Record<string, Race[]> }) {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">競馬予想AI</h1>
      </header>
      <div className="space-y-8">
        {Object.entries(grouped).map(([group, races]) => (
          <section key={group}>
            <h2 className="text-xl font-semibold mb-3">{group}</h2>
            <ul className="space-y-2">
              {races.map((race) => (
                <li key={race.raceId} className="text-sm sm:text-base">
                  <Link className="hover:underline" to={`/race/${race.raceId}`}>
                    {formatRaceHeader(race)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}

function getRaceNo(raceId: string): number {
  const n = Number(raceId.slice(-2))
  return Number.isFinite(n) ? n : 0
}

function formatRaceHeader(race: Race): string {
  const left = `${race.course} 第${getRaceNo(race.raceId)}R`
  return left
}

