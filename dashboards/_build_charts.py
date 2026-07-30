# -*- coding: utf-8 -*-
import os
HERE=os.path.dirname(os.path.abspath(__file__))
M = ['1','2','3','4','5','6','7','8','9','10','11','12']
info=[(1,1),(2,5),(3,6),(2,5),(2,4),(3,3),(4,2),(2,0),(2,0),(4,0),(4,0),(5,0)]
sign=[(0,0),(0,0),(2,2),(1,1),(1,5),(0,2),(3,6),(2,0),(1,0),(2,0),(1,0),(1,0)]

def rtop(x,y,w,h,r=4):
    """rect with rounded top corners, anchored to baseline"""
    if h<=0: return ''
    r=min(r,h,w/2)
    return (f'M{x:.1f},{y+h:.1f} L{x:.1f},{y+r:.1f} Q{x:.1f},{y:.1f} {x+r:.1f},{y:.1f} '
            f'L{x+w-r:.1f},{y:.1f} Q{x+w:.1f},{y:.1f} {x+w:.1f},{y+r:.1f} L{x+w:.1f},{y+h:.1f} Z')

def monthly(data, ymax, label, cur=6):
    L,R,T,B = 66,952,18,198
    W=R-L; slot=W/12; bw=22; gap=2; off=(slot-(bw*2+gap))/2
    unit=(B-T)/ymax
    s=[f'<svg viewBox="0 0 980 244" role="img" aria-label="{label} 月次 目標と実績" class="chart">']
    # grid
    for v in range(0,ymax+1,2):
        y=B-v*unit
        s.append(f'<line x1="{L}" y1="{y:.1f}" x2="{R}" y2="{y:.1f}" class="grid"/>')
        s.append(f'<text x="{L-10}" y="{y+4:.1f}" class="ax ax-r">{v}</text>')
    s.append(f'<line x1="{L}" y1="{B}" x2="{R}" y2="{B}" class="base"/>')
    # H1/H2 divider
    xd=L+slot*6
    s.append(f'<line x1="{xd:.1f}" y1="{T-8}" x2="{xd:.1f}" y2="{B+8}" class="div"/>')
    s.append(f'<text x="{xd-8:.1f}" y="{T-12}" class="ax ax-r sm">上期</text>')
    s.append(f'<text x="{xd+8:.1f}" y="{T-12}" class="ax sm">下期</text>')
    for i,(t,a) in enumerate(data):
        x=L+slot*i+off
        # current month band
        if i==cur:
            s.append(f'<rect x="{L+slot*i:.1f}" y="{T-6}" width="{slot:.1f}" height="{B-T+6}" class="now"/>')
        ht=t*unit; ha=a*unit
        if t>0:
            s.append(f'<path d="{rtop(x,B-ht,bw,ht)}" class="bar-t"><title>{M[i]}月 目標 {t}</title></path>')
        s.append(f'<text x="{x+bw/2:.1f}" y="{B+15}" class="ax mid">{t}</text>')
        xa=x+bw+gap
        if a>0:
            s.append(f'<path d="{rtop(xa,B-ha,bw,ha)}" class="bar-a"><title>{M[i]}月 実績 {a}</title></path>')
            s.append(f'<text x="{xa+bw/2:.1f}" y="{B-ha-7:.1f}" class="val">{a}</text>')
        else:
            s.append(f'<circle cx="{xa+bw/2:.1f}" cy="{B-2}" r="1.6" class="zero"/>')
        s.append(f'<text x="{xa+bw/2:.1f}" y="{B+15}" class="ax mid em">{a}</text>')
        s.append(f'<text x="{L+slot*i+slot/2:.1f}" y="{B+34}" class="ax mid">{M[i]}月</text>')
    s.append(f'<text x="{L-12}" y="{B+15}" class="ax ax-r sm">目標／実績</text>')
    s.append('</svg>')
    return '\n'.join(s)

