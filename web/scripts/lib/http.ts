import iconv from 'iconv-lite'

export async function fetchHtml(url: string, init?: RequestInit): Promise<string> {
  await sleep(500)
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      'user-agent': 'HorseRacingFatherBot/0.1 (+https://github.com/) contact: github-actions',
      'accept-language': 'ja,en;q=0.8',
      ...(init?.headers || {}),
    }
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  const preferEuc = host.includes('race.sp.netkeiba.com') || host.includes('race.netkeiba.com')
  if (ct.includes('euc') || ct.includes('euc-jp')) return iconv.decode(Buffer.from(buf), 'EUC-JP')
  const headLatin1 = Buffer.from(buf.slice(0, 8192)).toString('latin1')
  if (/charset\s*=\s*euc-?jp/i.test(headLatin1)) return iconv.decode(Buffer.from(buf), 'EUC-JP')
  if (preferEuc) return iconv.decode(Buffer.from(buf), 'EUC-JP')
  return new TextDecoder('utf-8').decode(buf)
}

export function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

