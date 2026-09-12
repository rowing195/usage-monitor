<div align="center">

# Usage Monitor

**Windows 桌面上的常駐懸浮球，一眼看出 Claude 與 Google Antigravity 的剩餘額度 —— 在撞牆之前先知道。**

[English README](README.md)

<img src="https://img.shields.io/badge/Electron-47848F.svg?style=flat-square&logo=Electron&logoColor=white" alt="Electron">
<img src="https://img.shields.io/badge/JavaScript-F7DF1E.svg?style=flat-square&logo=JavaScript&logoColor=black" alt="JavaScript">
<img src="https://img.shields.io/badge/Windows-0078D6.svg?style=flat-square&logo=Windows&logoColor=white" alt="Windows">
<img src="https://img.shields.io/badge/electron--builder-000000.svg?style=flat-square&logo=electron-builder&logoColor=white" alt="electron-builder">
<img src="https://img.shields.io/badge/npm-CB3837.svg?style=flat-square&logo=npm&logoColor=white" alt="npm">

</div>

---

## 這是什麼

Usage Monitor 是一顆 Windows 上常駐置頂的小懸浮球，追蹤的是兩個工具的**剩餘額度**——不是 token 統計：

- **Claude**（透過 Claude Code 的 statusline，本機唯一真的會帶出 `rate_limits` 百分比的來源）
- **Google Antigravity**（打它本機的 language server API，每 60 秒輪詢一次）

球的圓環顏色讓你一眼看出離額度上限還有多遠。點一下打開面板，看到精確數字、重置倒數、各項來源明細。拖到螢幕邊緣會收合成一條不起眼的細長梯形。

這個專案存在的原因很單純：報 token 數的用量面板回答不了工作到一半最實際的那個問題——**還剩多少額度，什麼時候會被擋下來？** 這個區別背後完整的查證過程，包含被評估後排除的方案（尤其是那個未公開文件記載的 OAuth usage endpoint——2026-02-19 起這種用法已明文違反 Consumer ToS），寫在 [HANDOFF.md](HANDOFF.md) 裡。

## 特色

- **兩個額度來源，一眼掌握。** Claude 的 5 小時／7 天兩個 rate-limit 視窗，加上 Antigravity 的池化模型額度（11 個模型收斂成 2 個真正的池），統一換算到 0–100 排在一起比較。
- **球體與梯形即時同步 + 智慧鎖定。** 懸浮球與邊緣梯形統一顯示最近活躍使用的工具；使用 Claude 期間，若 7 天每週總額度達到 ≥ 90%，會自動強制鎖定顯示每週用量（紅色警報），切換回 Antigravity 則無縫切換，兩家工具壁壘分明。
- **真正的堅固置頂（Screen-saver Tier）。** 採用最高層級置頂與跨工作區／全螢幕支援，搭配視窗生命週期自愈機制，無論視窗切換、失去焦點或 Win+D 都不會被淹沒。
- **五種外觀，一個開關。** 設定面板最上方一列，可在木質（預設）、玻璃、儀器、紙墨、磷光之間切換，每個選項都用該風格的真實材質畫出自己的預覽。切換即時生效；所有外觀都只是同一組 token 的換值，版面、70/90 門檻與過期規則完全不動。玻璃是半透明而非霧面——透明視窗的背後沒有可供 Chromium 模糊的內容。
- **有機流動動效與彈簧物理（Fluid Morphing）。** 懸浮球登場彈性回彈、滑鼠懸停立體高光、面板阻尼展開與明細項錯落淡入；百分比更新採用平滑滾動 Ticker，進度環具備彈性緩動。
- **待機呼吸與警報光暈。** 待機時微光緩慢起伏；70% 警告（琥珀黃）與 90% 危險（警戒紅）時外圈自動產生柔和脈衝波紋——僅限會發光的外觀。儀器改為從錶面內側點亮，並替被跨過的那一格刻度上色；紙墨則是整顆圓盤翻成實心墨色，因為印刷不會閃。
- **GPU 60fps 硬體加速。** 獨立合成圖層渲染，確保所有幾何變形與呼吸動效在 Windows 透明視窗下絲滑不掉幀。
- **老實面對過期資料。** 超過新鮮度門檻的讀數會轉灰，標示「資料截至 HH:MM」，不做內插、不假裝精準。
- **收合不佔位。** 拖到任一螢幕邊緣就收成一小條梯形，懸停點亮、點擊展開。
- **不會默默在跑。** 通知區域（右下角）有常駐圖示，不必去找那顆半透明的球才能確認「到底有沒有開」。滑鼠停上去看最吃緊的那筆額度，左鍵顯示／隱藏懸浮球，右鍵叫出其餘選項。
- **開機自動啟動。** 設定面板裡一個開關就能向 Windows 註冊——僅限安裝版，portable 版沒有固定路徑可註冊。
- **只用顏色示警。** 不彈通知、不轟炸提醒——70% 琥珀色、90% 紅色。
- **App 內建 Claude Code 整合。** 在設定面板裡按一下就能安裝或移除必要的 statusline，不用手動編輯 JSON。
- **Antigravity 不需要額外的 CLI。** 直接打本機 language server 的 Connect API，不依賴那套（又慢又偶爾故障的）`antigravity-usage` 工具。

