// scripts/generate-week-data.ts
import fs from 'fs-extra'
import path from 'path'
import dayjs from 'dayjs'
import { load } from 'cheerio'
import { fetchHtml, sleep } from './lib/http'
import { Entry, Race, WeekPayload } from './lib/types'
import { extractRaceId, fetchRaceIdsForDate, guessCourse, extractHorseNumber, fetchHorseBrief } from './lib/netkeiba'

// Data directories
const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'public', 'data')

// Source
const NETKEIBA_CALENDAR = 'https://race.netkeiba.com/top/calendar.html'


function getTargetWeekend(today = dayjs()): { saturday: dayjs.Dayjs; sunday: dayjs.Dayjs } {
  const day = today.day() // 0 Sun ... 6 Sat
  const satOffset = (6 - day + 7) % 7
  const sunOffset = (7 - day + 7) % 7
  return {
    saturday: today.add(satOffset, 'day'),
    sunday: today.add(sunOffset, 'day'),
  }
}

// Collect real races from netkeiba race list and shutuba pages
async function collectRaces(): Promise<any[]> {
  const { saturday, sunday } = getTargetWeekend()
  const raceDays = [saturday, sunday]
  const allRaces: any[] = []

  for (const d of raceDays) {
    const ymd = d.format('YYYYMMDD')
    const dateStr = d.format('YYYY-MM-DD')
    try {
      // 内部API/SPページから race_id を抽出
      const ids = await fetchRaceIdsForDate(ymd, path.join(ROOT, 'debug'))
      const raceLinks = Array.from(ids).map((id) => `https://race.sp.netkeiba.com/race/shutuba.html?race_id=${id}`)
      if (raceLinks.length === 0) {
        console.warn(`[warn] no race links found for ${ymd}`)
      }

      let dayCount = 0
      let processed = 0
      for (const shutubaUrl of raceLinks) {
        try {
          const race = await scrapeShutuba(shutubaUrl)
          if (!race) continue
          race.date = dateStr
          // 予想はフロント/外部で付与するため、ここでは設定しない
          allRaces.push(race)
          dayCount += 1
          processed += 1
          if (processed >= 3) break
        } catch (e) {
          // 個別レースの失敗はスキップ
          continue
        }
      }
      console.log(`[netkeiba] ${dateStr} races: ${dayCount}`)
    } catch (e) {
      // その日の一覧取得失敗はスキップ
      continue
    }
  }

  return allRaces
}

function normalizeNetkeibaUrl(href: string): string {
  if (href.startsWith('http')) return href
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `https://race.netkeiba.com${href}`
  return `https://race.netkeiba.com/${href.replace(/^\.\//, '')}`
}

