# CLAUDE.md — 小柯機器人建築平面圖轉3D工具（xiaoke-floorplan）

需求文件：`../建築平面圖轉3d.docx`。開發過程見 `docs/開發紀錄.md`。

## 與使用者合作

- 一律用繁體中文回覆（App 按鈕原名可保留英文）。
- 開發者署名：吳玉柱 先生 與 Claude AI Opus 5.5。
- 推送、建 repo、發佈 Release 等對外動作先問過使用者；commit 作者用 GitHub noreply 信箱，任何檔案都不放使用者 email。

## 專案是什麼

上傳 2D 建築平面圖 → 辨識牆、門、窗、柱、房間 → Three.js 3D（鳥瞰／俯視／漫遊／WebXR VR）→ 中英文自然語言指令修改 → 匯出 GLB／USDZ／OBJ／STL／PNG／.xkplan。
構想參考 akaiHuang/ai-floorplan-to-3d（README 標 MIT，但沒有 LICENSE 檔），**沒有用它的程式碼**，本專案 MIT。
平台順序：Windows（v1.0.0）→ Mac（v1.1.0）→ 線上版（v1.2.0）→ iPhone／iPad（線上安裝，v1.3.0）→ Android（v1.4.0）。六平台完成。外殼、語音教學、更新沿用 `xiaoke-compress`。

- `src/plan.ts`：資料格式（公尺；牆是中心線 x1,z1→x2,z2；門窗掛在牆上自動挖洞；房間是多邊形）、`normalizePlan`（也吃參考專案的方塊牆格式）、`repairJson`（AI 輸出修復）。
- `src/detect.ts`：本機辨識（純函式，vitest 可測）。Otsu → 每像素筆畫粗細 min(水平連續, 垂直連續)，只算細長筆畫估牆厚 T → 空心雙線牆用白間距估閉合半徑、粗而長筆畫大增才採用 → 水平／垂直牆段 → 不連主建築的群組（文字、標題）丟掉 → 同線牆段間的缺口：有平行細線＝窗、空的＝門（>1.6 m 當落地窗）；空心牆內 ≥3 條平行線切成窗 → 柱：實心、四周空、方或圓 → 房間：牆＋門窗當隔間，從圖邊填外面，剩下的區塊 Moore 追外框＋RDP。比例預設依門寬中位數 0.9 m（≥2 扇門），否則依牆厚。
- `src/scene.ts`：Three.js 建模（牆依門窗切塊、門片半開、窗框玻璃、房間木紋地板＋名稱／坪數標籤、屋頂、夜晚房間燈）、選取高亮、漫遊（碰撞，門洞可通過）、手機搖桿、WebXR（dolly、控制器瞬移、左搖桿移動右搖桿轉向）、GLTF/USDZ/OBJ/STL 匯出（標籤不匯出）。
- `src/editor2d.ts`：原圖疊辨識結果，選取／畫牆（吸附端點、自動水平垂直）／門窗（放最近的牆）／柱／刪除；滾輪縮放、拖空白平移。
- `src/command.ts`：本機自然語言規則（中文數字、單位、目標＝選取／房間名／類型）；看不懂回 `ok:false, message:''` 交給 AI。
- `src/ai.ts`：OpenAI Responses API（使用者自備金鑰存 localStorage，預設 gpt-5.4-mini）：讀整張圖、本機＋AI（房名與尺寸標註比例）、AI 指令、gpt-4o-mini-transcribe 語音。
- `src/store.ts`：IndexedDB 歷史（最多 40 筆，含原圖 dataURL）。
- `src/main.ts`：介面、undo/redo、`window.xkApp`（教學與 e2e 用）。`src/xiaoke.ts`：語音教學 14 步（會載入範例、示範漫遊與指令、最後復原）、檢查更新（achir1015/xiaoke-floorplan）。
- `electron/main.cjs`：xkfloor:// 載入 dist、存檔對話框（預設「文件\小柯平面圖3D」；XK_SAVE_DIR 給測試直接存）、麥克風權限、更新。

## 指令（Node 22：`%LOCALAPPDATA%\nvm\v22.22.3\node.exe`，PATH 裡的是 20；Git Bash 要用 /c/Users/achir/AppData/Local/nvm/v22.22.3）

```bash
node node_modules/vitest/vitest.mjs run        # 23 項（辨識、比例、指令、JSON 修復）
DEBUG_IMG="a.png;b.png" node node_modules/vitest/vitest.mjs run tests/debug.test.ts   # 辨識結果畫回原圖 → e2e/out/*-debug.png/.txt
node node_modules/typescript/bin/tsc
node node_modules/vite/bin/vite.js build
node e2e/desktop.mjs [--guide]                # 桌面 e2e 29 項（XK_EXE= 測已安裝版；XK_SHOTS= 存截圖）
CSC_IDENTITY_AUTO_DISCOVERY=false node node_modules/electron-builder/cli.js --win nsis portable --x64 --publish never "-c.directories.output=E:\xkf-build"
python scripts/make_samples.py                # 範例平面圖＋測試答案
python scripts/make_icon.py                   # 圖示（小柯＋藍圖上立起的房子）
```

預覽：`E:\AI Agent\Claude Code\.claude\launch.json` 的 `xiaoke-floorplan-web`（vite 5210）。

## 狀態

