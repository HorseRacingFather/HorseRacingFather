#!/usr/bin/env python3
import json
import math
import os
import re
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional

import requests
from bs4 import BeautifulSoup


API_URL = "https://api.openai.com/v1/chat/completions"
API_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """You are a meticulous horse-racing model that ranks horses based on structured past-performance data.
- Use only the information provided in the prompt. Do not invent external facts.
- Do all reasoning internally. Output JSON only."""

GUIDE = """
あなたは競馬の予想家です。以下のレース情報と出走馬情報（直近成績付き）から、各馬の**予想着順（1〜Nの整数）**を決定してください。

[評価規則: 各 0–10 点の部分点 + 補正]
1) RecentForm (0–10): 直近最大5走。新しいほど重み大（重み例: [1.0,0.8,0.6,0.4,0.2]）。
   目安の配点: 1着=6, 2着=4, 3着=3, 4–5着=1, それ以外=0。休養が長い(>180日)場合はRecentFormを控えめに解釈。
2) ConditionFit (0–10): 本レース条件（surface, distance±200m, going が近い）での近走成績を高評価。
   同条件(または近似条件)で掲示板内(≤5着)なら加点、凡走(≥9着)が多ければ減点。
3) Class/Competition (0–10): 近走のレース格（G1/G2/G3/OP/L/3勝/2勝/1勝/未勝）での相対的な善戦を加点。
   高格で善戦ほど大きく、低格のみ好走は控えめ。
4) 補正(±): 連闘(≤7日)は小さく減点、極端な距離延長/短縮(±>400m)は適性不明として小さく減点（ただし同様条件で好走実績があれば相殺）。
   同騎手継続は小さく加点。斤量増は小さく減点、斤量減は小さく加点（±1kgにつき±0.5点、最大±1.5点目安）。
   ※ 補正は合計が過大にならないように小さめに。

[厳守事項]
- 使ってよい情報は本プロンプト内のテキストのみ。
- すべての出走馬 horseId に対し順位(1..N)を割り当てる。キー欠落や未知IDは作らない。
- 重複順位は禁止（厳密な順列）。

[出力形式]
JSON オブジェクトのみ（キー: horseId, 値: 1..N の整数）。説明文は出力しない。
"""