async function scrapeShutuba(url: string): Promise<any | null> {
  const html = await fetchHtml(url)
  const $ = load(html)

  const raceId = extractRaceId(url) || ''
  if (!raceId) return null

  // デバッグ保存
  try {
    const debugDir = path.join(ROOT, 'debug')
    await fs.ensureDir(debugDir)
    await fs.writeFile(path.join(debugDir, `shutuba_${raceId}.html`), html)
  } catch {}

  // レース名、コースなど（構造変化に耐えるようにテキストベースで抽出）
  const title = $('h1, .RaceName, .RaceCommon__title, .RaceList_Name').first().text().trim() || 'レース'
  const course = guessCourse($)
  const meta = parseMetaFromHtml(html)
  const { distance, surface, turn, going } = meta

  // 出馬表テーブルの行抽出（SP構造優先）
  const entries: any[] = []
  let rows = $('tr.HorseList').toArray()
  if (rows.length === 0) rows = $('table.Shutuba_Table tbody tr').toArray()
  if (rows.length === 0) rows = $('table tbody tr').toArray()

  // ログ
  if (rows.length === 0) {
    console.warn(`[shutuba] no rows found for race ${raceId}`)
  } else {
    console.log(`[shutuba] rows=${rows.length} for race ${raceId}`)
  }

  const seenNumbers = new Set<number>()
  for (const tr of rows) {
    const row = $(tr)
    const horseNumber = extractHorseNumber($, row)
    if (!Number.isFinite(horseNumber) || horseNumber <= 0) continue
    if (seenNumbers.has(horseNumber)) continue

    // 馬名 + DBリンク
    const horseLink = row.find('dt.Horse.HorseLink a').first()
    let name = horseLink.text().trim()
    if (!name) name = row.find('.Horse_Info a').first().text().trim()
    const modalHref = horseLink.attr('href') || ''
    // 例: https://race.sp.netkeiba.com/modal/horse.html?race_id=...&horse_id=2023104768...
    const horseIdMatch = modalHref.match(/[?&]horse_id=(\d{7,})/)
    const horseDbUrl = horseIdMatch ? `https://db.netkeiba.com/horse/result/${horseIdMatch[1]}/` : undefined
    let horseBrief: Entry['horseBrief'] | undefined
    if (horseDbUrl) {
      try {
        const brief = await fetchHorseBrief(horseDbUrl)
        horseBrief = brief
      } catch {}
    }
    if (!name) continue

    // 騎手（<dd class="Jockey"> 内のテキストから斤量を除去）
    let jockeyRaw = row.find('dd.Jockey').first().text().trim()
    let jockey = jockeyRaw.replace(/\d{2}(?:\.\d)?\s*$/,'').trim()

    // 性齢
    let sexAge = row.find('dd.Age').first().text().trim()
    const mSA = sexAge.match(/(牡|牝|騙)\s?(\d)/)
    sexAge = mSA ? `${mSA[1]}${mSA[2]}` : ''

    // 斤量
    let weight = 0
    const mW = jockeyRaw.match(/(\d{2})(?:\.\d)?$/)
    if (mW) weight = Number(mW[1])

    entries.push({
      horseId: `h_${raceId}_${horseNumber}`,
      horseNumber,
      name,
      sexAge,
      jockey,
      weight,
      odds: null,
      predictionScore: 0,
      horseDbUrl,
      horseBrief,
    })
    seenNumbers.add(horseNumber)
  }

  if (entries.length === 0) {
    // SP向けフォールバック: Umaban/HorseName 近接テキストから抽出
    const pairs = Array.from(html.matchAll(/class=\"?Umaban\"?[^>]*>\s*(\d{1,2})[\s\S]{0,320}?class=\"?HorseName\"?[^>]*>\s*([^<]+)/g))
    for (const m of pairs) {
      const horseNumber = Number(m[1])
      const name = (m[2] || '').trim()
      if (!Number.isFinite(horseNumber) || !name) continue
      entries.push({
        horseId: `h_${raceId}_${horseNumber}`,
        horseNumber,
        name,
        sexAge: '',
        jockey: '',
        weight: 0,
        odds: null,
        popularity: null,
        predictionScore: 0,
      })
    }
    if (entries.length === 0) return null
  }

  const sourcePc = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`
  return {
    raceId,
    date: '',
    course,
    grade: null,
    name: title,
    distance,
    surface,
    turn,
    going,
    sources: {
      sp: url,
      pc: sourcePc,
    },
    entries,
  }
}

function parseCourseInfo(text: string): { distance: number | null; surface: string | null; turn: string | null } {
  const mDist = text.match(/(\d{4}|\d{3})\s?m/)
  const distance = mDist ? Number(mDist[1]) : null
  const surface = /芝/.test(text) ? '芝' : /ダート|ダ/.test(text) ? 'ダ' : null
  const turn = /右/.test(text) ? '右' : /左/.test(text) ? '左' : null
  return { distance, surface, turn }
}

function parseMetaFromHtml(html: string): { distance: number | null; surface: string | null; turn: string | null; going: string | null } {
  // 距離/馬場（芝/ダ）
  const m = html.match(/(芝|ダート|ダ)\s*(\d{3,4})m/)
  const surface = m ? (m[1] === 'ダート' ? 'ダ' : m[1]) : null
  const distance = m ? Number(m[2]) : null
  // 回り（右/左）
  let turn: string | null = null
  if (m) {
    const around = html.slice(m.index!, m.index! + 80)
    const mt = around.match(/(右|左)/)
    turn = mt ? mt[1] : null
  } else {
    const mt2 = html.match(/(右|左)/)
    turn = mt2 ? mt2[1] : null
  }
  // 馬場（良/稍重/重/不良 など）
  const mg = html.match(/馬場[：:]\s*([^\s<　]+)/)
  const going = mg ? mg[1] : null
  return { distance, surface, turn, going }
}


function text(node: any): string {
  return node && typeof node.text === 'function' ? node.text().trim() : ''
}

function hashCode(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return hash || 1
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
    },
    races,
  }

  const outDir = path.join(DATA_DIR, now.format('YYYY'))
  await fs.ensureDir(outDir)
  const outPath = path.join(outDir, `${weekKey}.json`)
  await fs.writeJson(outPath, payload, { spaces: 2 })
  console.log(`Generated: ${path.relative(ROOT, outPath)}`)

  // 直近データへの安定参照として current.json も出力
  const currentYearPath = path.join(outDir, `current.json`)
  const currentRootPath = path.join(DATA_DIR, `current.json`)
  await fs.writeJson(currentYearPath, payload, { spaces: 2 })
  await fs.writeJson(currentRootPath, payload, { spaces: 2 })
  console.log(`Generated: ${path.relative(ROOT, currentYearPath)}`)
  console.log(`Generated: ${path.relative(ROOT, currentRootPath)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
