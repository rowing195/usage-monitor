# 拖曳漂移與 0.7 秒限制

日期：2026-08-09

## 症狀

按住浮動旋鈕拖曳後，只要不放開滑鼠，orb 就會自己往右下持續漂移，離靜止的游標越來越遠，最後跑出畫面。移動途中和停下不動時都會發生，停下不動時反而更明顯。

## 根因

**不是座標累加，是視窗尺寸累加。**

`win.setPosition(x, y)` 只帶座標，尺寸沿用它從視窗讀回來的值。在非整數縮放的螢幕（本機 125%）上，這個尺寸撐不過一次來回轉換：

```
96 DIP → 120 實體像素 → 讀回來變成 97 DIP
```

Electron 螢幕座標轉 DIP 用的是「外接矩形」（左邊界向下取整、右邊界向上取整），所以每呼叫一次 `setPosition`，視窗記錄的尺寸就胖 1px，而且會被寫回真正的視窗。實測一次長按拖曳中每 25 個 tick 印一次 `win.getBounds()`：

```
[TICK]   1  getBounds= {"x":597,"y":297,"width":97, "height":97}
[TICK]  26  getBounds= {"x":585,"y":284,"width":120,"height":116}
[TICK]  51  getBounds= {"x":572,"y":272,"width":143,"height":132}
[TICK] 126  getBounds= {"x":532,"y":231,"width":196,"height":189}
[TICK] 301  getBounds= {"x":532,"y":231,"width":196,"height":364}
```

視窗左上角座標完全正確、沒有漂移（`x:532, y:231` 從 tick 126 到 301 紋風不動），但視窗一路往右下長大。orb 是用 CSS `left:50%; top:50%` 置中在視窗裡的，所以**看得見的圓點就以每次事件 1px 的速度往右下滑走**。

停下不動反而漂得最兇，是因為 Chromium 在視窗被重新定位期間，即使游標完全靜止也會持續發送 `pointermove`；舊程式每收到一次就呼叫一次 `setPosition`，於是尺寸持續膨脹。

### 連帶災情

膨脹後的假尺寸會餵給 `edgeNear()`（`src/main/index.js:123` 用 `bounds.width/height` 算離螢幕邊緣的距離），導致 orb 距離右緣還有 109px 就被誤判成貼邊並吸附：

```
[SETTLE] bounds= {"x":1332,"y":204,"width":192,"height":200}
         area= {"x":0,"y":0,"width":1536,"height":816}  edge= right
```

## 0.7 秒限制的實際行為

舊的 `DRAG_IDLE_MS = 700` watchdog：游標靜止滿 0.7 秒就判定拖曳結束。實測後果有兩個：

1. 手還按著，orb 已經自己 `settleDock()` 吸附到邊緣。
2. 之後真的放開時，`drag` 已是 `null`，`drag-end` 走進 `else` 分支 → **彈出設定面板**。

（實測窗口尺寸從 120x120 變成 400x525 就是面板。）

## 解法

### 1. 不讓尺寸進入轉換迴圈 — `src/main/index.js:281`

改用 `win.setBounds({ x, y, ...ORB })`，每次移動都明確重申尺寸常數，不再用 `setPosition`。尺寸從頭到尾沒有被讀回來過，所以任何縮放比例下都不可能累加。

### 2. 拖曳改由主行程計時器驅動 — `src/main/index.js:289`

`drag-start` 啟動 8ms 的 `setInterval`（`DRAG_FRAME_MS`），每個 tick 讀 OS 游標絕對座標，位置一律由「按下時的原點 + 游標總位移」重算，不是逐次推移。靜止的游標永遠算出同一個位置，經過幾個 tick 都一樣。

`drag-move` IPC 整條移除（含 `src/preload.js` 的 `dragMove`），渲染程序的 pointermove 洪流再也影響不到視窗位置。

### 3. 移除 0.7 秒限制，改用不帶時間的保險 — `src/renderer/renderer.js:298`

watchdog 全部刪除。放開滑鼠是唯一結束拖曳的方式，按住不動多久都不會被打斷。

原本 watchdog 是為了防「pointerup 遺失」而存在的，改用：

```js
document.addEventListener('pointermove', (e) => {
  if (dragging && e.buttons === 0) endDrag(e);
});
```

後續任何一次移動時如果沒有按著鍵，就代表放開事件漏掉了，立刻結束。沒有時間門檻。原有的 `pointerup` / `lostpointercapture` / `pointercancel` / `blur` 監聽保留。

## 驗證

用 Win32 合成滑鼠事件（`SetCursorPos` / `mouse_event`）驅動，量測視窗實體矩形與游標的偏差：

```
after moving right:  size=120x120  orbCentre-cursor=-1,-1
  t+1s ... t+6s      size=120x120  orbCentre-cursor=-1,-1   ← 按住 6 秒
after moving back:   size=120x120  orbCentre-cursor=0,0
before release:      size=120x120  orbCentre-cursor=0,0
after release:       size=120x120  原地不動
```

尺寸全程 120x120，圓心與游標偏差維持 ±1px，長按不再吸附、放開不再誤開面板。

其他路徑一併驗過：

| 操作 | 結果 |
|---|---|
| 單擊 orb | 開面板（400x525） |
| 點面板外 | 收回 orb（120x120） |
| 拖到右緣後放開 | 吸附成 nub（40x75 @ x=1880） |
| 點 nub | 展開成 orb |
| 從邊緣拖出來並按住 3 秒 | 跟隨正常、尺寸不變、放開留在原地 |

## 換裝置的適配性

**會自動適配**：所有尺寸常數都是 DIP，跟著 OS 縮放走；幾何一律當下從 `screen.getDisplayMatching(...).workArea` 計算，不寫死螢幕尺寸；跨機器帶過來的位置檔會被 clamp 回可視範圍。實測：

```
存檔 5000,3000  未吸附  ->  夾回 1440,720 DIP（右下角極限）
存檔 5000,3000  吸右邊  ->  右緣 nub
存檔 -900,-500  吸上緣  ->  0,0 橫向 nub
```

**已知缺口（既有行為，非本次引入）**：

1. 混合 DPI 的多螢幕：DIP 座標空間是各螢幕分段換算的，「原點 + 位移」假設空間均勻，拖過螢幕交界時抓取點可能一次性偏移。不會漂移或失控，重新按一次即正常。本機單螢幕，未驗證。
2. 執行中變更顯示設定（拔螢幕、改縮放）：位置只在啟動時 clamp，沒有監聽 `display-metrics-changed` / `display-removed`，orb 可能留在已不存在的座標上直到重開。

備註：`--force-device-scale-factor` 不能用來模擬別的縮放比例 —— 它只改變 Chromium 這一側，Windows 仍以實際 DPI 定位，兩個座標系會打架，測出來的數字無效。