def _safe_mkdirs(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass


def _save_prompt_and_answer(
    race_id: Optional[str],
    prompt: str,
    raw_answer: Dict[str, float],
    normalized_answer: Dict[str, float],
) -> None:
    """プロンプトと回答を JSON で保存（失敗は無視）。

    保存先:
      - PREDICT_LOG_DIR 環境変数があればそのディレクトリ
      - なければ `../debug/predict_logs/<YYYYMMDD>/<timestamp>_<raceId>.json`
    """
    try:
        base_dir = os.environ.get("PREDICT_LOG_DIR")
        if not base_dir:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "debug", "predict_logs"))
        date_str = datetime.utcnow().strftime("%Y%m%d")
        ts_str = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
        _safe_mkdirs(os.path.join(base_dir, date_str))
        safe_race = re.sub(r"[^0-9A-Za-z_-]", "_", race_id or "unknown")
        out_path = os.path.join(base_dir, date_str, f"{ts_str}_{safe_race}.json")
        payload = {
            "timestamp": ts_str + "Z",
            "raceId": race_id,
            "prompt": prompt,
            "answerRaw": raw_answer,
            "answerNormalized": normalized_answer,
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        # ログ保存の失敗は無視
        pass


def _env_limit_to_int(env_val: Optional[str]) -> Optional[int]:
    """
    環境変数の値を件数上限に変換。
    - None or "ALL" or "0" or 負数 → None（= 無制限）
    - 正の整数文字列 → その値
    """
    if env_val is None:
        return None
    env_val = env_val.strip().lower()
    if env_val in ("", "all"):
        return None
    try:
        v = int(env_val)
        return None if v <= 0 else v
    except Exception:
        return None


HORSE_RESULTS_LIMIT = 20
HORSE_RESULTS_PROMPT_LIMIT = 10


def http_get(url: str, timeout: int = 20) -> str:
    headers = {
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "referer": "https://db.netkeiba.com/",
        "accept-language": "ja,en;q=0.8",
    }
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    return r.text


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def parse_horse_recent_results(db_url: str, limit: Optional[int] = HORSE_RESULTS_LIMIT) -> List[Dict[str, str]]:
    """
    netkeiba の「馬の成績」ページ（例: https://db.netkeiba.com/horse/result/2021110146/）
    をスクレイピングし、成績表の各行（過去の出走）を配列で返す。
    取得件数は limit（None なら全件）。

    返す各要素は以下を**可能な範囲で**埋める（取れない項目は欠損のまま）:
      - date, race, finish, surface, distanceM, going, venue, jockey, weight, odds, pop, time, margin
      - raw（行テキスト全体）, cols（抽出前の列配列文字列）
    """
    out: List[Dict[str, str]] = []
    try:
        html = http_get(db_url)
        soup = BeautifulSoup(html, "html.parser")

        # 成績行: <tr> の中に /race/ へのリンクがある行を候補とする
        rows = []
        for tr in soup.find_all("tr"):
            if tr.find("a", href=re.compile(r"/race/")):
                rows.append(tr)

        # 上から古->新 or 新->古 の順はレイアウト次第なので、
        # とりあえずページ上の順序を維持しつつ limit 件に絞る。
        for tr in rows:
            tds = tr.find_all("td")
            cols = [_norm_ws(td.get_text(" ", strip=True)) for td in tds]
            row_text = _norm_ws(tr.get_text(" ", strip=True))

            def _find_text(pattern: str, text: str) -> Optional[str]:
                m = re.search(pattern, text)
                return m.group(1) if m else None

            # リンク/列から取れるもの
            a_race = tr.find("a", href=re.compile(r"/race/"))
            a_date = tr.find("a", href=re.compile(r"/race/list/"))
            # レース名は5列目（cols[4]）優先。空ならリンクテキストにフォールバック
            race_name = None
            if len(cols) >= 5:
                candidate_race = _norm_ws(cols[4])
                if candidate_race:
                    race_name = candidate_race
            if not race_name and a_race:
                race_name = _norm_ws(a_race.get_text(strip=True))
            date_text = _norm_ws(a_date.get_text(strip=True)) if a_date else None

            # 仕上げ: 代表値は行中からパターン抽出
            # 着順（1〜18 or 特殊中止等を緩めに拾う）
            finish = None
            for c in cols[:4]:  # だいたい前方の列にあることが多い
                if re.fullmatch(r"\d{1,2}", c):
                    finish = c
                    break
                if re.search(r"(中止|取消|除外|失格)", c):
                    finish = c
                    break

            # 競馬場/開催（例: "東京", "中山" などを推定）
            venue = None
            for c in cols:
                if re.fullmatch(r"[札幌函館福島新潟中山東京中京京都阪神小倉帯広門別盛岡水沢浦和船橋大井川崎園田姫路高知佐賀金沢名古屋笠松]", c):
                    venue = c
                    break

            # 馬場（芝/ダ/障）と距離
            surface = None
            distanceM = None
            for c in cols:
                if surface is None:
                    m = re.search(r"(芝|ダ|障)", c)
                    if m:
                        surface = m.group(1)
                if distanceM is None:
                    m = re.search(r"(\d{3,4})m", c)
                    if m:
                        distanceM = m.group(1)

            # 馬場状態（良/稍重/重/不良）
            going = None
            m = re.search(r"(良|稍重|重|不良)", row_text)
            if m:
                going = m.group(1)

            # 騎手
            a_jockey = tr.find("a", href=re.compile(r"/jockey/"))
            jockey = _norm_ws(a_jockey.get_text(strip=True)) if a_jockey else None

            # 斤量（例: "55.0", "57" など）
            weight = None
            for c in cols:
                m = re.fullmatch(r"\d{2,3}(?:\.\d)?", c)
                if m:
                    # 斤量が入っている列は小数or2桁台が多いが、他と紛れる可能性もある
                    weight = m.group(0)
                    break

            # タイム（例: "1:33.3"）
            time_val = None
            m = re.search(r"\d:\d{2}\.\d", row_text)
            if m:
                time_val = m.group(0)

            # 着差（例: "クビ", "ハナ", "1.2" など色々あるので緩め）
            margin = None
            # 「着差」らしき語の近辺 or カラムの短い日本語を推定
            for c in cols:
                if re.fullmatch(r"(大差|同着|クビ|ハナ|アタマ|[0-9]+\.[0-9])", c):
                    margin = c
                    break

            # オッズ/人気（人気は「○人気」表記が多い）
            odds = None
            pop = None
            for c in cols:
                m = re.fullmatch(r"\d+(?:\.\d+)?", c)
                if m and odds is None:
                    odds = m.group(0)
                if "人気" in c:
                    m2 = re.search(r"(\d+)\s*人気", c)
                    if m2:
                        pop = m2.group(1)

            # 賞金（万円）: 多くのレイアウトで最終列が賞金(万円)の数値
            prize_val: Optional[float] = None
            try:
                if cols:
                    last_col = cols[-1]
                    m = re.fullmatch(r"\d+(?:\.\d+)?", last_col)
                    if m:
                        prize_val = float(m.group(0))
            except Exception:
                prize_val = None

            item = {
                "date": date_text,
                "race": race_name,
                "finish": finish,
                "venue": venue,
                "surface": surface,
                "distanceM": distanceM,
                "going": going,
                "jockey": jockey,
                "weight": weight,
                "time": time_val,
                "margin": margin,
                "odds": odds,
                "pop": pop,
                # null のときは 0 を出力
                "prize": prize_val if prize_val is not None else 0.0,
                "raw": row_text,
                "cols": cols,
            }
            out.append(item)

            if limit is not None and len(out) >= limit:
                break

    except Exception:
        # 失敗時は空配列（上位で graceful に扱う）
        return []

    return out


def normalize_probs(values: Dict[str, float]) -> Dict[str, float]:
    s = sum(max(0.0, float(v)) for v in values.values())
    if s <= 0:
        # 全て0なら一様分布
        n = len(values) or 1
        return {k: 1.0 / n for k in values.keys()}
    return {k: max(0.0, float(v)) / s for k, v in values.items()}


def ensure_permutation_ranks(horse_ids: List[str], raw: Dict[str, Any]) -> Dict[str, int]:
    """horseId→rank(1..N) の厳密な順列を生成。壊れていても補正する。

    補正ルール:
      - 非整数/<=0/欠損は未割当扱い
      - 重複順位は先勝ち、以降は未割当に回す
      - 最終的に未割当へ小さい順の空き順位を割当
    """
    n = len(horse_ids)
    assigned: Dict[str, Optional[int]] = {hid: None for hid in horse_ids}
    used: set[int] = set()

    for hid in horse_ids:
        v = raw.get(hid)
        try:
            rank = int(v)
        except Exception:
            rank = None  # 未割当
        if rank is not None and 1 <= rank <= n and rank not in used:
            assigned[hid] = rank
            used.add(rank)

    # 空き順位のリスト
    available = [r for r in range(1, n + 1) if r not in used]

    # 未割当を埋める（馬番順の安定割当）
    for hid in horse_ids:
        if assigned[hid] is None:
            assigned[hid] = available.pop(0)

    return {hid: int(assigned[hid]) for hid in horse_ids}


def _render_recent_for_prompt(recent: List[Dict[str, str]], limit: Optional[int] = HORSE_RESULTS_PROMPT_LIMIT) -> str:
    """
    recent をテキストで読みやすく整形。各行は最小限の要素を並べる。
    """
    if not recent:
        return "  (no recent results found)"
    use = recent if limit is None else recent[:limit]
    lines = []
    for r in use:
        segs = []
        if r.get("date"): segs.append(r["date"])
        if r.get("race"): segs.append(r["race"])
        if r.get("finish"): segs.append(f"着={r['finish']}")
        # surface+distance/going をひと塊で
        sd = []
        if r.get("surface"): sd.append(r["surface"])
        if r.get("distanceM"): sd.append(f"{r['distanceM']}m")
        if r.get("going"): sd.append(r["going"])
        if sd: segs.append("/".join(sd))
        if r.get("jockey"): segs.append(f"J={r['jockey']}")
        if r.get("odds"): segs.append(f"Odds={r['odds']}")
        if r.get("pop"): segs.append(f"人気={r['pop']}")
        if r.get("time"): segs.append(f"Time={r['time']}")
        if r.get("margin"): segs.append(f"差={r['margin']}")
        # 賞金（万円）。null は 0 として常に表示
        prize_raw = r.get("prize", 0)
        try:
            prize_num = float(prize_raw)
            prize_str = str(int(prize_num)) if prize_num.is_integer() else (f"{prize_num:.1f}".rstrip('0').rstrip('.'))
        except Exception:
            prize_str = "0"
        segs.append(f"賞金={prize_str}万円")
        if not segs and r.get("raw"):
            segs.append(r["raw"])
        lines.append("    - " + " / ".join(segs))
    return "\n".join(lines)


def build_prompt(race: Dict[str, Any], horses: List[Dict[str, Any]]) -> str:
    meta_parts = []
    for key in ["date", "course", "distance", "surface", "turn", "going"]:
        if race.get(key) not in (None, ""):
            meta_parts.append(f"{key}={race.get(key)}")
    meta = ", ".join(meta_parts)

    lines = []
    for h in horses:
        recent = h.get("recentResults", []) or []
        header = (
            " - #{no} {name} ({sexAge}) jockey={jockey} wt={weight}kg id={hid} url={url}".format(
                no=h.get("horseNumber"),
                name=h.get("name"),
                sexAge=h.get("sexAge", ""),
                jockey=h.get("jockey", ""),
                weight=h.get("weight", 0),
                hid=h.get("horseId"),
                url=h.get("horseDbUrl", ""),
            )
        )
        lines.append(header)
        lines.append("   最近の戦績:")
        lines.append(_render_recent_for_prompt(recent))

    prompt = (
        f"レース情報: {meta}\n"
        f"出走馬:\n" + "\n".join(lines) + "\n\n" + GUIDE
    )
    return prompt


def call_chatgpt(prompt: str) -> Dict[str, float]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": API_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    r = requests.post(API_URL, headers=headers, data=json.dumps(body), timeout=60)
    r.raise_for_status()
    data = r.json()
    content = data["choices"][0]["message"]["content"].strip()
    try:
        return json.loads(content)
    except Exception:
        # JSON部分を抽出して再試行
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            return json.loads(m.group(0))
        raise


def main():
    if len(sys.argv) < 2:
        print("Usage: predict.py <input_week_json> [<out_dir=public/data>]")
        sys.exit(1)

    in_path = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) >= 3 else os.path.join(os.path.dirname(__file__), "..", "public", "data")
    out_dir = os.path.abspath(out_dir)

    with open(in_path, "r", encoding="utf-8") as f:
        src = json.load(f)

    week = src.get("week")
    races = src.get("races", [])

    merged_races: List[Dict[str, Any]] = []

    for race in races:
        race_id = race.get("raceId")
        entries = race.get("entries", [])

        # 追加スクレイピング（horseDbUrl -> 最近の戦績）
        enriched_entries = []
        for e in entries:
            horse = dict(e)
            db_url = horse.get("horseDbUrl")
            if db_url:
                horse["recentResults"] = parse_horse_recent_results(db_url)  # 全件 or 上限
            else:
                horse["recentResults"] = []
            enriched_entries.append(horse)

        # プロンプト作成 → ChatGPT
        prompt = build_prompt(race, enriched_entries)

        print("=" * 10)
        print(f"Race: {race_id}")
        print(f"Prompt:\n{prompt}")

        try:
            ranks_raw = call_chatgpt(prompt)
        except Exception:
            # 失敗時は馬番順で 1..N を割り当て
            ranks_raw = {e.get("horseId"): i + 1 for i, e in enumerate(sorted(entries, key=lambda x: x.get("horseNumber", 0)))}

        # 厳密な順列へ補正
        horse_ids = [e.get("horseId") for e in enriched_entries]
        ranks = ensure_permutation_ranks(horse_ids, ranks_raw)
        merged_entries2 = []
        for e in enriched_entries:
            hid = e.get("horseId")
            m = dict(e)
            m["predictionRank"] = int(ranks.get(hid, 999))
            # 互換のため旧フィールドを削除
            if "predictionScore" in m:
                del m["predictionScore"]
            merged_entries2.append(m)

        m_race = dict(race)
        m_race["entries"] = merged_entries2
        merged_races.append(m_race)

        print(f"Ranks: {ranks}")
        # ログ保存（失敗は無視）
        _save_prompt_and_answer(race_id, prompt, ranks_raw, ranks)

    # 予想をマージ済みの完全データを public/data に出力
    out = dict(src)
    out["generatedAt"] = datetime.utcnow().isoformat() + "Z"
    out["races"] = merged_races

    os.makedirs(out_dir, exist_ok=True)
    out_path_week = os.path.join(out_dir, f"{week}.json")
    out_path_current = os.path.join(out_dir, "current.json")

    with open(out_path_week, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    with open(out_path_current, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Merged data written: {out_path_week}")
    print(f"Merged data written: {out_path_current}")


if __name__ == "__main__":
    main()


