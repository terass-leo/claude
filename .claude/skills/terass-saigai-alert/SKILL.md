---
name: terass-saigai-alert
description: 気象庁の公開防災情報（地震・津波・気象警報）を取得し、TERASS社員の現住所（都道府県・市区町村）と突合して、該当社員がいる場合にSlackへアラートを上げるスキル。「災害チェックして」「地震あったけど社員に影響ある？」「さっきの地震うちの誰か住んでる？」「安否アラート回して」「津波警報出てるけど大丈夫？」などの依頼、またはスケジュールされたRoutine（定期監視）から起動されたら必ず使うこと。※安否確認システム導入PJ（トヨクモ等の本格導入）までのつなぎ＋補完の位置づけ。
---

# TERASS 災害×社員現住所 突合アラート

気象庁の公開防災情報JSONを取得し、社員の現住所（都道府県・市区町村）と突合。
影響を受ける社員がいる場合のみ、Slack `#p_saigai`（channel_id: `C0BL1U5444T`、プライベート
チャンネル）にアラートを投稿する。

2つのモードがある：

- **定期監視モード** … Routineから起動。直近の未報イベントをチェックし、該当なしならサイレント終了（Slackに何も投稿しない）
- **オンデマンドモード** … 「さっきの地震、社員に影響ある？」等。指定されたイベントを突合して会話内で回答（Slack投稿は求められたときだけ）

## 前提・制約（2026/8/17 検証済み）

- **コンテナからの curl / WebFetch は jma.go.jp 等へ egress ブロックされる（403）**。
  災害情報の取得は必ず下記の **Zapierコードアクション** で行う。
- 社員住所は個人情報。**アラートに載せてよいのは「都道府県・市区町村」まで**。
  丁目・番地・建物名・郵便番号・生年月日は絶対に出力しない（Slack・会話・ログすべて）。
- 対象は本部社員のみ（住所マスタの範囲）。Terass Agent（約1,500名）は対象外。

## データ取得：Zapierコードアクション

`mcp__Zapier__execute_zapier_write_action` で以下を呼ぶ：

- `selected_api`: `WebHookCLIAPI`
- `action`: `code_action_webhookcliapi__fetch_disaster_feed`
- `params`: `{"url": "<取得したいURL>"}`

レスポンスは `results.data.data` にJSON本体が入る。**大きいレスポンス（地震リストは約670KB）は
ツール結果がファイルに保存されるので、コンテキストに読み込まず Bash + python3 でパースすること。**

このアクションが存在しない場合は `mcp__Zapier__write_code_action` で再作成する：
`selected_api: WebHookCLIAPI`, `code_action_name: fetch_disaster_feed`, requirements:
「Make an HTTP GET request to a public disaster-information JSON endpoint and return the parsed
JSON. Accept one input parameter `url` (string, required). Only allow URLs whose host is exactly
one of: www.jma.go.jp, api.p2pquake.net — otherwise return {"error": "domain not allowed"}.
Send User-Agent "TERASS-anpi-alert/1.0". Return the response body parsed as JSON under key
`data`, plus `status`. If the body is larger than ~900KB, truncate arrays to the first 30
elements and set truncated: true. No authentication needed.」

### エンドポイント（すべて実フェッチ検証済み）

| 用途 | URL |
|---|---|
| 地震リスト（直近） | `https://www.jma.go.jp/bosai/quake/data/list.json` |
| 地震詳細（市区町村名＋震度入り） | `https://www.jma.go.jp/bosai/quake/data/{listのjsonフィールド値}` |
| 津波予報・警報リスト | `https://www.jma.go.jp/bosai/tsunami/data/list.json` |
| 気象警報（都道府県別） | `https://www.jma.go.jp/bosai/warning/data/warning/{都道府県コード2桁}0000.json`（例: 東京=130000） |

地震リストの主なフィールド：`eid`（イベントID）, `at`（発生時刻）, `anm`（震源地名）, `mag`,
`maxi`（最大震度）, `ttl`（情報種別）, `json`（詳細ファイル名）。
**同一 `eid` に「震度速報」「震源に関する情報」「震源・震度情報」が複数並ぶ。突合には
`ttl: "震源・震度情報"`（VXSE5k）の詳細JSONを使う**（`Body.Intensity.Observation.Pref[].Area[].City[]`
に市区町村名（漢字）と `MaxInt` が入っている）。`ift: "取消"` の報は無視する。

震度表記：`"1"〜"4", "5-"（5弱）, "5+"（5強）, "6-", "6+", "7"`。

## 住所マスタ

**住民税リスト（令和7年度）Arc_v2.xlsx** — Google Drive fileId: `1IDbHlFRXLM1I1k9_8omwzvod6ZXH4hJe`

- `mcp__Google_Drive__read_file_content` で読む（結果が大きくファイル保存されるので python3 でパース）
- 「202605時点」タブに社員テーブル：`氏名 / 社員番号 / 部署 / 役職 / … / 現住所（郵便番号）/
  現住所（都道府県）/ 現住所（市区町村）/ …`（2026/5時点 約121名）
- CSV化されたセル列から `氏名・部署・都道府県・市区町村` の4項目だけ抽出して使う
- このファイルが読めない・古い場合は Drive で `title contains '住民税'` を再検索し、最新年度版を使う
- ※将来、安否確認システム（トヨクモ安否確認サービス2等）導入後はそちらの従業員マスタに移行する

## 突合ロジック