- 2026-11-18 Windows v1.0.0：已 /S 安裝到 %LOCALAPPDATA%\Programs\XiaokeFloorplan（桌面＋開始選單捷徑），安裝檔副本 `../安裝檔`；開發版與已安裝版 e2e 29 項全過（含教學）。
- 2026-11-18 使用者同意後建公開 repo https://github.com/achir1015/xiaoke-floorplan（main），v1.0.0 Release 手動上傳安裝版＋免安裝版（無 CI，說明 .github/release-notes.md）；e2e/update-check.mjs 實測已安裝版讀得到 v1.0.0 與安裝檔。沒有 gh CLI：用 git credential fill 取 token 打 API。

- 2026-11-18 v1.1.0 Mac 版：`.github/workflows/build.yml` 推 package.json 版本即建 win＋mac-arm64＋mac-x64 並發 Release（說明 .github/release-notes.md）；build/adhoc-sign.cjs 做 ad-hoc 簽章（未公證）。Intel Mac（yu-juhwu@192.168.6.32，macOS 26.3）`scripts/mac-install-test.sh <dmg> --guide` 29 項通過（測試資料夾 ~/Developer/xiaoke-floorplan-test，只放 e2e/desktop.mjs 與 scripts）；Apple 晶片 dmg 確認 arm64、簽章通過（沒實機）。Windows 程式內更新 1.0.0→1.1.0 實測成功（e2e/update-install.mjs，會自動重開新版）。等 CI：`GITHUB_TOKEN=… node e2e/wait-ci.mjs`。
- 2026-11-18 v1.2.0 線上版 https://achir1015.github.io/xiaoke-floorplan/：`.github/workflows/pages.yml` 推 main（src/public/index.html/package.json 有改）自動部署（Pages build_type=workflow，已用 API 啟用）。網頁版與桌面版同一份程式（body.web；存檔改下載；沒金鑰時 Chrome／Safari 用內建語音辨識）。HTTPS 所以 VR 眼鏡瀏覽器可直接 WebXR。預覽：xiaoke-floorplan-web（vite 5210）、xiaoke-floorplan-dist（python 靜態 5211）。live 站實測辨識、指令、GLB 匯出、version.json 正常。
- 2026-11-18 v1.3.0 iPhone／iPad：ios/ 照抄 xiaoke-screw（XcodeGen，com.achir.xiaokefloorplan，顯示名「小柯平面圖3D」，LocalServer 埠 48321；加 NSMicrophone／Camera／PhotoLibrary 說明；USDZ 匯出改用 QLPreviewController＝AR 快速查看，其他檔走分享選單）。網頁端 src/xiaoke.ts 的 iosApp()／iosSave()、檢查更新導到 /ios/、教學有 ios 版說法；2D 加兩指縮放。Mac 上 ~/Developer/xiaoke-floorplan（從 Windows 用 `tar --force-local -cf - package.json dist ios | ssh … tar -xf -`），`osascript ios/run-in-terminal.applescript "bash ~/Developer/xiaoke-floorplan/ios/build-ipa.sh"`，完成看 ios/build/ipa.done。安裝頁 public/ios/（manifest.plist 的 bundle-version 要跟版本改）；.ipa 手動上傳 Release，檔名固定 xiaoke-floorplan-ios.ipa。iPhone 15 Pro Max devicectl 安裝＋啟動成功；iPhone 17 Pro Max／iPad Pro 13 模擬器截圖確認（教學、範例、3D）。
- 2026-11-18 v1.4.0 Android：android/ 照抄 xiaoke-screw（無 Gradle，`python android/build.py [debug] [install]`；SDK/JDK 在 local.properties，不進 git），com.achir.xiaokefloorplan「小柯平面圖3D」；匯出存「下載/小柯平面圖3D」；系統 TTS 語音教學；麥克風用 onPermissionRequest＋RECORD_AUDIO 執行期權限；返回鍵 window.__xkBack（關教學／對話框／匯出選單／漫遊回鳥瞰）。金鑰 android/xiaokefloorplan.jks（alias xiaokefloorplan、密碼 android，不進 git、沒放 Secret，遺失就無法覆蓋安裝，要提醒使用者備份）。SM-S9380 e2e/android.mjs 16 項全過（debug 版＋adb forward tcp:9336 localabstract:webview_devtools_remote_<pid>）。APK 手動上傳 Release，檔名 XiaokeFloorplan-<版本>-android.apk（Bridge.java 的更新靠這個檔名）。iOS 同步重建 1.4.0（版本要跟 version.json 一致，不然 iPhone 會一直提示更新）。
- 發佈新版（完整）：改 package.json 版本＋release-notes＋public/ios/manifest.plist → 推 main（CI 建 Win＋Mac、Pages 更新）→ Mac 建 .ipa 上傳 xiaoke-floorplan-ios.ipa → `python android/build.py` 上傳 APK。

## 坑

- NSIS 在中文路徑輸出會失敗：輸出到 E:\xkf-build。
- 新 userData 第一次開會自動播教學，e2e 要帶 noguide（XK_QUERY）。
- e2e 結束時 child.kill 在 Windows 可能殺不乾淨，留下的視窗會讓下一個測試連不上：先 Stop-Process XiaokeFloorplan。
- Claude 預覽窗格在手機模擬時 requestAnimationFrame 一秒只跑約一格：測搖桿移動要看位置有沒有變，不要看速度。
- Bash 工具的 heredoc 內容有反引號會解析失敗：大檔用 Write 工具寫。
- 模糊／雜訊掃描圖：內牆比外牆細，牆門檻用 0.45T；文字會被誤認為柱 → 柱要「方或圓＋實心＋四周空」。斜放（歪掉超過 1°）的圖還沒做自動校正。
