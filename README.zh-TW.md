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
- **老實面對過期資料。** 超過新鮮度門檻的讀數會轉灰，標示「資料截至 HH:MM」，不做內插、不假裝精準。
- **收合不佔位。** 拖到任一螢幕邊緣就收成一小條梯形，懸停點亮、點擊展開。
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
│   ├── resources.js           依開發／打包環境解析 scripts/ 的實際路徑
│   └── statusline-setup.js    從 app 內安裝／移除 Claude Code statusline
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

**方式 A —— 安裝檔（一般使用建議選這個）**

到 release 下載 `Usage Monitor <版本號> Setup.exe` 執行即可。這是使用者層級安裝（不需要管理員權限），有正常的解除安裝項目與桌面捷徑。

**方式 B —— 免安裝版（portable）**

下載 `Usage Monitor <版本號> Portable.exe` 直接雙擊執行，不需要安裝步驟。注意：portable 版每次啟動都會解壓到新的暫存目錄，所以 Claude statusline 整合（見下方）會退回用你系統裡的 `node`，而不是 app 自帶的執行環境。如果你打算用這個版本的 statusline 功能，請先裝好 Node.js。

**方式 C —— 從原始碼執行**

```sh
git clone <this-repository>
cd "Usage Monitor"
npm install
npm start
```

### 自己打包安裝檔

```sh
npm run dist        # 同時產出 NSIS 安裝檔與 portable exe
npm run dist:dir     # 只產出未壓縮版本，用於快速本機測試
```

輸出在 `dist/` 底下。**平常開發不需要重新打包**——`npm start` 直接讀 `src/` 底下的原始碼執行。打包只在你要把成品交給別人時才需要跑一次。

### 接上 Claude 那半

Claude 的百分比只能透過 Claude Code 的 statusline 在本機取得。打開懸浮球的面板 → 齒輪圖示 → **Claude statusline**，按下**安裝**。接著重開 Claude Code、送出一則訊息——`rate_limits` 要等到 session 的第一個 API 回應之後才會出現。

（舊的做法 `npm run install-statusline` 還在，但它寫進 `~/.claude/settings.json` 的指令跟 app 內建安裝的不一樣，兩邊互看都會判定成「已被其他設定佔用」。建議一律用面板裡的按鈕。）

## 已知限制

- **Claude 那半經常會是灰的。** 如果你主力用的是 Claude 桌面程式而非 Claude Code，桌面程式燒掉的額度不會即時反映，要等你下次在 Claude Code 講話才會補上——這不是 bug，合規的替代方案不存在（詳見 HANDOFF.md 裡已查證並排除的方案）。
- **僅支援 Windows。** 視窗吸附的幾何運算、拖曳處理、Antigravity 探索腳本都是 Windows 專屬。
- **未經程式碼簽章。** 下載的版本第一次執行會被 Windows SmartScreen 擋下，選「其他資訊 → 仍要執行」即可。
- **不支援開機自啟**（v1 刻意排除的範圍）。

## 授權

[MIT](LICENSE)
