# CLAUDE.md — 小柯機器人建築平面圖轉3D工具（xiaoke-floorplan）

需求文件：`../建築平面圖轉3d.docx`。開發過程見 `docs/開發紀錄.md`。

## 與使用者合作

- 一律用繁體中文回覆（App 按鈕原名可保留英文）。
- 開發者署名：吳玉柱 先生 與 Claude AI Opus 5.5。
- 推送、建 repo、發佈 Release 等對外動作先問過使用者；commit 作者用 GitHub noreply 信箱，任何檔案都不放使用者 email。

## 專案是什麼

上傳 2D 建築平面圖 → 辨識牆、門、窗、柱、房間 → Three.js 3D（鳥瞰／俯視／漫遊／WebXR VR）→ 中英文自然語言指令修改 → 匯出 GLB／USDZ／OBJ／STL／PNG／.xkplan。
構想參考 akaiHuang/ai-floorplan-to-3d（README 標 MIT，但沒有 LICENSE 檔），**沒有用它的程式碼**，本專案 MIT。
平台順序：Windows（v1.0.0）→ Mac → 線上版 → iPhone／iPad（線上安裝）→ Android。外殼、語音教學、更新沿用 `xiaoke-compress`。

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

## 坑

- NSIS 在中文路徑輸出會失敗：輸出到 E:\xkf-build。
- 新 userData 第一次開會自動播教學，e2e 要帶 noguide（XK_QUERY）。
- Bash 工具的 heredoc 內容有反引號會解析失敗：大檔用 Write 工具寫。
- 模糊／雜訊掃描圖：內牆比外牆細，牆門檻用 0.45T；文字會被誤認為柱 → 柱要「方或圓＋實心＋四周空」。斜放（歪掉超過 1°）的圖還沒做自動校正。