## 運作方式

```
Claude Code  ──statusline──▶  ~/.usage-monitor/claude-statusline.json  ──▶  懸浮球
Antigravity  ──本機 RPC，每 60 秒輪詢一次──▶  懸浮球
```

Claude 的百分比新鮮度取決於你上一次在 Claude Code 裡講話的時間——桌面程式和其他 Claude 介面不會餵資料進來。Antigravity 是獨立輪詢的，會自己保持最新。

## 專案結構

```
src/
├── main/
│   ├── index.js              視窗狀態機、拖曳、收合吸附、IPC
│   ├── providers.js           兩個資料來源：抓取、正規化、陳舊判定、排名
│   ├── autostart.js           設定開關背後的開機自動啟動註冊
│   ├── resources.js           依開發／打包環境解析 scripts/ 的實際路徑
│   ├── statusline-setup.js    從 app 內安裝／移除 Claude Code statusline
│   └── tray.js                通知區域圖示：提示文字、顯示／隱藏、右鍵選單
├── preload.js                 main 與 renderer 之間的 contextBridge
└── renderer/
    ├── index.html             球 / 收合梯形 / 面板，三態同頁
    ├── renderer.js             渲染與互動
    └── styles.css              主題與版面

scripts/
├── statusline.js               Claude Code 的 statusline 腳本本體
├── discover-antigravity.ps1    找出 Antigravity language server 的 port 與 CSRF token
└── install-statusline.js       舊版獨立安裝腳本（已被 app 內建的安裝功能取代）

start.vbs / start.bat           啟動器，不留下 console 視窗
```

執行期狀態存在 `~/.usage-monitor/`：`claude-statusline.json`、`window-state.json`、`settings.json`，安裝 statusline 後再加上 `statusline.cmd` / `statusline.js`。

## 開始使用

### 前置需求

- Windows 10 或 11
- Claude Code 登入的必須是 **Claude Pro 或 Max 訂閱帳號**——API 計費帳號永遠拿不到 `rate_limits`，球的 Claude 那半會一直是空的
- [Node.js](https://nodejs.org/)——只有從原始碼建置，或是使用 **portable** 版又想讓 Claude statusline 生效時才需要（原因見下方說明）

### 安裝方式

**方式 A —— 下載預先建置好的版本（一般使用建議選這個）**

到 [Releases 頁面](https://github.com/rowing195/usage-monitor/releases) 抓最新的 `Usage Monitor <版本號> Setup.exe`（安裝檔）或 `Usage Monitor <版本號> Portable.exe`（免安裝）。

- **Setup.exe**：使用者層級安裝，不需要管理員權限，有正常的解除安裝項目與桌面捷徑。
- **Portable.exe**：直接執行，不安裝任何東西。因為它每次啟動都會解壓到新的暫存目錄，Claude statusline 整合（見下方）會退回用你系統裡的 `node`，而不是 app 自帶的執行環境。如果你打算用這個版本的 statusline 功能，請先裝好 Node.js。

**方式 B —— 自己建置**

```sh
git clone https://github.com/rowing195/usage-monitor.git
cd usage-monitor
npm install
npm run dist        # 同時產出 NSIS 安裝檔與 portable exe
npm run dist:dir     # 只產出未壓縮版本，用於快速本機測試
```

輸出在 `dist/` 底下。

**方式 C —— 從原始碼執行**

```sh
git clone https://github.com/rowing195/usage-monitor.git
cd usage-monitor
npm install
npm start
```

平常開發不需要打包——`npm start` 直接讀 `src/` 底下的原始碼執行。打包（方式 A）只在你要產出可安裝或交給別人的成品時才需要。

### 接上 Claude 那半

Claude 的百分比只能透過 Claude Code 的 statusline 在本機取得。打開懸浮球的面板 → 齒輪圖示 → **Claude statusline**，按下**安裝**。接著重開 Claude Code、送出一則訊息——`rate_limits` 要等到 session 的第一個 API 回應之後才會出現。

（舊的做法 `npm run install-statusline` 還在，但它寫進 `~/.claude/settings.json` 的指令跟 app 內建安裝的不一樣，兩邊互看都會判定成「已被其他設定佔用」。建議一律用面板裡的按鈕。）

## 已知限制

- **Claude 那半經常會是灰的。** 如果你主力用的是 Claude 桌面程式而非 Claude Code，桌面程式燒掉的額度不會即時反映，要等你下次在 Claude Code 講話才會補上——這不是 bug，合規的替代方案不存在（詳見 HANDOFF.md 裡已查證並排除的方案）。
- **僅支援 Windows。** 視窗吸附的幾何運算、拖曳處理、Antigravity 探索腳本都是 Windows 專屬。
- **未經程式碼簽章。** 下載的版本第一次執行會被 Windows SmartScreen 擋下，選「其他資訊 → 仍要執行」即可。
- **開機自動啟動僅限安裝版。** Portable 版每次啟動都解壓到新的暫存目錄，沒有固定路徑可以寫進登錄檔，所以那個開關在 portable 版和開發環境下是灰的。
- **Windows 11 預設會藏起新的托盤圖示。** 第一次啟動時圖示會被收進 `^` 後面的溢位選單，把它拖到工作列上才會一直看得到。

## 授權

[MIT](LICENSE)
