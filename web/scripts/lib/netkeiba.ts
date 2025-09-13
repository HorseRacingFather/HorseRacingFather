import fs from 'fs-extra'
import path from 'path'
import { load, CheerioAPI } from 'cheerio'
import { fetchHtml } from './http'
import { Entry, Race } from './types'

export async function fetchRaceIdsForDate(ymd: string, debugDir: string): Promise<Set<string>> {
  const ids = new Set<string>()
  await fs.ensureDir(debugDir)
  try {
    const innerUrl = `https://race.netkeiba.com/top/race_list_get_date_list.html?kaisai_date=${ymd}&encoding=UTF-8`
    const innerHtml = await fetchHtml(innerUrl, { headers: { 'x-requested-with': 'XMLHttpRequest' } })
    await fs.writeFile(path.join(debugDir, `netkeiba_list_inner_${ymd}.html`), innerHtml)
    const $inner = load(innerHtml)
    const activeLi = $inner('#date_list_sub li.Active')
    const group = activeLi.attr('group') || ''
    if (group) {
      const subUrl = `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${ymd}&current_group=${group}&encoding=UTF-8`
      const subHtml = await fetchHtml(subUrl, { headers: { 'x-requested-with': 'XMLHttpRequest' } })
      await fs.writeFile(path.join(debugDir, `netkeiba_list_sub_${ymd}.html`), subHtml)
      for (const m of subHtml.matchAll(/race_id=(\d{10,12})/g)) if (m[1]) ids.add(m[1])
      const $sub = load(subHtml)
      $sub('a').each((_, el) => {
        const href = $sub(el).attr('href') || ''
        const id = extractRaceId(href)
        if (id) ids.add(id)
      })
    }
  } catch {}
  if (ids.size === 0) {
    try {
      const spUrl = `https://race.sp.netkeiba.com/?pid=race_list&kaisai_date=${ymd}`
      const spHtml = await fetchHtml(spUrl)
      await fs.writeFile(path.join(debugDir, `netkeiba_list_sp_${ymd}.html`), spHtml)
      for (const m of spHtml.matchAll(/race_id=(\d{10,12})/g)) if (m[1]) ids.add(m[1])
    } catch {}
  }
  return ids
}

export function extractRaceId(url: string): string | null {
  const m = url.match(/[?&]race_id=(\d+)/)
  return m ? m[1] : null
}

export function guessCourse($: CheerioAPI): string {
  const text = $('body').text()
  const courses = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']
  for (const c of courses) if (text.includes(c)) return c
  return ''
}

export function extractHorseNumber($: CheerioAPI, row: ReturnType<CheerioAPI>): number {
  const wakuText = row.find('td[class^="Waku"]').first().text().trim()
  const n0 = Number((wakuText || '').replace(/[^0-9]/g, ''))
  if (Number.isFinite(n0) && n0 > 0) return n0
  const nameAttr = row.find('input.HorseCheck_Select').attr('name') || ''
  const n1 = Number(nameAttr)
  if (Number.isFinite(n1) && n1 > 0) return n1
  const idAttrCb = row.find('input.HorseCheck_Select').attr('id') || ''
  const mIdCb = idAttrCb.match(/check_(\d{1,2})/)
  if (mIdCb) return Number(mIdCb[1])
  const umabanText = row.find('td[class*="Umaban"], td[class*="Waku"]').first().text().trim()
  const n2 = Number((umabanText || '').replace(/[^0-9]/g, ''))
  if (Number.isFinite(n2) && n2 > 0) return n2
  const idAttr = row.attr('id') || ''
  const mTr = idAttr.match(/tr_(\d{1,2})/)
  if (mTr) return Number(mTr[1])
  return NaN
}

export async function fetchHorseBrief(dbUrl: string): Promise<{ lastResultDate?: string; lastResultName?: string; lastFinish?: string }> {
  const html = await fetchHtml(dbUrl)
  const $ = load(html)
  // 最初のレース行を推定
  const firstRaceLink = $('a[href*="/race/" ]').filter((_, el) => {
    const href = $(el).attr('href') || ''
    return /\/race\/\d{12}\//.test(href) || /\?pid=race/.test(href)
  }).first()
  if (!firstRaceLink.length) return {}
  const tr = firstRaceLink.closest('tr')
  const lastResultName = firstRaceLink.text().trim() || undefined
  // 日付リンク
  const dateLink = tr.find('a[href*="/race/list/"]').first().text().trim()
  const lastResultDate = dateLink || undefined
  // 着順らしきセル（1〜18の数字のみ）
  let lastFinish: string | undefined
  tr.find('td').each((_, td) => {
    const t = $(td).text().trim()
    if (/^\d{1,2}$/.test(t)) {
      const n = Number(t)
      if (n >= 1 && n <= 18 && lastFinish === undefined) lastFinish = String(n)
    }
  })
  return { lastResultDate, lastResultName, lastFinish }
}

