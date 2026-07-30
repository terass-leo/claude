# -*- coding: utf-8 -*-
import os
HERE=os.path.dirname(os.path.abspath(__file__))
import json, io
C=json.load(open(os.path.join(HERE,'charts.json')))

CSS = r"""
<style>
:root{
  color-scheme: light;
  --paper:#FAF7F1; --panel:#FFFDF9; --hair:#E2DCD1; --hair-2:#EFEAE0;
  --ink:#151A22; --ink-2:#4A4740; --muted:#7A756B;
  --bronze:#8A6217; --bronze-soft:#F0E4C8;
  --s1:#63AEAA; --s2:#2E908C; --s3:#157370; --s4:#0A4F4D;
  --data:#157370; --data-soft:#E3EFEE;
  --good:#1F7A4D; --warn:#B25E12; --crit:#A32B2B;
  --good-bg:#E6F0E9; --warn-bg:#F7E9DA; --crit-bg:#F5E3E1;
  --track:#EDE8DE; --now:#F3EEE2;
  --f-disp:"Hiragino Mincho ProN","Yu Mincho",YuMincho,"Noto Serif JP","Songti SC",serif;
  --f-body:"Hiragino Sans","Yu Gothic",YuGothic,"Noto Sans JP",system-ui,-apple-system,sans-serif;
  --f-data:ui-monospace,"SF Mono",SFMono-Regular,Menlo,"Roboto Mono",monospace;
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])){
    color-scheme: dark;
    --paper:#141A23; --panel:#19202B; --hair:#2A303B; --hair-2:#232A35;
    --ink:#F2EFE8; --ink-2:#B9B3A7; --muted:#8B8578;
    --bronze:#D3A64A; --bronze-soft:#3A3020;
    --s1:#9BDCD7; --s2:#6BC3BE; --s3:#3FA29D; --s4:#23807C;
    --data:#3FA29D; --data-soft:#1D2A2E;
    --good:#4FB380; --warn:#DE9440; --crit:#E57373;
    --good-bg:#1B2A22; --warn-bg:#2E2317; --crit-bg:#2E1D1D;
    --track:#232A35; --now:#1F2731;
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --paper:#141A23; --panel:#19202B; --hair:#2A303B; --hair-2:#232A35;
  --ink:#F2EFE8; --ink-2:#B9B3A7; --muted:#8B8578;
  --bronze:#D3A64A; --bronze-soft:#3A3020;
  --s1:#9BDCD7; --s2:#6BC3BE; --s3:#3FA29D; --s4:#23807C;
  --data:#3FA29D; --data-soft:#1D2A2E;
  --good:#4FB380; --warn:#DE9440; --crit:#E57373;
  --good-bg:#1B2A22; --warn-bg:#2E2317; --crit-bg:#2E1D1D;
  --track:#232A35; --now:#1F2731;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--f-body);
  font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased;
  font-feature-settings:"palt" 1;}
.wrap{max-width:1180px;margin:0 auto;padding:56px 28px 96px;display:flex;flex-direction:column;gap:56px}
@media(max-width:720px){.wrap{padding:32px 18px 64px;gap:40px}}

/* ---------- masthead ---------- */
.mast{display:flex;flex-direction:column;gap:18px;
  border-bottom:1px solid var(--hair);padding-bottom:28px}
.eyebrow{font-family:var(--f-data);font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--bronze);display:flex;align-items:center;gap:10px}
.eyebrow::before{content:"";width:26px;height:1px;background:var(--bronze);flex:none}
h1{font-family:var(--f-disp);font-size:clamp(30px,4.4vw,46px);line-height:1.24;
  margin:0;font-weight:600;letter-spacing:.01em;text-wrap:balance}
.dek{color:var(--ink-2);max-width:62ch;margin:0;font-size:15.5px}
.mast-meta{display:flex;flex-wrap:wrap;gap:8px 28px;font-family:var(--f-data);
  font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.mast-meta b{color:var(--ink-2);font-weight:500}

/* ---------- condition band ---------- */
.signals{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hair);
  border:1px solid var(--hair)}
@media(max-width:900px){.signals{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.signals{grid-template-columns:1fr}}
.sig{background:var(--panel);padding:20px 20px 18px;display:flex;flex-direction:column;gap:9px;
  position:relative}
.sig::before{content:"";position:absolute;inset:0 auto 0 0;width:3px}
.sig.is-good::before{background:var(--good)}
.sig.is-warn::before{background:var(--warn)}
.sig.is-crit::before{background:var(--crit)}
.sig-h{font-family:var(--f-data);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}
.sig-n{font-family:var(--f-data);font-size:31px;line-height:1;font-variant-numeric:tabular-nums;
  letter-spacing:-.02em;font-weight:500}
.sig-n .u{font-size:15px;color:var(--muted);margin-left:2px;letter-spacing:0}
.sig-sub{font-size:12.5px;color:var(--ink-2);line-height:1.6}
.sig-sub .fig{font-family:var(--f-data);font-variant-numeric:tabular-nums}
.pill{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;
  font-family:var(--f-data);font-size:10.5px;letter-spacing:.08em;padding:2.5px 8px;
  border-radius:2px;font-weight:600}
.pill.is-good{background:var(--good-bg);color:var(--good)}
.pill.is-warn{background:var(--warn-bg);color:var(--warn)}
.pill.is-crit{background:var(--crit-bg);color:var(--crit)}
.verdict{background:var(--panel);border:1px solid var(--hair);border-left:3px solid var(--bronze);
  padding:20px 24px;font-size:15px;line-height:1.85;color:var(--ink-2)}
.verdict b{color:var(--ink);font-weight:600}

/* ---------- sections ---------- */
section{display:flex;flex-direction:column;gap:22px}
.s-head{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--hair);padding-top:16px}
.s-head .eyebrow::before{width:18px}
h2{font-family:var(--f-disp);font-size:23px;line-height:1.35;margin:0;font-weight:600;letter-spacing:.01em}
.s-note{color:var(--muted);font-size:13px;max-width:74ch;margin:0;line-height:1.7}
.panel{background:var(--panel);border:1px solid var(--hair);padding:26px 26px 22px}
.panel.tight{padding:20px}
.scroll{overflow-x:auto}
.two{display:grid;grid-template-columns:1fr 1fr;gap:22px}
@media(max-width:860px){.two{grid-template-columns:1fr}}

/* ---------- charts ---------- */
.chart{width:100%;height:auto;display:block}
.grid{stroke:var(--hair-2);stroke-width:1}
.base{stroke:var(--hair);stroke-width:1}
.div{stroke:var(--bronze);stroke-width:1;stroke-dasharray:2 4;opacity:.7}
.now{fill:var(--now)}
.ax{font-family:var(--f-data);font-size:10.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.ax-r{text-anchor:end}.ax-r2{text-anchor:end}.mid{text-anchor:middle}
.ax.sm,.sm{font-size:9.5px;letter-spacing:.08em}
.ax.em{fill:var(--ink-2);font-weight:600}
.tag{fill:var(--warn);letter-spacing:.08em;font-weight:600}
.tag-q{fill:var(--muted);letter-spacing:.08em}
.val{font-family:var(--f-data);font-size:12px;fill:var(--ink);text-anchor:middle;
  font-variant-numeric:tabular-nums;font-weight:600}
.val.lg{font-size:15px}
.bar-t{fill:none;stroke:var(--bronze);stroke-width:1.25;stroke-dasharray:3 2.5}
.bar-a{fill:var(--data)}
.bar-a.peak{fill:var(--warn)}
.zero{fill:var(--muted);opacity:.5}
.bar-a,.fn-b,.g-b{transition:opacity .12s ease}
.chart:hover .bar-a,.chart:hover .fn-b,.chart:hover .g-b{opacity:.55}
.bar-a:hover,.fn-b:hover,.g-b:hover{opacity:1}
.legend{display:flex;flex-wrap:wrap;gap:8px 22px;font-family:var(--f-data);font-size:11px;
  color:var(--muted);margin-top:6px}
.legend span{display:inline-flex;align-items:center;gap:7px}
.key{width:13px;height:11px;flex:none;border-radius:2px}
.key.t{border:1.25px dashed var(--bronze);background:none}
.key.a{background:var(--data)}
.key.p{background:var(--warn)}

/* funnel */
.fn-n{font-family:var(--f-data);font-size:11px;fill:var(--bronze);font-weight:600}
.fn-l{font-family:var(--f-body);font-size:14px;fill:var(--ink);font-weight:600}
.fn-d{font-family:var(--f-body);font-size:10.5px;fill:var(--muted)}
.fn-tr{fill:var(--track)}
.fn-b.s1{fill:var(--s1)}.fn-b.s2{fill:var(--s2)}.fn-b.s3{fill:var(--s3)}.fn-b.s4{fill:var(--s4)}
.fn-v{font-family:var(--f-data);font-size:19px;fill:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
.fn-v.sm2{font-size:14px}
.fn-u{font-family:var(--f-body);font-size:10.5px;fill:var(--muted);font-weight:400}
.fn-a{stroke:var(--hair);stroke-width:1}
.fn-r{font-family:var(--f-data);font-size:12.5px;fill:var(--ink-2);font-variant-numeric:tabular-nums;font-weight:600}
.fn-r.good{fill:var(--good)}
.fn-rl{font-family:var(--f-body);font-size:10.5px;fill:var(--muted)}
.ch-l{font-family:var(--f-body);font-size:12.5px;fill:var(--ink)}
.ch-n{font-family:var(--f-data);font-size:14px;fill:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}

/* guarantee */
.thr{stroke:var(--bronze);stroke-width:1.25}
.thr-l{font-family:var(--f-data);font-size:10px;fill:var(--bronze);letter-spacing:.05em}
.over-zone{fill:var(--crit);opacity:.055}
.g-n{font-family:var(--f-body);font-size:12.5px;fill:var(--ink)}
.g-wb{font-family:var(--f-data);font-size:10px;fill:var(--muted)}
.g-b{fill:var(--data)}
.g-b.over{fill:var(--crit)}
.g-v{font-family:var(--f-data);font-size:12px;fill:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
.g-v.over{fill:var(--crit)}
.g-flag{font-family:var(--f-data);font-size:10px;fill:var(--crit);letter-spacing:.06em;font-weight:600}
.g-d{font-family:var(--f-data);font-size:11px;fill:var(--ink-2);font-variant-numeric:tabular-nums}


.kv-hero>div{padding:20px 20px 18px;gap:6px}
.kv-hero dd{font-size:30px}
.kv .note .ok{color:var(--good);font-weight:600}
.kv .note .ng{color:var(--warn);font-weight:600}
.key.s1{background:var(--s1)}.key.s2{background:var(--s2)}
.key.s3{background:var(--s3)}.key.s4{background:var(--s4)}
table.mtx{font-size:12.5px}
table.mtx th,table.mtx td{padding:8px 9px;white-space:nowrap}
table.mtx td:first-child,table.mtx th:first-child{padding-left:2px;white-space:nowrap}
table.mtx .tot{border-left:1px solid var(--hair);background:var(--hair-2)}
table.mtx td.ng{color:var(--warn);font-weight:600}

/* ---------- tables ---------- */
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--hair-2);vertical-align:top}
thead th{font-family:var(--f-data);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);font-weight:500;border-bottom:1px solid var(--hair);white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
td.n,th.n{font-family:var(--f-data);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td.n b{font-weight:600}
tbody tr:hover{background:var(--hair-2)}
.ph{font-family:var(--f-data);font-size:11px;color:var(--bronze);letter-spacing:.06em}
.names{color:var(--ink-2);font-size:12.5px;line-height:1.7}
.hi{color:var(--good);font-weight:600}
caption{caption-side:top;text-align:left;font-size:12px;color:var(--muted);padding-bottom:10px}

/* ---------- risk list ---------- */
.risks{display:flex;flex-direction:column;gap:1px;background:var(--hair);border:1px solid var(--hair)}
.risk{background:var(--panel);padding:22px 24px;display:grid;grid-template-columns:112px 1fr;gap:20px}
@media(max-width:720px){.risk{grid-template-columns:1fr;gap:12px}}
.risk-t{font-family:var(--f-disp);font-size:16.5px;font-weight:600;margin:0 0 7px}
.risk p{margin:0 0 10px;color:var(--ink-2);font-size:13.5px;line-height:1.8}
.risk p:last-child{margin-bottom:0}
.risk .fig{font-family:var(--f-data);font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600}
.act{border-left:2px solid var(--bronze);padding-left:14px;margin-top:12px!important}
.act b{font-family:var(--f-data);font-size:10.5px;letter-spacing:.1em;color:var(--bronze);
  display:block;margin-bottom:3px;font-weight:600}

/* ---------- kv strip ---------- */
.kv{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hair);border:1px solid var(--hair)}
@media(max-width:860px){.kv{grid-template-columns:repeat(2,1fr)}}
.kv>div{background:var(--panel);padding:17px 18px;display:flex;flex-direction:column;gap:5px}
.kv dt{font-family:var(--f-data);font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.kv dd{margin:0;font-family:var(--f-data);font-size:22px;font-variant-numeric:tabular-nums;
  letter-spacing:-.01em;font-weight:500}
.kv dd .u{font-size:12px;color:var(--muted);margin-left:2px}
.kv .note{font-size:11.5px;color:var(--muted);font-family:var(--f-body);line-height:1.55}

/* ---------- footer ---------- */
footer{border-top:1px solid var(--hair);padding-top:26px;font-size:12.5px;color:var(--muted);
  display:flex;flex-direction:column;gap:14px;line-height:1.8}
footer a{color:var(--bronze);text-decoration:none;border-bottom:1px solid var(--bronze-soft)}
footer a:hover{border-bottom-color:var(--bronze)}
footer h3{font-family:var(--f-data);font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-2);margin:0;font-weight:500}
footer ol{margin:0;padding-left:1.4em}
:focus-visible{outline:2px solid var(--bronze);outline-offset:2px}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
</style>
"""

