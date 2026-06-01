# 前車提醒 PWA

這是一個給 iPhone 11 使用的前景相機 PWA。手機固定在車架上後，App 會用畫面穩定度近似判斷本車與前車停止；停止超過指定秒數後自動待提醒，前車移動時用聲音、畫面閃爍或通知提醒。

## 使用方式

1. 用 HTTPS 網址開啟 `index.html`。
2. 在 iPhone Safari 按分享，選擇「加入主畫面」。
3. 從主畫面啟動 App，允許相機權限。
4. 停等時把框線對準前車，按「開始監看」。
5. 畫面與框選區域穩定超過「停止秒數」後，App 會自動待提醒；框內前車移動時會提示。
6. 怠速抖動造成無法進入停止時，調高「抖動容忍」；畫面上的「停 X秒」會顯示目前已累積停止多久。

## 更新版本

PWA 會註冊帶版本號的 Service Worker。當重新載入或重新開啟 App 時，如果偵測到新版，會讓新版 Service Worker 立即接管並自動再重新整理一次，畫面左上角版本號會更新。

## 重要限制

- 這是輔助提醒，不是行車安全系統。
- PWA 必須在前景、螢幕亮著、相機開啟時才會偵測。
- iOS 背景執行與鎖定螢幕時不能可靠持續使用相機。
- PWA 不能直接讀取車速；本車停止是用整體畫面穩定度近似判斷。
- App 會學習停車時的整體抖動基準，但手機支架鬆動、雨刷、強反光仍可能造成誤判。
- iOS Safari/PWA 不支援 Web Vibration API，iPhone 上會自動停用震動選項。
- 聲音使用 HTMLAudio 音檔加 WebAudio 雙路播放，需要先點「開始偵測」或「測試提醒」解鎖。
- 如果仍然聽不到，請檢查 iPhone 音量、靜音鍵、藍牙輸出與專注模式；PWA 不能繞過系統靜音。
- 起步前仍需自行確認號誌、車流、行人與路況。

## 本機開發

這個專案沒有建置步驟，可以直接用任一靜態伺服器開啟。

```powershell
python -m http.server 4173
```

接著開啟 `http://localhost:4173`。

## Web Codex 上線

Web Codex 改版前先確認雲端 repo 與正式網站版本：

```powershell
node scripts/check-cloud-version.mjs
```

改版後用以下指令同步升版：

```powershell
node scripts/bump-version.mjs 2.12.2
```

完整流程請看 `WEB_CODEX.md`。Codex 專案指令請看 `AGENTS.md`。
