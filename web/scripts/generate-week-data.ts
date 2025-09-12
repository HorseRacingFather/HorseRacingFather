// scripts/generate-week-data.ts
import fs from 'fs-extra'
import path from 'path'
import dayjs from 'dayjs'
import cheerio from 'cheerio'

// Data directories
const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'data')

// Sources
const NETKEIBA_CALENDAR = 'https://race.netkeiba.com/top/calendar.html'
const JRA_CALENDAR = 'https://www.jra.go.jp/keiba/calendar/'

// Minimal HTTP fetch with polite headers
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'HorseRacingFatherBot/0.1 (+https://github.com/)'
    }
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return await res.text()
}

function getTargetWeekend(today = dayjs()): { saturday: dayjs.Dayjs; sunday: dayjs.Dayjs } {
  const day = today.day() // 0 Sun ... 6 Sat
  const satOffset = (6 - day + 7) % 7
  const sunOffset = (7 - day + 7) % 7
  return {
    saturday: today.add(satOffset, 'day'),
    sunday: today.add(sunOffset, 'day'),
  }
}

// Very lightweight parse placeholders (structure may vary)
async function collectRaces(): Promise<any[]> {
  // NOTE: For initial version we do not deeply parse.
  // We will create a minimal race with dummy entries for the coming weekend.
  const { saturday, sunday } = getTargetWeekend()
  const raceDays = [saturday, sunday]
  const races: any[] = []

  for (const d of raceDays) {
    const dateStr = d.format('YYYY-MM-DD')
    // Create 2 dummy races per day
    for (let r = 1; r <= 2; r += 1) {
      const raceId = `${d.format('YYYYMMDD')}NAKAYAMA${r.toString().padStart(2, '0')}`
      const entries = Array.from({ length: 8 }).map((_, i) => {
        const horseNumber = i + 1
        const rng = Math.abs(Math.sin(Number(`${d.format('YYYYMMDD')}${r}${horseNumber}`)))
        const score = Number((rng).toFixed(2))
        return {
          horseId: `h_${raceId}_${horseNumber}`,
          horseNumber,
          name: `ホース${horseNumber}`,
          sexAge: '牡3',
          jockey: `騎手${horseNumber}`,
          weight: 56,
          odds: null,
          popularity: null,
          predictionScore: score,
        }
      })
      const sorted = [...entries].sort((a, b) => b.predictionScore - a.predictionScore)
      sorted.forEach((e, idx) => (e.predictionRank = idx + 1))

      races.push({
        raceId,
        date: dateStr,
        course: '中山',
        grade: null,
        name: `ダミーレース ${r}`,
        distance: 1600,
        surface: '芝',
        turn: '右',
        entries,
      })
    }
  }

  return races
}

async function main() {
  await fs.ensureDir(DATA_DIR)

  const now = dayjs()
  const weekKey = getTargetWeekend(now).saturday.format('YYYY-MM-DD')
  const races = await collectRaces()
  const payload = {
    generatedAt: dayjs().toISOString(),
    week: weekKey,
    sources: {
      netkeibaCalendar: NETKEIBA_CALENDAR,
      jraCalendar: JRA_CALENDAR,
    },
    races,
  }

  const outDir = path.join(DATA_DIR, now.format('YYYY'))
  await fs.ensureDir(outDir)
  const outPath = path.join(outDir, `${weekKey}.json`)
  await fs.writeJson(outPath, payload, { spaces: 2 })
  console.log(`Generated: ${path.relative(ROOT, outPath)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
