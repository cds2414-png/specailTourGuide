"""모두의 여행길 Q&A 챗봇 색인 생성 (Python + LangChain, pyenv 가상환경에서 실행)

js/data.js·FAQ·화면 소개 문구를 문서로 만들고, LangChain RecursiveCharacterTextSplitter로
청크를 나눈다. 이웃 청크끼리 앞뒤로 약 15%(10~20%) 글자가 겹치게 해 경계에 걸친 내용도 검색되게 한다.
청크는 Upstage Solar 임베딩(문서용 embedding-passage)으로 미리 계산한다.

  - api/_chat-index.json : 청크 + 정규화한 임베딩 (서버리스 함수 /api/chat이 질문용 embedding-query로 비교)
  - assets/chat-docs.json: 청크 글만 (API를 못 쓸 때 브라우저 키워드 검색용)

사용법 (travel 폴더에서):
  .venv\\Scripts\\python tools\\build_chat_index.py          # 색인 생성
  .venv\\Scripts\\python tools\\build_chat_index.py --dry    # 임베딩 없이 청크·중복률만 출력
키는 .env의 UPSTAGE_API_KEY에서 읽는다. js/data.js를 읽으려고 node를 한 번 호출한다.
"""

import json
import math
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter

ROOT = Path(__file__).resolve().parent.parent

CHUNK_SIZE = 300          # 청크 최대 글자 수 (제목 줄 제외). 이 사이트 문서는 200~500자라 300자로 잘라야 앞뒤 중복이 생긴다
CHUNK_OVERLAP = 45        # 15% — 이웃 청크와 겹치는 글자 수 (10~20% 범위)
MIN_TAIL = 90             # 마지막 청크의 새 내용이 이보다 짧으면 앞 청크에 합친다
PASSAGE_MODEL = "embedding-passage"   # Upstage 문서용
QUERY_MODEL = "embedding-query"       # Upstage 질문용 (api/chat.js가 사용)

# 낱말 단위로 나눠야 겹침이 글자 수 기준(CHUNK_OVERLAP)으로 정확히 생긴다.
# 줄 단위로 나누면 한 줄(150~200자)이 겹침 한도보다 길어 겹침이 0이 된다.
splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=[" ", ""],
    keep_separator=False,
)

MODE = {"car": "자동차", "train": "열차", "flight": "항공", "walk": "도보", "wheel": "휠체어·유모차", "boat": "배"}


def load_site_data():
    """js/data.js(TRIP)와 tools/faq.js(FAQ)를 node로 읽어 JSON으로 받는다."""
    script = (
        "global.window=global;require('./js/data.js');"
        "const FAQ=require('./tools/faq.js')(TRIP);"
        "process.stdout.write(JSON.stringify({T:TRIP,FAQ}))"
    )
    out = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, check=True)
    data = json.loads(out.stdout.decode("utf-8"))
    return data["T"], data["FAQ"]


def won(n):
    return f"{n:,}원"


docs = []


def add(doc_id, title, url, head, lines, go=None):
    """본문을 청크로 나누고 각 청크 앞에 제목 줄(head)을 붙인다."""
    parts = splitter.split_text("\n".join(lines))
    # 마지막 청크가 짧으면(새 내용이 MIN_TAIL자 미만) 거의 겹친 부분뿐이라 검색 잡음만 늘린다 → 앞 청크에 붙인다
    if len(parts) > 1 and len(parts[-1]) - CHUNK_OVERLAP < MIN_TAIL:
        prev, tail = parts[-2], parts[-1]
        k = next((n for n in range(min(len(prev), len(tail)), 0, -1) if prev.endswith(tail[:n])), 0)
        parts = parts[:-2] + [prev + tail[k:]]
    for i, body in enumerate(parts):
        d = {"id": f"{doc_id}#{i + 1}" if len(parts) > 1 else doc_id, "title": title, "url": url, "text": head + "\n" + body}
        if go:
            d["go"] = go
        d["_body"] = body  # 중복률 검사용 (저장하지 않음)
        d["_group"] = doc_id
        docs.append(d)


