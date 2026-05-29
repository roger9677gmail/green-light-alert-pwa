# Web Codex 改版上線流程

這個專案的正式上線來源是 GitHub repo 的 `main` 分支：

- Repo: `roger9677gmail/green-light-alert-pwa`
- Live: `https://9677.fun`
- Pages source: `main`

## 1. 先確認雲端版本

在 Web Codex 開始改版前，先跑：

```powershell
git fetch origin
git status --short
git branch -vv
node scripts/check-cloud-version.mjs
```

確認三個版本：

- Local file version
- GitHub `main` version
- Live site version

如果 Web Codex 本機版本比 GitHub `main` 新，但 GitHub `main` 沒有，表示還沒有真正上線。

## 2. 修改功能

依照使用者需求修改檔案。若是前車偵測核心已被使用者確認好用，除非使用者明確要求，避免改動 YOLO 選車、鎖車與前車移動判斷。

## 3. 升版

每次要上線的行為變更都要升版：

```powershell
node scripts/bump-version.mjs 2.12.2
```

這會同步更新：

- `app.js` 的 `APP_VERSION`
- `index.html` 的 `styles.css?v=...`
- `index.html` 的 `app.js?v=...`
- `sw.js` 的 cache name
- `sw.js` 的 app/style cache URL

## 4. 檢查

```powershell
node --check app.js
git diff
```

確認沒有多改不相關的東西。

## 5. Commit + Push

```powershell
git add app.js index.html sw.js
git commit -m "Describe the change"
git push origin main
```

若有新增文件或工具，也要一起 `git add`。

## 6. 確認正式網站

Push 後等 GitHub Pages 更新，通常 1 到 3 分鐘。重複跑：

```powershell
node scripts/check-cloud-version.mjs
```

看到 Live site version 變成新版本，才代表正式網站真的上線。

手機 PWA 仍可能有 service worker cache。正式網站版本正確後，在 PWA 的「關於」按「強制更新至最新版」。
