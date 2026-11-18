## 小柯機器人建築平面圖轉3D工具 v1.2.1（辨識改進）

修正：有些平面圖只辨識出一部分牆。

- 牆和牆之間只隔著窗或門時，以前會把其中一整片牆誤當成雜訊刪掉；現在會正確連起來
- 門開在牆角旁（門的一邊緊貼另一道牆）現在也找得到
- 用「開門弧線」判斷門，門片畫在牆線上的門不會再被當成窗；比較淡的弧線也看得到
- 沒有門也沒有窗框的走道開口（例如客廳通餐廳）不再硬放一扇門

線上版：https://achir1015.github.io/xiaoke-floorplan/ （重新整理即是新版）

- Windows：`XiaokeFloorplan-1.2.1-win-x64.exe`（安裝版，建議）、`XiaokeFloorplan-1.2.1-win-x64-portable.exe`（免安裝）
- Mac（Apple 晶片 M1～M4）：`XiaokeFloorplan-1.2.1-mac-arm64.dmg`
- Mac（Intel）：`XiaokeFloorplan-1.2.1-mac-x64.dmg`

已安裝的 Windows 版按「檢查更新」就能直接升級。

開發：吳玉柱 先生 與 Claude AI Opus 5.5