HTML = """<title>ピカイチ採用 コンディションボード</title>
""" + CSS + """
<div class="wrap">

<header class="mast">
  <div class="eyebrow">Terass Agent ／ 投資型採用</div>
  <h1>ピカイチ採用<br>コンディションボード</h1>
  <p class="dek">トップセールスを狙い撃つ「攻めの採用」の健康状態を、ファネル（入口〜締結）と決定実績（誰を・いくらで・いつ）の両面から一枚に集約したもの。見るべき順序は <b>入口 → 決定力 → 投資規律</b>。</p>
  <div class="mast-meta">
    <span>基準日 <b>2026年7月30日</b></span>
    <span>対象期間 <b>FY2026（1〜12月）</b></span>
    <span>ファネル <b>ピカイチ採用管理シート</b></span>
    <span>決定実績 <b>Notion 決定候補者ログ（15名）</b></span>
  </div>
</header>

<!-- ================= FIRST VIEW: HC / WB ================= -->
<section>
  <div class="s-head" style="border-top:none;padding-top:0">
    <div class="eyebrow">Monthly decisions — HC / WB</div>
    <h2>月次の決定状況</h2>
    <p class="s-note">HC＝決定人数、WB＝ウエイトバック（売上期待値の重み。ピカイチ3.0／準ピカイチ2.0／その他1.2／POP5.0）。同じ人数を採っても WB が下がれば売上インパクトは目減りする。<b>人数では超過、WBでは未達</b>が現在の状態。</p>
  </div>

  <div class="kv kv-hero">
    <div>
      <dt>累計 HC</dt>
      <dd>15<span class="u">名</span></dd>
      <div class="note"><span class="ok">目標 14名 ／ 達成率 107%</span></div>
    </div>
    <div>
      <dt>累計 WB</dt>
      <dd>37.4</dd>
      <div class="note"><span class="ng">参考ベンチ 42.0 ／ 達成率 89%</span></div>
    </div>
    <div>
      <dt>平均 WB ／ 人</dt>
      <dd>2.49</dd>
      <div class="note">ピカイチ基準3.0を下回る。WB3が9名・WB2が4名・WB1.2が2名</div>
    </div>
    <div>
      <dt>直近3か月の平均WB</dt>
      <dd>2.37</dd>
      <div class="note"><span class="ng">3〜4月の3.00から低下</span>。単価ミックスが劣化傾向</div>
    </div>
  </div>

  <div class="panel scroll">
    __HCWB__
    <div class="legend">
      <span><i class="key s4"></i>POP WB5.0（実績0名）</span>
      <span><i class="key s3"></i>ピカイチ WB3.0</span>
      <span><i class="key s2"></i>準ピカイチ WB2.0</span>
      <span><i class="key s1"></i>その他 WB1.2</span>
      <span><i class="key t"></i>参考目標 WB（HC目標×3.0）</span>
      <span>棒の高さ＝WB、下段の太字＝HC実績</span>
    </div>
  </div>

  <div class="panel tight scroll">
    <table class="mtx">
      <caption>月次内訳 ― 締結日は Salesforce の ContractConclusionDate を正とし、締結後辞退（鈴木碧さん）は除外</caption>
      <thead>
        <tr><th>指標</th><th class="n">1月</th><th class="n">2月</th><th class="n">3月</th><th class="n">4月</th><th class="n">5月</th><th class="n">6月</th><th class="n">7月</th><th class="n">8月</th><th class="n">9月</th><th class="n">10月</th><th class="n">11月</th><th class="n">12月</th><th class="n tot">累計</th></tr>
      </thead>
      <tbody>
        <tr><td>HC 目標</td><td class="n">0</td><td class="n">0</td><td class="n">2</td><td class="n">1</td><td class="n">1</td><td class="n">0</td><td class="n">3</td><td class="n">2</td><td class="n">1</td><td class="n">2</td><td class="n">1</td><td class="n">1</td><td class="n tot">14</td></tr>
        <tr><td><b>HC 実績</b></td><td class="n">0</td><td class="n">0</td><td class="n"><b>2</b></td><td class="n"><b>1</b></td><td class="n"><b>5</b></td><td class="n"><b>1</b></td><td class="n"><b>6</b></td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n tot"><b>15</b></td></tr>
        <tr><td><b>WB 実績</b></td><td class="n">0</td><td class="n">0</td><td class="n"><b>6.0</b></td><td class="n"><b>3.0</b></td><td class="n"><b>11.2</b></td><td class="n"><b>3.0</b></td><td class="n"><b>14.2</b></td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n tot"><b>37.4</b></td></tr>
        <tr><td>平均 WB</td><td class="n">—</td><td class="n">—</td><td class="n">3.00</td><td class="n">3.00</td><td class="n ng">2.24</td><td class="n">3.00</td><td class="n ng">2.37</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n tot">2.49</td></tr>
        <tr><td>参考目標 WB</td><td class="n">0</td><td class="n">0</td><td class="n">6.0</td><td class="n">3.0</td><td class="n">3.0</td><td class="n">0</td><td class="n">9.0</td><td class="n">6.0</td><td class="n">3.0</td><td class="n">6.0</td><td class="n">3.0</td><td class="n">3.0</td><td class="n tot">42.0</td></tr>
      </tbody>
    </table>
  </div>

  <div class="verdict">
    <b>読み方：</b>7月は HC6名・WB14.2 で単月最大。ただし内訳はピカイチ3名・準ピカイチ2名・その他1名で、平均WBは2.37。3〜4月はピカイチのみで平均3.00だったため、<b>件数の伸びが質の低下と同時に起きている</b>。下期の残り（8〜12月）はHC目標7名＝参考WB21.0。ここを平均WB2.4で埋めるとHCは9名必要になり、入口の情報数が下期21件目標に対し2件しかない現状とは整合しない。<b>HCを積むのかWBを積むのかを先に決める必要がある</b>。
  </div>
</section>

<!-- ================= CONDITION ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Condition</div>
    <h2>いまのコンディション</h2>
    <p class="s-note">4つの信号で全体を判定。締結（結果）は好調だが、それを生み出す入口が失速しているという非対称な状態。</p>
  </div>

  <div class="signals">
    <div class="sig is-crit">
      <div class="sig-h">入口 ／ 情報数</div>
      <div class="sig-n">9.5<span class="u">%</span></div>
      <span class="pill is-crit">警戒</span>
      <div class="sig-sub">下期 <span class="fig">2</span>／<span class="fig">21</span>件。時間進捗 <span class="fig">16.7%</span>（1/6か月）を大きく下回る</div>
    </div>
    <div class="sig is-good">
      <div class="sig-h">決定力 ／ 決定者出現率</div>
      <div class="sig-n">57.7<span class="u">%</span></div>
      <span class="pill is-good">良好</span>
      <div class="sig-sub">累計 <span class="fig">15</span>／<span class="fig">26</span>件。ベンチマーク <span class="fig">50%</span> を維持</div>
    </div>
    <div class="sig is-good">
      <div class="sig-h">決定量 ／ 締結数</div>
      <div class="sig-n">15<span class="u">名</span></div>
      <span class="pill is-good">良好</span>
      <div class="sig-sub">年目標 <span class="fig">14</span>名を7月時点で超過（<span class="fig">107%</span>）。下期は <span class="fig">6</span>／<span class="fig">10</span>名</div>
    </div>
    <div class="sig is-warn">
      <div class="sig-h">投資規律 ／ 保証率</div>
      <div class="sig-n">46.9<span class="u">%</span></div>
      <span class="pill is-warn">注意</span>
      <div class="sig-sub">上限 <span class="fig">66%</span> に対し全体は健全。ただし個別 <span class="fig">4</span>名が超過</div>
    </div>
  </div>

  <div class="verdict">
    <b>総括：結果は出ているが、燃料が切れかけている。</b>年間の締結15名は年目標14名を7月時点で超過し、決定者出現率57.7%もベンチマーク50%を上回る。一方で下期の情報数は21件目標に対し7月末で2件（9.5%）、面接1件（7.7%）と、いずれも時間進捗16.7%を下回った。7月の締結6名は上期に積んだパイプラインの消化であり、<b>入口を8月中に立て直さないと10〜12月の締結が空く</b>構造。加えて決定者15名中13名（86.7%）が住友系という一社集中と、66%ルールを超えた保証が4名出ている点が、質・規律の面での注意信号。
  </div>
</section>

<!-- ================= FUNNEL ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Funnel — 年間累計</div>
    <h2>ファネル形状と歩留まり</h2>
    <p class="s-note">ハイクラス×リファラル中心のため中間歩留まりは極めて高い。ボトルネックは唯一「情報数の確保」に集約されている。</p>
  </div>
  <div class="panel scroll">__FUNNEL__</div>
  <div class="kv">
    <div><dt>情報 → 面接</dt><dd>73.1<span class="u">%</span></dd><div class="note">未面接は主にビズリーチ経由</div></div>
    <div><dt>面接 → 内定</dt><dd>100<span class="u">%</span></dd><div class="note">段階設計により選考落ちゼロ。指標としては機能していない</div></div>
    <div><dt>内定 → 締結</dt><dd>78.9<span class="u">%</span></dd><div class="note">内定後辞退3名（北村・川本・鈴木碧の各氏）</div></div>
    <div><dt>締結 → 参画 リードタイム</dt><dd>71<span class="u">日</span></dd><div class="note">3月締結89日 → 7月締結38日に短縮</div></div>
  </div>
</section>

<!-- ================= MONTHLY ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Monthly — 目標 vs 実績</div>
    <h2>入口（情報数）の月次推移</h2>
    <p class="s-note">上期は目標13件に対し24件（185%）と大幅超過。下期に入った7月は目標4件に対し2件で、初めて未達に転じた。網掛けは当月。</p>
  </div>
  <div class="panel scroll">
    __M_INFO__
    <div class="legend">
      <span><i class="key t"></i>目標</span>
      <span><i class="key a"></i>実績</span>
      <span>数値は下段に 目標／実績 を併記</span>
    </div>
  </div>

  <div class="s-head" style="border-top:none;padding-top:4px">
    <h2>結果（締結数）の月次推移</h2>
    <p class="s-note">7月は目標3名に対し6名。5月・7月の山は、2〜3か月前に積んだ情報のコホートが結実したもの。</p>
  </div>
  <div class="panel scroll">
    __M_SIGN__
    <div class="legend">
      <span><i class="key t"></i>目標</span>
      <span><i class="key a"></i>実績</span>
    </div>
  </div>
</section>

<!-- ================= CHANNEL ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Source concentration</div>
    <h2>チャネル構成 ― どこから来ているか</h2>
    <p class="s-note">「オーガニックピカイチ」＝在籍TA経由の声掛け・会食フック。情報の73.1%、締結の81.3%を単一チャネルが担っている。</p>
  </div>
  <div class="panel scroll">__CHANNEL__</div>
  <div class="kv">
    <div><dt>オーガニック依存度（情報）</dt><dd>73.1<span class="u">%</span></dd><div class="note">19／26件</div></div>
    <div><dt>オーガニック依存度（締結）</dt><dd>81.3<span class="u">%</span></dd><div class="note">13／16件（台帳ベース）</div></div>
    <div><dt>住友系の決定者</dt><dd>13<span class="u">／15名</span></dd><div class="note">86.7%。他は REDS・東宝ハウス各1名</div></div>
    <div><dt>ダイレクトスカウト経由の締結</dt><dd>0<span class="u">名</span></dd><div class="note">情報3件・面接1件で全滅。投資対効果を再判断すべき</div></div>
  </div>
</section>

<!-- ================= DECIDED PROFILE ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Decided cohort — Notion 決定候補者ログ</div>
    <h2>決定者15名のプロフィール</h2>
    <p class="s-note">WBは売上期待値に応じた重み。WB3＝ピカイチ（年間3,000万円以上）、WB2＝準ピカイチ（2,300万円以上）、WB1.2＝その他。</p>
  </div>
  <div class="two">
    <div class="panel tight scroll">
      <table>
        <caption>WB構成 ― 質のミックス</caption>
        <thead><tr><th>区分</th><th>WB</th><th class="n">人数</th><th class="n">構成比</th></tr></thead>
        <tbody>
          <tr><td>ピカイチ</td><td class="ph">3.0</td><td class="n"><b>9</b></td><td class="n">60.0%</td></tr>
          <tr><td>準ピカイチ</td><td class="ph">2.0</td><td class="n"><b>4</b></td><td class="n">26.7%</td></tr>
          <tr><td>その他</td><td class="ph">1.2</td><td class="n"><b>2</b></td><td class="n">13.3%</td></tr>
          <tr><td>POP</td><td class="ph">5.0</td><td class="n">0</td><td class="n">0.0%</td></tr>
        </tbody>
      </table>
    </div>
    <div class="panel tight scroll">
      <table>
        <caption>応募チャネル ― 決定に至った経路</caption>
        <thead><tr><th>チャネル</th><th class="n">人数</th><th class="n">構成比</th></tr></thead>
        <tbody>
          <tr><td>リストマッチ</td><td class="n"><b>13</b></td><td class="n">86.7%</td></tr>
          <tr><td>リファラル</td><td class="n"><b>1</b></td><td class="n">6.7%</td></tr>
          <tr><td>直接応募</td><td class="n"><b>1</b></td><td class="n">6.7%</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="s-head" style="border-top:none;padding-top:4px">
    <h2>参画月の分布 ― オンボーディング負荷</h2>
    <p class="s-note">決定者15名のうち8名が9月1日参画に集中。集客戦略MTGと立ち上げ支援が同月に束ねられる。</p>
  </div>
  <div class="panel scroll">
    __JOINCURVE__
    <div class="legend"><span><i class="key a"></i>参画者数</span><span><i class="key p"></i>要注意（体制上のピーク）</span></div>
  </div>
</section>

<!-- ================= INVESTMENT ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Investment discipline</div>
    <h2>投資規律 ― 66%ルールの遵守状況</h2>
    <p class="s-note">保証額の上限は「集客戦略MTGで算出した売上期待値 × 66%」。ここでは年収保証・固定給保証・サインアップボーナスを合算した年換算コミットで保証率を算定した。安彦詠太さんは売上期待値が未登録のため算定対象外。</p>
  </div>
  <div class="panel scroll">__GUARANTEE__</div>
  <div class="kv">
    <div><dt>コミット総額（年換算）</dt><dd>1.92<span class="u">億円</span></dd><div class="note">年収保証1億8,600万＋固定給390万＋SUB200万</div></div>
    <div><dt>ポートフォリオ保証率</dt><dd>46.9<span class="u">%</span></dd><div class="note">上限66%までの余枠 約7,060万円</div></div>
    <div><dt>66%超過</dt><dd>4<span class="u">名</span></dd><div class="note">田邊・小畑・中川・藤崎の各氏</div></div>
    <div><dt>下期売上期待値</dt><dd>1.54<span class="u">億円</span></dd><div class="note">2026年参画14名で1.12億円＋既存2名2,100万×2</div></div>
  </div>
</section>

<!-- ================= PIPELINE ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Pipeline</div>
    <h2>残パイプライン ― 下期残り4名を埋められるか</h2>
    <p class="s-note">下期締結目標10名に対し6名が確定済。残り4名に対して選考中は11名だが、確度「1.高」はオファー面談以降8名のうち1名のみ。</p>
  </div>
  <div class="panel tight scroll">
    <table>
      <thead><tr><th>採用フェーズ</th><th class="n">人数</th><th>候補者</th><th>読み</th></tr></thead>
      <tbody>
        <tr><td class="ph">05 内定承諾見込み</td><td class="n"><b>1</b></td><td class="names">徳久 雄一郎</td><td class="names">10/1参画・保証2,300万円想定。<span class="hi">最有力</span></td></tr>
        <tr><td class="ph">04 オファー面談</td><td class="n"><b>7</b></td><td class="names">小原澤 健太〈確度 高〉／山本 貴之／関／木崎 在／髙橋 寛臣／飯塚 将平／山村 政裕</td><td class="names">リバブル系の連鎖リファラル（大山→小原澤→山本）が第2の柱の候補</td></tr>
        <tr><td class="ph">03 最終面接</td><td class="n"><b>1</b></td><td class="names">加藤 雄也</td><td class="names">通常採用からの送客。年収保証面接を実施予定</td></tr>
        <tr><td class="ph">02 一次面接</td><td class="n"><b>2</b></td><td class="names">小林 孝明／野上 裕行</td><td class="names">いずれも確度「3.低」</td></tr>
        <tr><td class="ph">09 ペンディング</td><td class="n"><b>4</b></td><td class="names">永野 正太郎／渡邊／守屋 裕章／久保 恵亮</td><td class="names">長期フォロー枠。鳥越さんは1年フォローで承諾した前例あり</td></tr>
      </tbody>
    </table>
  </div>
  <div class="panel tight scroll">
    <table>
      <caption>内定後辞退者 ― 再アプローチ管理（次回接点 2026年10月14日）</caption>
      <thead><tr><th>氏名</th><th>オファー時期</th><th>転職先</th><th>辞退理由</th></tr></thead>
      <tbody>
        <tr><td>北村 勇気</td><td class="n">2026/04/01</td><td>残留</td><td class="names">現職からのカウンターオファーで転職の意味がなくなった</td></tr>
        <tr><td>川本 賢将</td><td class="n">2026/04/08</td><td>みずほ不動産販売</td><td class="names">もう少し実力をつけてから。収益事業系を強化したい</td></tr>
        <tr><td>鈴木 碧</td><td class="n">2026/06/08</td><td>残留</td><td class="names">配偶者の反対。安定した現職で働き続けてほしい</td></tr>
      </tbody>
    </table>
  </div>
</section>

<!-- ================= RISKS ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Watchlist</div>
    <h2>注視すべき4点と打ち手</h2>
  </div>
  <div class="risks">

    <div class="risk">
      <div><span class="pill is-crit">警戒</span></div>
      <div>
        <h3 class="risk-t">入口の失速 ― 下期情報数が時間進捗の6割水準</h3>
        <p>7月の情報数は<span class="fig">2件</span>（目標4件）。下期21件に対する進捗は<span class="fig">9.5%</span>で、時間進捗<span class="fig">16.7%</span>を下回った。締結→参画リードタイムが約<span class="fig">71日</span>あるため、8月の情報が薄いと10〜12月の締結目標<span class="fig">4名</span>がそのまま空く。7月の締結6名は上期パイプラインの消化であり、この好調は先行指標ではない。</p>
        <p class="act"><b>Action</b>ターゲットリスト36名は大半が「03 低」で滞留している。東宝ハウス系（吉田・関谷・久保・小林の各氏）と住友ステップ系（谷津さん）に分けて確度を再棚卸しし、8月中に「01 高」を5名つくる。会食フックは情報→面接73.1%を支えている実績があるため、8月の会食枠を先に押さえてから声掛けを走らせる。</p>
      </div>
    </div>

    <div class="risk">
      <div><span class="pill is-warn">注意</span></div>
      <div>
        <h3 class="risk-t">住友一社集中 ― 決定者の86.7%が単一出身企業</h3>
        <p>決定者15名のうち<span class="fig">13名</span>が住友不動産販売（STEP含む）出身。体制変更のタイミングを活かした住友出身TAへの協力依頼が効いた結果だが、KPI管理でも「住友バブルがサチった時に備える」ことが課題として挙がっている。谷津さん経由だけで決定者<span class="fig">6名</span>を生んでおり、単一リファラル元への依存も同時に進行している。</p>
        <p class="act"><b>Action</b>すでに芽のある2系統を第2の柱に育てる。東宝ハウス経路（常光さん→飯塚さん）とリバブル経路（大山さん→小原澤さん→山本さん）は、いずれも決定者が次の候補者を連れてくる連鎖が発生している。この2系統に四半期の情報数目標を個別に割り当て、全体目標の内訳として管理する。</p>
      </div>
    </div>

    <div class="risk">
      <div><span class="pill is-warn">注意</span></div>
      <div>
        <h3 class="risk-t">保証率の規律 ― 66%ルール超過が4名</h3>
        <p>田邊柚樹さん<span class="fig">83.3%</span>、小畑慧伍さん<span class="fig">75.0%</span>、中川雅史さん<span class="fig">73.3%</span>（サインアップ200万円込み）、藤崎常博さん<span class="fig">70.8%</span>。ポートフォリオ全体では<span class="fig">46.9%</span>と健全なため、個別の逸脱が総額では見えない。年収保証額まではテイクレート100%のため、超過分はそのまま本部利益を削る。安彦詠太さんは売上期待値が未登録で、そもそも保証率が算定できない状態。</p>
        <p class="act"><b>Action</b>オファー決裁のフォーマットに「保証率（＝コミット総額÷売上期待値）」を必須項目として組み込み、66%超は決裁権者を1段上げる。集客戦略シートへの売上期待値の登録を、締結処理の前提条件にする。</p>
      </div>
    </div>

    <div class="risk">
      <div><span class="pill is-warn">注意</span></div>
      <div>
        <h3 class="risk-t">9月参画8名の同時立ち上げ</h3>
        <p>決定者15名のうち<span class="fig">8名</span>が9月1日参画（8月4名、10月1名）。締結→参画リードタイムは3月締結の<span class="fig">89日</span>から7月締結の<span class="fig">38日</span>へ短縮しており、前倒し圧力がこの集中をさらに強めている。集客戦略MTGは売上期待値の算定＝保証額の根拠であり、ここが詰まると保証だけ先に決まって期待値が後追いになる（すでに安彦さんで発生）。</p>
        <p class="act"><b>Action</b>9月コホート8名の集客戦略MTGを8月中に完了させ、参画月の立ち上げ支援と分離する。年収保証の条件①「最低契約件数」の設定も同じMTGで確定させ、9月以降は進捗モニタリングに徹する。</p>
      </div>
    </div>

  </div>
</section>

<!-- ================= DATA OPS ================= -->
<section>
  <div class="s-head">
    <div class="eyebrow">Data operations</div>
    <h2>データ整備の申し送り</h2>
    <p class="s-note">このダッシュボードを毎月回すうえで、いま数字がブレる4か所。ここを直せば集計は自動化できる。</p>
  </div>
  <div class="panel tight scroll">
    <table>
      <thead><tr><th>論点</th><th>現状</th><th>影響</th><th>対応</th></tr></thead>
      <tbody>
        <tr>
          <td><b>締結数の二重定義</b></td>
          <td class="names">シートの締結16名には、6/23締結後に辞退した鈴木碧さんが「06 CS締結」のまま含まれる。SF側は Status＝辞退・has_contracted＝0、Notionには行なし</td>
          <td class="names">年間締結が16名／15名で不一致。決定者出現率が61.5%／57.7%、内定→締結が84.2%／78.9%と二重になる</td>
          <td class="names">「締結（グロス）」と「締結（実効＝辞退控除後）」を別カラムで持つ。本ボードは実効15名を採用</td>
        </tr>
        <tr>
          <td><b>締結月の月末ズレ</b></td>
          <td class="names">Notion「契約締結月」と SF「ContractConclusionDate」が最大1日ずれ、月替わりを跨ぐ（吉川さん 3/31 vs 4/01、中川さん 6/30 vs 7/01、小畑さん 6/29 vs 6/30）</td>
          <td class="names">月次締結数が±1名ずれ、月次達成率の解釈が変わる</td>
          <td class="names">SFの ContractConclusionDate を唯一の正とし、Notionは参照に切り替える</td>
        </tr>
        <tr>
          <td><b>決定者出現率の計算式</b></td>
          <td class="names">同月の「締結÷情報」で算出。リードタイム約71日を無視しているため、7月は300%、4月は20%など月次値が意味を失っている</td>
          <td class="names">Critical指標としてのモニタリングが成立しない</td>
          <td class="names">情報獲得月でコホート化し「N月に獲得した情報のうち何名が締結したか」を追跡。当面は累計値のみを見る</td>
        </tr>
        <tr>
          <td><b>選考フェーズの二重管理</b></td>
          <td class="names">「選考フェース」と「採用フェーズ」の2列に分散し、行ごとに入力列が異なる（列ズレ）。同一候補者の重複行もある（岡田さん・加藤さん）</td>
          <td class="names">フェーズ別の人数がクエリで正しく取れず、手作業での読み替えが必要</td>
          <td class="names">フェーズを単一カラムに正規化し、候補者IDでNotion／SFと突合。1次・2次のSF管理は改修課題として既に認識済</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<footer>
  <h3>データ系統</h3>
  <div>
    <b>ファネル・パイプライン・集客戦略</b>： ピカイチ採用管理シート（Google スプレッドシート）／ C4・オーガニックピカイチ・通常リファラル・自社サイト・その他 の各ブロック、選考中一覧、ターゲットリスト、SFエクスポート<br>
    <b>決定実績</b>： Notion「決定候補者ログ」データベース（15行、テンプレート行を除く）<br>
    <b>定義・ルール</b>： Notion「ピカイチ採用とは?」（WB定義、66%ルール、オファー4パターン、リファラルインセンティブ）／「KPI管理」（上期実績と振り返り、決定者出現率のベンチマーク50%）
  </div>
  <h3>毎月の運用</h3>
  <div>
    同じ内容を Apps Script 版（<b>dashboards/gas/</b>）としてスプレッドシートに載せてある。
    決定者マスタに1行足すだけで HC・WB・保証率・アラートが自動で再計算されるので、
    月次の運用はそちらを使う。本ページは基準日時点のスナップショットとして残す。
  </div>
  <h3>更新手順（本ページを作り直す場合）</h3>
  <ol>
    <li>シートの月次「実績」行と、Notion決定候補者ログの新規行を確定させる（締結は辞退控除後の実効値で数える）</li>
    <li>コンディション4信号を再判定する。入口は「下期進捗率 vs 時間進捗率」、投資規律は「保証率が66%を超えた人数」で見る</li>
    <li>新規決定者は集客戦略シートに売上期待値を登録してから保証率を算定する</li>
  </ol>
  <div>※ 本ボードは 2026年7月30日時点のスナップショット。金額はすべて年換算・税込前提の管理値。</div>
</footer>

</div>
"""

HTML = (HTML.replace('__HCWB__', C['hcwb'])
            .replace('__FUNNEL__', C['funnel'])
            .replace('__M_INFO__', C['m_info'])
            .replace('__M_SIGN__', C['m_sign'])
            .replace('__CHANNEL__', C['channel'])
            .replace('__GUARANTEE__', C['guarantee'])
            .replace('__JOINCURVE__', C['joincurve']))

with io.open(os.path.join(HERE,'pikaichi-condition-board.html'),'w',encoding='utf-8') as f:
    f.write(HTML)
print('written', len(HTML), 'chars')
assert '__' not in HTML.replace('__','') or True
for tok in ['__HCWB__','__FUNNEL__','__M_INFO__','__M_SIGN__','__CHANNEL__','__GUARANTEE__','__JOINCURVE__']:
    assert tok not in HTML, tok
print('placeholders ok')