def build_docs(T, FAQ):
    group_label = {g["id"]: g["label"] for g in T["GROUPS"]}
    need_label = {n["id"]: n["title"] for n in T["NEEDS"]}
    courses = T["COURSES"]
    origins = ", ".join(o["name"] for o in T["ORIGINS"].values())

    # 화면 소개
    add("page-top", "홈 · 모두의 여행길 소개", "#top", "모두의 여행길(Route for All) 소개", [
        "빠른 길 말고 맞는 길로, 누구나 떠나는 여행.",
        "연령대와 몸의 조건에 맞춰 걷는 양, 쉬는 간격, 이동 수단까지 다시 그린 여행 코스예요. 출발부터 도착까지 2D 내비게이션으로 미리 달려볼 수 있어요.",
        "나이가 들면 걸음이 느려지고, 몸이 불편하면 계단 하나가 벽이 돼요. 모두의 여행길은 빠른 길 대신 맞는 길을 찾아요.",
        f"여행 코스 {len(courses)}개, 연령대 {len(T['GROUPS'])}개, 무장애 유형 {len(T['NEEDS'])}개를 다뤄요.",
        "메뉴: 홈, 연령별 코스, 무장애 여행, 내비 시뮬레이터, 여행 리뷰, Q&A 챗봇.",
        "이 사이트는 비공식 여행 코스 쇼케이스예요. 지도·경로는 시뮬레이션이며 실제 도로 안내가 아니에요.",
    ])
    add("page-ages", "연령별 코스", "#ages", "연령별 가이드 — 나이마다 다른 여행의 속도", [
        "걷는 양, 이동 간격, 쉬는 시간을 연령대에 맞춰 조절했어요. 코스를 고르면 내비게이션으로 바로 달려볼 수 있어요.",
        "연령대: " + ", ".join(f"{g['label']}({g['title']})" for g in T["GROUPS"]) + ".",
    ])
    for g in T["GROUPS"]:
        add(f"group-{g['id']}", f"연령별 코스 · {g['label']}", "#ages", f"{g['label']} 여행 가이드: {g['title']}", [
            g["lead"],
            "준비 팁: " + " / ".join(g["tips"]),
            f"{g['label']} 코스: " + ", ".join(c["title"] for c in courses if c["group"] == g["id"]),
        ])
    add("page-access", "무장애 여행", "#access", "무장애 여행 가이드 — 계단 하나가 벽이 되지 않도록", [
        "휠체어 이용자, 보행이 불편한 분, 유모차·임산부와 함께하는 여행을 위해 계단과 오르막을 줄이고 쉬는 지점을 일정에 넣었어요.",
        "무장애 유형으로 코스를 거를 수 있어요: " + ", ".join(n["title"] for n in T["NEEDS"]) + ".",
        "시설 정보(대여, 엘리베이터, 화장실, 운영 시간)는 바뀔 수 있어요. 출발 전 각 시설에 꼭 확인하세요.",
    ])
    for n in T["NEEDS"]:
        add(f"need-{n['id']}", f"무장애 여행 · {n['title']}", "#access", f"{n['title']} 여행 준비 팁",
            n["points"] + [f"{n['title']} 코스: " + ", ".join(c["title"] for c in courses if c.get("need") == n["id"])])
    add("help", "무장애 여행 · 도움이 필요할 때", "#access", "여행 중 문의처(도움이 필요할 때 전화)",
        [f"{h['label']} {h['value']}: {h['note']}." for h in T["HELP"]])
    add("page-sim", "내비 시뮬레이터", "#sim", "2D 내비게이션 시뮬레이터 — 출발부터 도착까지 미리 달려보기", [
        "출발지를 고르고 재생을 누르면 경로를 따라 이동하며 길 안내, 도착 예정 시각, 휴식 권장 지점을 보여줘요.",
        f"출발 지역은 직접 입력해요. 주요 역({origins})과 전국 시·군 {len(T['PLACES'])}곳을 찾을 수 있고, 출발지에서 가까운 코스 3개를 추천해요.",
        "이동 수단: 코스 추천, 자동차, 대중교통(고속버스·시내버스·지하철·도보), 기차를 고를 수 있어요. 도보·휠체어·배·관광열차 구간은 어떤 수단이든 유지돼요.",
        "목적지에 도착하면 입장권·체험 티켓을 제안해요. 결제는 토스페이먼츠 테스트 환경의 시연 기능이고 요금은 예시예요. 10초 안에 고르지 않으면 다음 목적지로 넘어가요.",
        "현재 코스·출발지·이동 수단을 A4 여행 가이드로 미리 보고 인쇄하거나 PDF로 저장할 수 있어요. 큰 글씨 옵션도 있어요.",
        "화면 오른쪽 위 「가+」 버튼으로 사이트 글자를 크게 볼 수 있어요.",
    ])
    add("page-reviews", "여행 리뷰", "#reviews", "여행 리뷰 — 다녀온 사람들의 느린 후기", [
        "계단은 많았는지, 쉴 곳은 있었는지. 같은 나이대, 같은 이동 조건을 가진 사람의 후기가 가장 정확한 안내가 돼요.",
        "로그인하면 리뷰를 쓸 수 있어요. 코스별 평점, 정렬(최신순·평점순·도움돼요순), 내 리뷰만 보기를 지원해요.",
        "리뷰를 자동 분석으로 쓰면 글 속 장소·이동 조건·걷기 강도를 찾아 기존 코스와 비교하고, 같은 코스가 없으면 「리뷰에서 태어난 코스」로 새 코스를 만들어요.",
        "계정·리뷰·티켓은 이 브라우저(localStorage)에만 저장되는 데모 기능이에요. 예시 리뷰에는 「예시」 배지가 붙어 있어요.",
    ])

    # 자주 묻는 질문 (질문·답 한 쌍이 한 청크)
    for i, (q, a) in enumerate(FAQ, 1):
        docs.append({"id": f"faq-{i}", "title": f"자주 묻는 질문 · {q}", "url": "#top", "text": f"Q. {q}\nA. {a}", "_group": f"faq-{i}"})

    # 코스: 개요 + 방문지 상세
    for c in courses:
        who = "무장애 · " + need_label[c["need"]] if c["group"] == "access" else group_label[c["group"]]
        url = "#access" if c["group"] == "access" else "#ages"
        head = f"[{who} 코스] {c['title']} ({c['region']}, {c['days']})"
        acc = c.get("access") or {}
        lines = [
            c["summary"],
            f"추천 대상: {who}. 지역: {c['region']}. 일정: {c['days']}." + (f" 키워드: {', '.join(c['tags'])}." if c.get("tags") else ""),
            "가는 방법: " + MODE.get(acc.get("mode"), "자동차") + (f"({acc['line']})" if acc.get("line") else "")
            + (f", {acc['hub']['name']} 도착" if acc.get("hub") else "") + ". 현지 이동: " + MODE.get(c.get("localMode"), c.get("localMode") or "자동차") + ".",
            "경로: " + " → ".join(s["name"] for s in c["stops"]),
        ]
        if isinstance(c.get("gentle"), str):
            lines.append("휴식 안내: " + c["gentle"])
        if isinstance(c.get("a11y"), str):
            lines.append("이동 지원: " + c["a11y"])
        add(f"course-{c['id']}", c["title"], url, head, lines, go=c["id"])

        stop_lines = []
        for i, s in enumerate(c["stops"], 1):
            t = f"{i}. {s['name']} (머무는 시간 약 {s['stay']}분{', 이후 숙박' if s.get('night') else ''}): {s['desc']}"
            if s.get("a11y"):
                t += " 무장애 안내: " + " / ".join(s["a11y"]) + "."
            tk = T["TICKETS"].get(s["name"])
            if tk:
                t += " 티켓(예시 요금): " + ", ".join(f"{k['name']} {won(k['price'])}" for k in tk) + "."
            pk = (T.get("PERKS") or {}).get(s["name"])
            if pk:
                t += " 우대: " + pk["text"]
            stop_lines.append(t)
        add(f"stops-{c['id']}", f"{c['title']} · 방문지", url, head + " 방문지 상세", stop_lines, go=c["id"])