FUN=[('1','情報数',26,'ターゲット情報の獲得'),('2','面接数',19,'面接まで到達'),('3','内定数',19,'内定提示・承諾'),('4','締結数',15,'業務委託契約の締結')]
def funnel():
    X0,W=196,712; H=38; G=26; T=14
    s=['<svg viewBox="0 0 980 258" role="img" aria-label="年間累計ファネル" class="chart">']
    for i,(n,name,v,desc) in enumerate(FUN):
        y=T+i*(H+G); w=W*v/26
        s.append(f'<text x="0" y="{y+16:.1f}" class="fn-n">{n}</text>')
        s.append(f'<text x="26" y="{y+16:.1f}" class="fn-l">{name}</text>')
        s.append(f'<text x="26" y="{y+32:.1f}" class="fn-d">{desc}</text>')
        s.append(f'<rect x="{X0}" y="{y}" width="{W}" height="{H}" class="fn-tr"/>')
        s.append(f'<rect x="{X0}" y="{y}" width="{w:.1f}" height="{H}" rx="4" class="fn-b s{i+1}"><title>{name} {v}件</title></rect>')
        s.append(f'<text x="{X0+w+12:.1f}" y="{y+H/2+6:.1f}" class="fn-v">{v}</text>')
        s.append(f'<text x="{X0+w+12+(30 if v>9 else 18):.1f}" y="{y+H/2+6:.1f}" class="fn-u">件</text>')
        if i<3:
            nv=FUN[i+1][2]; r=nv/v*100
            ym=y+H+G/2
            s.append(f'<line x1="{X0+16}" y1="{y+H+5}" x2="{X0+16}" y2="{y+H+G-5}" class="fn-a"/>')
            cls='fn-r' + (' good' if r>=80 else '')
            s.append(f'<text x="{X0+26}" y="{ym+4:.1f}" class="{cls}">{r:.1f}%</text>')
            s.append(f'<text x="{X0+26+52}" y="{ym+4:.1f}" class="fn-rl">{name}→{FUN[i+1][1]}</text>')
    s.append('</svg>')
    return '\n'.join(s)

CH=[('オーガニックピカイチ',19,13,68.4),('その他（スカウト等）',3,0,0.0),('通常リファラル',2,2,100.0),('自社サイト',2,1,50.0)]
def channel():
    X0,W=182,520; H=30; G=16
    order={'オーガニックピカイチ':1,'通常リファラル':2,'自社サイト':3,'その他（スカウト等）':4}
    rows=sorted(CH,key=lambda r:-r[1])
    s=['<svg viewBox="0 0 980 208" role="img" aria-label="チャネル別 情報数と締結数" class="chart">']
    s.append(f'<text x="{X0}" y="10" class="ax sm">情報数</text>')
    s.append(f'<text x="{X0+W+96}" y="10" class="ax mid sm">締結</text>')
    s.append(f'<text x="{X0+W+186}" y="10" class="ax mid sm">決定者出現率</text>')
    for i,(name,inf,sg,rate) in enumerate(rows):
        y=22+i*(H+G); w=W*inf/19
        s.append(f'<text x="0" y="{y+20:.1f}" class="ch-l">{name}</text>')
        s.append(f'<rect x="{X0}" y="{y}" width="{W}" height="{H}" class="fn-tr"/>')
        s.append(f'<rect x="{X0}" y="{y}" width="{max(w,2):.1f}" height="{H}" rx="4" class="fn-b s{order[name]}"><title>{name} 情報{inf}件</title></rect>')
        s.append(f'<text x="{X0+max(w,2)+10:.1f}" y="{y+20:.1f}" class="fn-v sm2">{inf}</text>')
        s.append(f'<text x="{X0+W+96}" y="{y+20:.1f}" class="ch-n mid">{sg}</text>')
        s.append(f'<text x="{X0+W+186}" y="{y+20:.1f}" class="ch-n mid">{rate:.1f}<tspan class="fn-u">%</tspan></text>')
    s.append('</svg>')
    return '\n'.join(s)