1. **市区町村レベル**（第一優先）：詳細JSONの `City.Name` とマスタの「市区町村」を同一都道府県内で照合
   - 政令指定都市：JMAは「福岡西区」「横浜青葉区」のように **市名＋区名（"市"を省略）** 表記。
     マスタが「福岡市」のように市までなら、その市名で始まる全区の **最大震度** を採用
   - 東京23区：JMAは「東京千代田区」表記。マスタの「千代田区」等とは区名の包含で照合
   - マスタが「横浜市青葉区」のように区まで持つ場合は区単位で照合
2. **都道府県レベル**（フォールバック）：市区町村で観測点が無い／名寄せできない社員は、
   居住都道府県の最大震度（`Pref.MaxInt`）で判定し、その旨を注記する
3. 名寄せに迷ったら**広めに拾う**（過検知は許容、見逃しは不可）

## 発報基準（デフォルト）

| 事象 | 基準 | アクション |
|---|---|---|
| 地震 | 社員の居住市区町村で **震度4以上** | 通常アラート（該当社員リスト付き） |
| 地震 | 社員の居住市区町村で **震度5弱以上** | 強アラート：`<!channel>` 付き＋安否確認の実施を促す一文 |
| 地震 | 最大震度5弱以上だが該当社員なし | 参考情報として1行だけ投稿（リストなし） |
| 津波 | 津波注意報以上が発表され、対象沿岸の都道府県に社員が居住 | 通常アラート（大津波警報・津波警報は強アラート） |
| 気象 | 特別警報（大雨・暴風等）が社員居住都道府県に発表 | 通常アラート ※定期監視ではオプション（下記） |
| 上記未満（震度3以下のみ等） | — | **投稿しない（サイレント終了）** |

気象警報チェックは都道府県ごとに1フェッチ必要なので、定期監視ではデフォルト無効。
台風・大雨イベントが明らかなとき（依頼されたとき）に、社員が居住する都道府県分だけ回す。

## 手順（定期監視モード）

1. **地震リスト取得** → `at` が直近24時間以内かつ `maxi` が 4以上（`4/5-/5+/6-/6+/7`）のイベントを抽出。
   津波リストも取得し、直近24時間以内の津波注意報以上（`kind[].kind` に「津波注意報」「津波警報」
   「大津波警報」を含み、「解除」でないもの）を抽出
2. 対象イベントがゼロなら**ここで終了**（Slack投稿なし）
3. **重複チェック**：`slack_read_channel`（channel_id: `C0BL1U5444T`, limit: 30）で直近投稿を読み、
   本スキルの過去アラート（管理用フッターの `eid`）と突合。**既報の `eid` はスキップ**
4. 未報イベントがあれば **住所マスタを読み込み**、イベントごとに詳細JSONを取得して突合
5. 発報基準に該当すれば下記フォーマットで **Slack投稿**。該当社員ゼロかつ最大震度5弱未満なら投稿しない
6. 投稿後 `slack_read_channel`（limit: 1）で表示崩れがないか確認する

## Slack投稿フォーマット

```
:rotating_light: **災害アラート** | 地震（震度5弱以上は :bangbang: を追加）

**M4.4 福岡県福岡地方** 最大震度4（2026/8/17 06:37）
:point_right: [気象庁の情報](https://www.jma.go.jp/bosai/map.html#contents=earthquake_map)

**現住所が該当エリアの社員（6名）**
| 氏名 | 部署 | 居住地 | 現地震度 |
（震度降順。居住地は「都道府県＋市区町村」まで。震度が県レベル判定なら「県内最大」と注記）

:memo: 出典：気象庁防災情報 / 住所は住民税リスト2026/5時点
管理用: eid 20260817063722
```

- URLは必ず `[タイトル](URL)` 形式（裸URL禁止）。太字マーカー `**` の内側を `"「（` で始めない
  （Slack変換が壊れる既知の不具合。詳細は ai-hr-knowledge-post スキル参照）
- 震度5弱以上の強アラートは冒頭に `<!channel>`、末尾に
  「安否確認の実施をご検討ください（PJ: 安否確認システム導入）」を追加
- 管理用フッターの `eid`（津波は `eid`＋`tsunami`）は重複防止に必須。**絶対に省略しない**

## Routine設定（依頼されたら）

毎時監視の場合（**このスキルがデフォルトブランチにマージされてから**設定すること。
未マージだと新規セッションからスキルが見えない）：

- `mcp__Claude_Code_Remote__create_trigger` で
  `name: "災害×社員住所アラート（毎時）"`, `cron_expression: "0 * * * *"`,
  `create_new_session_on_fire: true`,
  `prompt: "terass-saigai-alert スキルを定期監視モードで実行して。該当がなければ何も投稿せず終了。"`,
  `connectors: ["Slack", "Google Drive", "Zapier"]`
- 解除・停止は `list_triggers` → `delete_trigger` / `update_trigger(enabled: false)`

## 失敗時の挙動

- Zapierコードアクションが失敗したら1回リトライ。それでもダメなら再作成（上記requirements）→再実行
- それでも取得不能なら、WebSearch（`地震 震度 速報 <今日の日付>` 等）で最大震度5弱以上の
  イベント有無だけ確認し、**ある場合のみ**「データ取得不能だが震度5弱以上の地震が報道されている」旨を
  Slackに投稿する（見逃し防止）。何もなければサイレント終了
- 住所マスタが読めない場合：イベント自体が発報基準（最大震度5弱以上・津波警報以上）に該当するなら、
  社員リストなしで「マスタ照合不能」と明記してアラートだけ出す
- 定期監視モードでは、エラーで終了する場合も**チャンネルにエラーを書き込まない**（会話ログにのみ残す）
