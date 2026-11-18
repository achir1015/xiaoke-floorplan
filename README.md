# 小柯機器人建築平面圖轉3D工具
<img width="1906" height="987" alt="image" src="https://github.com/user-attachments/assets/ac64bab1-777d-4a6c-818a-bda5cb610d16" />
<img width="800" height="450" alt="image" src="https://github.com/user-attachments/assets/91743010-dcc1-4715-a9b2-141c516bfe21" />
示範

https://github.com/user-attachments/assets/4e6d0483-d398-41fc-b5cf-3384ed38e70a



https://github.com/user-attachments/assets/bdeefeab-f409-41ca-a2e3-ebc4aa4d3520


上傳一張 2D 建築平面圖，小柯會自動辨識牆、門、窗、柱子與房間，蓋成可以走進去參觀的 3D 空間；可以用中文或英文說一句話修改模型，還能戴上 VR 眼鏡用真實比例觀看。

## 功能

- **自動辨識**：本機辨識（免費、離線，支援實心牆與空心雙線牆）；有 OpenAI 金鑰時可用「本機＋AI」讀出房間名稱與尺寸標註，或讓 AI 讀整張圖。
- **比例**：預設依一般門寬 90 公分推算，也可依牆厚，或輸入建築實際總寬校正。
- **2D 修正**：原圖疊上辨識結果，可畫牆、加門窗柱、刪除。
- **3D 檢視**：鳥瞰、俯視、漫遊（W A S D／手機搖桿，牆會擋、門可以走過去）、白天／夜晚、屋頂、房間名稱與坪數。
- **VR**：支援 WebXR 的眼鏡（Meta Quest 等）在瀏覽器開線上版按「VR」即可走進去；左搖桿移動、右搖桿轉向、扣板機瞬移。
- **自然語言指令**：「把牆漆成淺藍色」「牆壁高度增加 50 公分」「刪除所有柱子」「把空間 A 改名為客廳」「晚上開燈」…；複雜指令可交給 AI，也能用麥克風說。
- **匯出**：GLB（VR 眼鏡、SteamVR、Unity、Unreal、Blender）、USDZ（Apple Vision Pro、iPhone／iPad AR）、OBJ、STL（3D 列印 1:100）、PNG 截圖、.xkplan 專案檔。
- 語音動態教學、歷史紀錄、程式內更新。

## 平台

| 平台 | 狀態 |
| --- | --- |
| Windows 11 | v1.0.0 起 |
| macOS（Apple 晶片／Intel） | v1.1.0 起 |
| 線上版 https://achir1015.github.io/xiaoke-floorplan/ （VR 眼鏡瀏覽器可直接進入 VR） | v1.2.0 起 |
| iPhone／iPad（線上安裝） | 規劃中 |
| Android | 規劃中 |

## 開發

```bash
npm install
npm run dev          # 網頁開發
npm test             # 單元測試
npm run app          # 桌面版
npm run dist:win     # Windows 安裝檔
```

開發：吳玉柱 先生 與 Claude AI Opus 5.5

構想參考 [akaiHuang/ai-floorplan-to-3d](https://github.com/akaiHuang/ai-floorplan-to-3d)（未使用其程式碼）。3D 引擎 [three.js](https://threejs.org/)（MIT）。授權：MIT。