GAR=[('田邊 柚樹','3',2400,2000,83.3),('小畑 慧伍','3',2400,1800,75.0),('中川 雅史','3',3000,2200,73.3),('藤崎 常博','2',2400,1700,70.8),
('藤岡 将也','3',2400,1520,63.3),('塚越 翔太','3',2400,1500,62.5),('吉川 航二','3',3000,1500,50.0),('常光 孝博','2',2400,1200,50.0),
('吉村 剣郎','1.2',2100,1000,47.6),('西野 大智','2',2400,1100,45.8),('小田 俊介','3',3300,1500,45.5),('鳥越 篤','1.2',2100,150,7.1),
('池田 悠真','2',2400,120,5.0),('岡田 雅美','3',4200,0,0.0)]
def guarantee():
    X0,W=150,560; H=20; G=10; MX=90
    s=['<svg viewBox="0 0 980 452" role="img" aria-label="保証率 66%上限に対する個別水準" class="chart">']
    x66=X0+W*66/MX
    s.append(f'<rect x="{x66:.1f}" y="16" width="{X0+W-x66:.1f}" height="{len(GAR)*(H+G)-G+8:.1f}" class="over-zone"/>')
    s.append(f'<line x1="{x66:.1f}" y1="8" x2="{x66:.1f}" y2="{16+len(GAR)*(H+G)-G+8:.1f}" class="thr"/>')
    s.append(f'<text x="{x66+6:.1f}" y="8" class="thr-l">66% 上限（売上期待値×66%ルール）</text>')
    for i,(name,wb,exp,com,r) in enumerate(GAR):
        y=20+i*(H+G); w=W*r/MX
        over = r>66
        s.append(f'<text x="0" y="{y+15:.1f}" class="g-n">{name}</text>')
        s.append(f'<text x="104" y="{y+15:.1f}" class="g-wb">WB {wb}</text>')
        s.append(f'<rect x="{X0}" y="{y}" width="{W}" height="{H}" class="fn-tr"/>')
        cls='g-b over' if over else 'g-b'
        s.append(f'<rect x="{X0}" y="{y}" width="{max(w,2):.1f}" height="{H}" rx="4" class="{cls}"><title>{name} コミット{com}万円 / 売上見込{exp}万円 = {r:.1f}%</title></rect>')
        lx=X0+max(w,2)+10
        s.append(f'<text x="{lx:.1f}" y="{y+15:.1f}" class="g-v{" over" if over else ""}">{r:.1f}<tspan class="fn-u">%</tspan></text>')
        if over:
            s.append(f'<text x="{lx+58:.1f}" y="{y+15:.1f}" class="g-flag">▲ 超過</text>')
        s.append(f'<text x="{X0+W+150}" y="{y+15:.1f}" class="g-d ax-r2">{com:,}</text>')
        s.append(f'<text x="{X0+W+222}" y="{y+15:.1f}" class="g-d ax-r2">{exp:,}</text>')
    s.append(f'<text x="{X0+W+150}" y="8" class="ax sm ax-r2">コミット(万)</text>')
    s.append(f'<text x="{X0+W+222}" y="8" class="ax sm ax-r2">見込(万)</text>')
    s.append('</svg>')
    return '\n'.join(s)

JOIN=[('5月',2,'参画済み'),('8月',4,''),('9月',8,'8名が同時参画'),('10月',1,'')]
def joincurve():
    L,B,T=52,158,34; slot=196; bw=64
    unit=(B-T)/8
    s=['<svg viewBox="0 0 860 212" role="img" aria-label="決定者の参画月分布" class="chart">']
    for v in (0,4,8):
        y=B-v*unit
        s.append(f'<line x1="{L}" y1="{y:.1f}" x2="{L+slot*4-40}" y2="{y:.1f}" class="grid"/>')
        s.append(f'<text x="{L-10}" y="{y+4:.1f}" class="ax ax-r">{v}</text>')
    s.append(f'<line x1="{L}" y1="{B}" x2="{L+slot*4-40}" y2="{B}" class="base"/>')
    for i,(m,v,tag) in enumerate(JOIN):
        x=L+slot*i+30; h=v*unit
        cls='bar-a peak' if v>=8 else 'bar-a'
        s.append(f'<path d="{rtop(x,B-h,bw,h,5)}" class="{cls}"><title>{m}参画 {v}名</title></path>')
        s.append(f'<text x="{x+bw/2:.1f}" y="{B-h-8:.1f}" class="val lg">{v}</text>')
        s.append(f'<text x="{x+bw/2:.1f}" y="{B+18}" class="ax mid">2026年{m}</text>')
        if tag: s.append(f'<text x="{x+bw/2:.1f}" y="{B+34}" class="ax mid {"tag" if v>=8 else "tag-q"}">{tag}</text>')
    s.append('</svg>')
    return '\n'.join(s)

import json
parts={'m_info':monthly(info,6,'情報数'),'m_sign':monthly(sign,6,'締結数'),'funnel':funnel(),
       'channel':channel(),'guarantee':guarantee(),'joincurve':joincurve()}
json.dump(parts,open(os.path.join(HERE,'charts.json'),'w'),ensure_ascii=False)
print('generated', {k:len(v) for k,v in parts.items()})