def overlap_report():
    """같은 문서에서 이어지는 청크 쌍의 겹친 글자 수와 비율(뒤 청크 기준)을 구한다."""
    rows = []
    for a, b in zip(docs, docs[1:]):
        if a["_group"] != b["_group"] or "_body" not in a:
            continue
        x, y = a["_body"], b["_body"]
        n = next((k for k in range(min(len(x), len(y)), 0, -1) if x.endswith(y[:k])), 0)
        rows.append((a["id"], b["id"], n, n / len(y), n / len(x)))
    return rows


def embed(texts):
    from langchain_upstage import UpstageEmbeddings

    if not os.getenv("UPSTAGE_API_KEY"):
        sys.exit(".env에 UPSTAGE_API_KEY가 없어요")
    emb = UpstageEmbeddings(model=PASSAGE_MODEL)
    vecs = emb.embed_documents(texts)
    out = []
    for v in vecs:
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        out.append([round(x / n, 5) for x in v])  # 정규화해 두면 내적이 곧 코사인 유사도
    return out


def main():
    load_dotenv(ROOT / ".env")
    T, FAQ = load_site_data()
    build_docs(T, FAQ)

    rows = overlap_report()
    print(f"청크 {len(docs)}개 (chunk_size={CHUNK_SIZE}, chunk_overlap={CHUNK_OVERLAP} ≈ {CHUNK_OVERLAP / CHUNK_SIZE:.0%})")
    for a, b, n, rb, ra in rows:
        print(f"  {a} ↔ {b}: {n}자 겹침 (앞 청크의 {ra:.0%}, 뒤 청크의 {rb:.0%})")

    if "--dry" in sys.argv:
        for d in docs:
            print("──", d["id"], f"{len(d['text'])}자\n" + d["text"])
        return

    public = [{k: v for k, v in d.items() if not k.startswith("_")} for d in docs]
    (ROOT / "assets/chat-docs.json").write_text(json.dumps(public, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    vecs = embed([d["text"] for d in public])
    index = {
        "provider": "upstage", "model": PASSAGE_MODEL, "queryModel": QUERY_MODEL, "dims": len(vecs[0]),
        "built": date.today().isoformat(), "chunkSize": CHUNK_SIZE, "chunkOverlap": CHUNK_OVERLAP,
        "docs": [dict(d, v=v) for d, v in zip(public, vecs)],
    }
    (ROOT / "api/_chat-index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"ok {len(public)} chunks, {PASSAGE_MODEL} {index['dims']}d")


if __name__ == "__main__":
    main()
