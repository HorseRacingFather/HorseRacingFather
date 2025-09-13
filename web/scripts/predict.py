#!/usr/bin/env python3
import json
import math
import os
import re
import sys
from datetime import datetime
from typing import Dict, List, Any

import requests
from bs4 import BeautifulSoup


API_URL = "https://api.openai.com/v1/chat/completions"
API_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


def http_get(url: str, timeout: int = 20) -> str:
    headers = {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    return r.text


def parse_horse_brief(db_url: str) -> Dict[str, str]:
    try:
        html = http_get(db_url)
        soup = BeautifulSoup(html, "html.parser")
        # 最初の /race/ リンクが含まれる行を last とする
        a = soup.find("a", href=re.compile(r"/race/"))
        if not a:
            return {}
        tr = a.find_parent("tr")
        if not tr:
            return {}
        last_result_name = a.get_text(strip=True) or None
        # 同一行の開催日リンク/テキストを探す
        date_link = tr.find("a", href=re.compile(r"/race/list/"))
        last_result_date = date_link.get_text(strip=True) if date_link else None
        # 着順らしきセル（1〜18）
        last_finish = None
        for td in tr.find_all("td"):
            t = (td.get_text() or "").strip()
            if re.fullmatch(r"\d{1,2}", t):
                n = int(t)
                if 1 <= n <= 18:
                    last_finish = str(n)
                    break
        out = {}
        if last_result_date:
            out["lastResultDate"] = last_result_date
        if last_result_name:
            out["lastResultName"] = last_result_name
        if last_finish:
            out["lastFinish"] = last_finish
        return out
    except Exception:
        return {}


def normalize_probs(values: Dict[str, float]) -> Dict[str, float]:
    s = sum(max(0.0, float(v)) for v in values.values())
    if s <= 0:
        # 全て0なら一様分布
        n = len(values) or 1
        return {k: 1.0 / n for k in values.keys()}
    return {k: max(0.0, float(v)) / s for k, v in values.items()}


def build_prompt(race: Dict[str, Any], horses: List[Dict[str, Any]]) -> str:
    meta_parts = []
    for key in ["date", "course", "distance", "surface", "turn", "going"]:
        if race.get(key) not in (None, ""):
            meta_parts.append(f"{key}={race.get(key)}")
    meta = ", ".join(meta_parts)

    lines = []
    for h in horses:
        brief = h.get("horseBrief", {}) or {}
        lines.append(
            " - #{no} {name} ({sexAge}) jockey={jockey} wt={weight}kg id={hid} last={{date:{ld}, name:{ln}, finish:{lf}}} url={url}".format(
                no=h.get("horseNumber"),
                name=h.get("name"),
                sexAge=h.get("sexAge", ""),
                jockey=h.get("jockey", ""),
                weight=h.get("weight", 0),
                hid=h.get("horseId"),
                ld=brief.get("lastResultDate"),
                ln=brief.get("lastResultName"),
                lf=brief.get("lastFinish"),
                url=h.get("horseDbUrl", ""),
            )
        )

    guide = (
        "あなたは競馬の予想家です。以下のレース情報と出走馬情報から、各馬の勝利確率を推定してください。"
        " 小数(0〜1)で出力し、全馬の合計が1.0になるようにしてください。根拠の文章は不要で、JSONオブジェクトのみ出力してください。"
        " キーは horseId、値は勝率(0〜1)。小数点4桁程度まで。"
    )
    example = '{"h_202506040401_2": 0.35, "h_202506040401_5": 0.25, "h_202506040401_8": 0.10, "...": 0.30}'
    prompt = (
        f"レース情報: {meta}\n"
        f"出走馬:\n" + "\n".join(lines) + "\n\n" + guide + "\n出力例: " + example
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
            {"role": "system", "content": "You are an expert horse racing analyst. Output JSON only."},
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

        # 追加スクレイピング（horseDbUrl）
        enriched_entries = []
        for e in entries:
            horse = dict(e)
            db_url = horse.get("horseDbUrl")
            if db_url:
                horse["horseBrief"] = parse_horse_brief(db_url)
            enriched_entries.append(horse)

        # プロンプト作成 → ChatGPT
        prompt = build_prompt(race, enriched_entries)

        print("=" * 10)
        print(f"Race: {race_id}")
        print(f"Prompt: {prompt}")

        try:
            probs = call_chatgpt(prompt)
        except Exception:
            # 失敗時は一様分布
            probs = {e.get("horseId"): 1.0 for e in entries}

        # 正規化して entries へ勝率を反映（0〜1）
        probs = normalize_probs(probs)
        merged_entries = []
        for e in enriched_entries:
            hid = e.get("horseId")
            score = float(probs.get(hid, 0.0))
            m = dict(e)
            m["predictionScore"] = score
            merged_entries.append(m)

        m_race = dict(race)
        m_race["entries"] = merged_entries
        merged_races.append(m_race)

        print(f"Probs: {probs}")

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


