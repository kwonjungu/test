# 손상된 결과보고서 hwpx 수리 + 사례집 linesegarray 제거 (다운로드 산출물 직접 복구)
# - 결과보고서: 잘못 삽입된 3회차 조각 제거 → 최상위 요소 경계로 2회차 블록을 올바르게 복제해 3회차 재삽입
#               + 식다과/교재 수령확인서 일차 단락을 3일치로 재생성
# - 공통: linesegarray 전부 제거(변조 판정 방지), mimetype 첫 엔트리·무압축으로 재패키징
import zipfile, re, sys, shutil, os
import xml.etree.ElementTree as ET

DL = os.path.join(os.environ["USERPROFILE"], "Downloads")

def top_level_els(xml, start):
    els = []
    openre = re.compile(r'<(hp:p|hp:tbl)\b')
    idx = start
    while True:
        m = openre.search(xml, idx)
        if not m: break
        tag = m.group(1)
        pat = re.compile(r'</?' + tag + r'\b')
        depth = 0; end = None
        for mm in pat.finditer(xml, m.start()):
            if xml[mm.start()+1] == '/':
                depth -= 1
                if depth == 0:
                    end = xml.index('>', mm.start()) + 1
                    break
            else:
                depth += 1
        if end is None: end = len(xml)
        text = "".join(re.findall(r'<hp:t>(.*?)</hp:t>', xml[m.start():end]))
        els.append((m.start(), end, text))
        idx = end
    return els

def repackage(src, xml, dst):
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            name = info.filename
            data = xml.encode("utf-8") if name == "Contents/section0.xml" else zin.read(name)
            comp = zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
            zout.writestr(zipfile.ZipInfo(name, date_time=info.date_time), data,
                          compress_type=comp, compresslevel=None if comp == zipfile.ZIP_STORED else 9)
    ET.fromstring(zipfile.ZipFile(dst).read("Contents/section0.xml"))  # 최종 검증

def strip_lineseg(xml):
    return re.sub(r'<hp:linesegarray>[\s\S]*?</hp:linesegarray>|<hp:linesegarray\s*/>', '', xml)

def shift_day(mm, dd, delta=1):
    import datetime
    d = datetime.date(2026, mm, dd) + datetime.timedelta(days=delta)
    return d.month, d.day

def repair_report(src, dst):
    z = zipfile.ZipFile(src)
    xml = z.read("Contents/section0.xml").decode("utf-8")

    # 1) 잘못 삽입된 3회차 조각 제거: 조각은 3회차 제목의 (셀 내부) 단락에서 시작해
    #    "3. 기타 운영사항" 최상위 단락 직전에서 끝난다.
    i3 = xml.find("<hp:t>3회차</hp:t>")
    assert i3 > 0, "3회차 조각 없음"
    F = xml.rfind("<hp:p ", 0, xml.rfind("「", 0, i3))
    g = xml.find("3. 기타 운영사항")
    G = xml.rfind("<hp:p ", 0, g)
    assert 0 < F < G, "경계 계산 실패"
    xml = xml[:F] + xml[G:]
    ET.fromstring(xml)  # 조각 제거 후 정상 여부 확인

    # 2) 2회차 블록(최상위 요소 경계)을 복제해 3회차 생성
    secm = re.search(r'<hs:sec\b[^>]*>', xml)
    els = top_level_els(xml, secm.end())
    e2 = next(e for e in els if re.search(r'2회차 결과보고', e[2]))
    gi = next(e for e in els if re.search(r'3\. 기타 운영사항', e[2]))
    block2 = xml[e2[0]:gi[0]]

    d2 = re.search(r'<hp:t>\(2일차\) (\d{2})월 (\d{2})일 / ([^<]*)</hp:t>', block2)
    m3, dd3 = shift_day(int(d2.group(1)), int(d2.group(2)))
    times = d2.group(3)

    max_id = max(int(x) for x in re.findall(r'\bid="(\d{6,})"', xml))
    max_z = max((int(x) for x in re.findall(r'zOrder="(\d+)"', xml)), default=0)
    clone = block2.replace("<hp:t>2회차</hp:t>", "<hp:t>3회차</hp:t>", 1)
    clone = clone.replace(d2.group(0), f'<hp:t>(3일차) {m3:02d}월 {dd3:02d}일 / {times}</hp:t>', 1)
    ids = iter(range(max_id + 1, max_id + 100000))
    clone = re.sub(r'\bid="\d{6,}"', lambda m: f'id="{next(ids)}"', clone)
    zs = iter(range(max_z + 1, max_z + 100000))
    clone = re.sub(r'zOrder="\d+"', lambda m: f'zOrder="{next(zs)}"', clone)
    xml = xml[:gi[0]] + clone + xml[gi[0]:]

    # 3) 식다과·교재 수령확인서: 연속 일차 단락 2개 묶음 → 3일치로 재생성
    def regen(block_m):
        block = block_m.group(0)
        one = re.match(r'<hp:p\b[^>]*>(?:(?!</hp:p>)[\s\S])*?</hp:p>', block).group(0)
        d1 = re.search(r'<hp:t>\(1일차\) (\d{2})월 (\d{2})일 / ([^<]*)</hp:t>', block)
        mm, dd, tt = int(d1.group(1)), int(d1.group(2)), d1.group(3)
        out = []
        for i in range(3):
            m_i, d_i = shift_day(mm, dd, i)
            out.append(re.sub(r'<hp:t>\(\d일차\)[^<]*</hp:t>',
                              f'<hp:t>({i+1}일차) {m_i:02d}월 {d_i:02d}일 / {tt}</hp:t>', one, count=1))
        return "".join(out)
    xml = re.sub(r'(?:<hp:p\b[^>]*>(?:(?!</hp:p>)[\s\S])*?<hp:t>\(\d일차\)[^<]*</hp:t>(?:(?!</hp:p>)[\s\S])*?</hp:p>){2,}',
                 regen, xml)

    xml = strip_lineseg(xml)
    ET.fromstring(xml)
    repackage(src, xml, dst)
    print("OK 수리:", os.path.basename(dst))

def fix_casebook(src, dst):
    z = zipfile.ZipFile(src)
    xml = strip_lineseg(z.read("Contents/section0.xml").decode("utf-8"))
    ET.fromstring(xml)
    repackage(src, xml, dst)
    print("OK 보안수정:", os.path.basename(dst))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    repair_report(os.path.join(DL, "결과보고서_이상민_오전반.hwpx"),
                  os.path.join(DL, "결과보고서_이상민_오전반_수정.hwpx"))
    repair_report(os.path.join(DL, "결과보고서_황지현_오후반.hwpx"),
                  os.path.join(DL, "결과보고서_황지현_오후반_수정.hwpx"))
    fix_casebook(os.path.join(DL, "프로그램운영사례집_이상민_오전반 (1).hwpx"),
                 os.path.join(DL, "프로그램운영사례집_이상민_오전반_수정.hwpx"))
    fix_casebook(os.path.join(DL, "프로그램운영사례집_황지현_오후반.hwpx"),
                 os.path.join(DL, "프로그램운영사례집_황지현_오후반_수정.hwpx"))
