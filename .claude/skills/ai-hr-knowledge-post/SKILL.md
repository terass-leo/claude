---
name: ai-hr-knowledge-post
description: Slackチャンネル #grp_ai-hr-knowledge に「AI×HR（人事）」のYouTube動画とnoteバズ記事を毎日1本ずつ、【要約】と【TERASS活用のヒント】付きで投稿するデイリージョブ。「AI HRナレッジ投稿して」「今日のAI HR便り」「grp_ai-hr-knowledgeに投稿」などの依頼、またはスケジュールされたRoutineから起動されたら必ず使うこと。
---

# AI×HR ナレッジ デイリー投稿

Slackの `#grp_ai-hr-knowledge`（channel_id: `C0BKW0AJBQV`）に、AI×HR（人事）領域の
①YouTube動画1本 ②noteのバズ記事1本 を、それぞれ【要約】【TERASS活用のヒント】付きで投稿する。

## 前提・制約

- youtube.com / note.com のページは WebFetch では 403 になる（bot保護）。**情報収集はすべて WebSearch で行う**こと。
- コンテナからの curl も外部一般サイトへはネットワークポリシーで403になる。curlでの収集は試みない。
- Slack投稿は `mcp__Slack__slack_send_message` を使う（Slackコネクタ必須）。

## 手順

### 1. 重複チェック（過去投稿の把握）

`slack_read_channel`（channel_id: `C0BKW0AJBQV`, limit: 50）で直近の投稿を読み、
**過去に紹介済みのYouTube URL / note URLを控える。同じURLは二度と投稿しない。**

### 2. YouTube動画の選定

WebSearch を複数クエリで実行し、候補を集める：

- `AI 人事 HR site:youtube.com`（allowed_domains: ["youtube.com", "www.youtube.com"]）
- `生成AI 人事 活用 site:youtube.com`
- `AI 採用 HR YouTube 動画 <今年>年` など、日によってクエリを変えて鮮度を出す

選定基準（優先順）：
1. 未投稿であること（手順1のリストと突合）
2. 公開が新しい・話題性がある（検索結果の日付情報を参考に）
3. 人事実務（採用・評価・労務・育成・組織開発）への示唆が具体的

内容が検索スニペットだけで足りない場合は、動画タイトルでもう一度 WebSearch して
解説記事・書き起こし等から内容を補強する。

### 3. note記事の選定

WebSearch を複数クエリで実行：

- `AI 人事 HR site:note.com`（allowed_domains: ["note.com"]）
- `生成AI 人事 site:note.com`
- `AI 採用 人事 note 話題` など

選定基準は動画と同じ（未投稿・新しさ/話題性・実務への示唆）。
「バズ」の判定はページのスキ数が直接取れないため、検索上位に出る・複数クエリで
繰り返し出る・タイトルに具体性があるものを「反響が大きい記事」とみなしてよい。

### 4. サマリー作成

各コンテンツについて日本語で作成する：

- **【要約】** … 3〜4文。何を主張・紹介している動画/記事か、具体的な数字や事例があれば含める。
- **【TERASS活用のヒント】** … 2〜3文。TERASSの文脈に引き付ける：
  - TERASSは不動産エージェント向けプラットフォーム企業（Terass Agent約1,500名規模、少数精鋭の本部組織）
  - HR Divの実務：本部採用（HERP）、半期評価（HiManager）、労務（freee人事労務）、エージェント向けサポート、1on1文化
  - 「明日から試せる」レベルの具体的な適用アイデアに落とす

### 5. Slack投稿

`slack_send_message` で `C0BKW0AJBQV` に1メッセージで投稿する。フォーマット：

```
:sunny: *AI×HRナレッジ便り* | YYYY/MM/DD（曜）

:tv: *今日のYouTube*
*<動画タイトル>*
<URL>
【要約】
（3〜4文）
【TERASS活用のヒント】
（2〜3文）

:memo: *今日のnoteバズ記事*
*<記事タイトル>*（著者名）
<URL>
【要約】
（3〜4文）
【TERASS活用のヒント】
（2〜3文）
```

- URLは裸で置く（Slackがプレビュー展開する）
- 全体で読み切れる分量（各セクション400字以内目安）に収める

### 6. 失敗時の挙動

- 検索で新規コンテンツが見つからない場合は、クエリを変えて最低3回は再検索する
- それでもYouTube/noteの片方しか見つからない場合は、見つかった方だけでも投稿し、
  本文中に「本日は◯◯のみ」と一言添える
- Slack投稿自体が失敗した場合はリトライし、それでも失敗したらエラー内容を残して終了する
