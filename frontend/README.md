# SF6 Buckler Dashboard (Chrome Extension MVP)

This extension provides a full-page dashboard (Session Buddy style) for SF6 Buckler battle log sync.

## What it does

- Uses your existing login session on `streetfighter.com`
- Syncs battle logs by paging `_next/data/.../battlelog.json?page=n&sid=...`
- Stores synced data in `chrome.storage.local`
- Shows players, win rate summary, and recent matches in a full tab UI

## Files

- `manifest.json`: MV3 config
- `background.js`: open dashboard + trigger sync on active tab
- `content/content.js`: fetch paged battle logs from Buckler page context
- `popup/*`: small launcher UI
- `dashboard/*`: full-page UI

## Load extension

1. Open Chrome `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `D:\Repository\StreetInfo`

## How to use

1. Log in on Buckler website
2. Open a profile or battle log page like:
   - `https://www.streetfighter.com/6/buckler/zh-hans/profile/<sid>/battlelog`
3. Click extension icon
4. Click `Sync current page`
5. Click `Open dashboard` to inspect synced results

## Notes

- Current MVP is single-tab trigger based (sync from active Buckler page)
- It adds request delay and stops on empty page/403/429
- Respect platform terms and avoid high-frequency scraping
