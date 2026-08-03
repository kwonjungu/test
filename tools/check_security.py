# -*- coding: utf-8 -*-
# 보안성 검사(높음) 구조 검증 — 한글이 '손상/변조 가능성'으로 판정하는 알려진 요인 점검
#  1) zip/XML 파손 여부(모든 .xml 파싱)   2) linesegarray 잔존(변조 판정 원인)
#  3) mimetype 첫 엔트리·무압축           4) Scripts 잔존·content.hpf 참조 불일치
# 실행: python tools/check_security.py [대상폴더=tools/out/security]
import zipfile, sys, os, re, glob
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out", "security")

fails = 0
files = sorted(glob.glob(os.path.join(target, "*.*")))
for f in files:
    name = os.path.basename(f)
    errs = []
    try:
        z = zipfile.ZipFile(f)
        bad = z.testzip()
        if bad: errs.append(f"zip 손상: {bad}")
        infos = z.infolist()
        is_hwpx = name.endswith(".hwpx")
        if is_hwpx:
            if infos[0].filename != "mimetype":
                errs.append(f"mimetype이 첫 엔트리 아님: {infos[0].filename}")
            elif infos[0].compress_type != zipfile.ZIP_STORED:
                errs.append("mimetype이 무압축(STORE)이 아님")
            scripts = [i.filename for i in infos if i.filename.startswith("Scripts/")]
            if scripts: errs.append(f"Scripts 잔존: {scripts}")
            hpf = z.read("Contents/content.hpf").decode("utf-8", "replace")
            for ref in re.findall(r'(?:href|idref)="([^"]+)"', hpf):
                if ref.endswith((".xml", ".js")) and ref not in z.namelist():
                    errs.append(f"content.hpf가 없는 파일 참조: {ref}")
            dirs = [i.filename for i in infos if i.filename.endswith("/")]
            if dirs: errs.append(f"폴더 엔트리 잔존: {dirs}")
        for i in infos:
            if i.filename.endswith((".xml", ".hpf", ".rels")):
                data = z.read(i.filename)
                try:
                    ET.fromstring(data)
                except ET.ParseError as e:
                    errs.append(f"XML 파손 {i.filename}: {e}")
                if is_hwpx and re.match(r"Contents/section\d+\.xml", i.filename):
                    if b"linesegarray" in data:
                        errs.append(f"linesegarray 잔존: {i.filename}")
    except Exception as e:
        errs.append(f"열기 실패: {e}")
    if errs:
        fails += 1
        print(f"FAIL {name}")
        for e in errs: print("   -", e)
    else:
        print(f"ok   {name}")

print(f"\n{len(files)}개 중 실패 {fails}개")
sys.exit(1 if fails else 0)
