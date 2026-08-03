# -*- coding: utf-8 -*-
# 한글(HWP) 실제 열기 테스트 — 생성된 전 hwpx를 현재 보안 수준(전역 설정)에서 열어 확인
# 문서 보안 수준은 %APPDATA%\HNC\User\Hwp\Config130.json 의 DocumentSecurityLevel (2=높음).
# 변조/손상 판정 문서는 높음에서 Open 실패하므로, Open+본문 추출 성공 = 통과.
# 실행: python tools/open_test_hwp.py [대상폴더=tools/out/security]
import sys, os, glob, json
sys.stdout.reconfigure(encoding="utf-8")
import win32com.client as win32

# 현재 전역 보안 수준 표시
cfg = os.path.join(os.environ["APPDATA"], "HNC", "User", "Hwp", "Config130.json")
try:
    lv = json.load(open(cfg, encoding="utf-8-sig")).get("DocumentSecurityLevel")
    print(f"문서 보안 수준(DocumentSecurityLevel): {lv} (2=높음, 1=보통, 0=낮음)\n")
except Exception as e:
    print("보안 수준 확인 실패:", e, "\n")

target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out", "security")
files = sorted(glob.glob(os.path.join(target, "*.hwpx")))

hwp = win32.gencache.EnsureDispatch("HWPFrame.HwpObject")
hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
hwp.XHwpWindows.Item(0).Visible = False

fails = 0
for f in files:
    name = os.path.basename(f)
    try:
        ok = hwp.Open(os.path.abspath(f), "HWPX", "forceopen:false;versionwarning:false")
        if not ok:
            print(f"FAIL {name} — Open 거부(변조/손상 판정 가능성)")
            fails += 1
            continue
        pg = hwp.PageCount
        txt = hwp.GetTextFile("TEXT", "") or ""
        if not txt.strip():
            print(f"FAIL {name} — 열렸으나 본문 추출 0자")
            fails += 1
        else:
            print(f"ok   {name} — {pg}쪽, 본문 {len(txt.strip())}자")
    except Exception as e:
        print(f"FAIL {name} — 예외: {e}")
        fails += 1

try:
    hwp.Quit()
except Exception:
    pass

print(f"\n{len(files)}개 중 실패 {fails}개")
sys.exit(1 if fails else 0)
