"""Dashboard (plan I): embedded single-page UI + JSON API on aiohttp.

GET  /            -> control panel (auto-refresh)
GET  /api/state   -> balances, positions, candidates, status, limits
POST /api/halt    -> emergency stop (blocks new orders)
POST /api/resume  -> clear halt
POST /api/risk    -> adjust risk limits (hard caps can only tighten)
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time

from aiohttp import web

from .signals import signal_path

log = logging.getLogger("dashboard")


@web.middleware
async def basic_auth(req, handler):
    """Optional login: set DASHBOARD_USER + DASHBOARD_PASSWORD env vars.
    Off by default (localhost use); required when exposing remotely."""
    user, pw = os.environ.get("DASHBOARD_USER", ""), \
        os.environ.get("DASHBOARD_PASSWORD", "")
    if not user or not pw:
        return await handler(req)
    auth = req.headers.get("Authorization", "")
    ok = False
    if auth.startswith("Basic "):
        try:
            dec = base64.b64decode(auth[6:]).decode()
            ok = dec == f"{user}:{pw}"
        except Exception:
            ok = False
    if not ok:
        return web.Response(
            status=401, text="auth required",
            headers={"WWW-Authenticate": 'Basic realm="scalperbot"'})
    return await handler(req)

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<title>ScalperBot</title><style>
body{font-family:Consolas,monospace;background:#0d1117;color:#c9d1d9;margin:0;padding:16px}
h2{color:#58a6ff;margin-bottom:4px}h3{color:#8b949e;margin:18px 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px}
.card b{color:#8b949e;font-size:11px;text-transform:uppercase;display:block}
.card span{font-size:20px}.pos{color:#3fb950}.neg{color:#f85149}
table{border-collapse:collapse;width:100%;margin-top:6px;font-size:13px}
td,th{border:1px solid #30363d;padding:4px 8px;text-align:left}th{color:#8b949e}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;
padding:6px 12px;cursor:pointer}button:hover{border-color:#58a6ff}
.halt{background:#f8514933;border-color:#f85149}
pre{background:#161b22;padding:10px;border-radius:6px;overflow:auto;font-size:12px;max-height:160px}
input{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:4px;width:80px}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;margin-left:8px}
.b1m{background:#1f6feb33;border:1px solid #1f6feb;color:#79c0ff}
.b15m{background:#d2992233;border:1px solid #d29922;color:#e3b341}
.bnew{background:#2ea08e33;border:1px solid #2ea08e;color:#69d6bb}
.bclaude{background:#a371f733;border:1px solid #a371f7;color:#d2a8ff}
.bswing{background:#f0883e33;border:1px solid #f0883e;color:#ffa657}
.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:800px){.split{grid-template-columns:1fr}}
.botbox{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
</style></head><body>
<h2>ScalperBot <span id=mode></span></h2>
<div class=grid>
<div class=card><b>Trading equity</b><span id=equity>-</span></div>
<div class=card><b>Margin equity</b><span id=margin_eq>-</span></div>
<div class=card><b>Open PnL (gross, before fees/slippage)</b><span id=upnl>-</span></div>
<div class=card><b>Realised today</b><span id=rpnl>-</span></div>
<div class=card><b>Fees paid</b><span id=fees>-</span></div>
<div class=card><b>Trades today</b><span id=trades>-</span></div>
</div>
<h3>Open positions <small id=npos></small></h3><div id=positions>-</div>
<details id=botnew open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Chatty</summary><div class=botbox id=newbot>waiting for Chatty...</div></details>
<details id=claudewrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Claude</summary>
<div class=split>
<div class=botbox><b><span class="badge bclaude">Claude 1m Scalp</span></b><div id=claude_1m>waiting for Claude 1m...</div></div>
<div class=botbox><b><span class="badge bclaude">Claude 15m Swing</span></b><div id=claude_15m>waiting for Claude 15m...</div></div>
</div></details>
<details id=swingwrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Swing Structure Trading Bot</summary>
<div class=botbox><b><span class="badge bswing">Swing Structure 1h</span></b><div id=swing_1h>waiting for Swing...</div></div>
</details>
<details id=shortwrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Long Shorts (live)</summary>
<div class=botbox><b><span class="badge bnew">Long Shorts</span></b><div id=short_1h>waiting for Long Shorts...</div></div>
</details>
<details id=rangerwrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Ranger (live)</summary>
<div class=botbox><b><span class="badge bnew">Ranger</span></b><div id=ranger_1h>waiting for Ranger...</div></div>
</details>
<details id=grokkywrap open><summary style="cursor:pointer;color:#2dd4bf;font-size:15px;font-weight:bold">Grokky (live)</summary>
<div class=botbox><b><span class="badge" style="background:#2dd4bf;color:#0b0e14">Grokky</span></b><div id=grokky_1h>waiting for Grokky...</div></div>
</details>
<details id=rhythmwrap2 open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Rhythm Scanner</summary>
<div class=split>
<div class=botbox><b><span class="badge b1m">1m Scalp</span></b><div id=rhythm_main>scanning...</div></div>
<div class=botbox><b><span class="badge b15m">15m Swing</span></b><div id=rhythm_15m>scanning...</div></div>
</div></details>
<details id=knifewrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Knife Catcher</summary>
<div class=split>
<div class=botbox><b><span class="badge b1m">1m Scalp</span></b><div id=knife_main>watching...</div></div>
<div class=botbox><b><span class="badge b15m">15m Swing</span></b><div id=knife_15m>watching...</div></div>
</div></details>
<details id=gatedwrap open><summary style="cursor:pointer;color:#8b949e;font-size:15px;font-weight:bold">Gated Bot</summary>
<div class=split>
<div class=botbox><b><span class="badge b1m">1m Scalp</span></b><span id=stats_main style="float:right;color:#8b949e;font-size:12px">-</span><div id=cands_main>-</div></div>
<div class=botbox><b><span class="badge b15m">15m Swing</span></b><span id=stats_15m style="float:right;color:#8b949e;font-size:12px">-</span><div id=cands_15m>-</div></div>
</div></details>
<details id=aiwrap>
<summary style="cursor:pointer;color:#8b949e;font-size:15px">AI analysis (advisory only)
<button style="font-size:13px" onclick="event.preventDefault();getAI()">Get Analysis</button></summary>
<div id=ai style="white-space:pre-wrap;font-size:15px;margin:6px 0">-</div>
<div style="margin:4px 0">
<input id=askq placeholder="ask the analyst anything..." style="width:70%;font-size:15px" onkeydown="if(event.key==='Enter')askAI()">
<button onclick="askAI()">Ask</button></div>
<div id=askout style="display:none;white-space:pre-wrap;font-size:15px"></div>
</details>
<details id=perfwrap ontoggle="if(this.open)loadPerf(curperf)">
<summary style="cursor:pointer;color:#8b949e;font-size:15px">Performance</summary>
<div style="margin:4px 0">
<button id=pb1 onclick="loadPerf(1)">Today</button>
<button id=pb7 onclick="loadPerf(7)">7d</button>
<button id=pb30 onclick="loadPerf(30)">30d</button>
<button id=pb0 onclick="loadPerf(0)">All time</button></div>
<div id=perf>-</div>
<div id=errlog style="font-size:11px;color:#7d8590;margin-top:4px"></div>
</details>
<details id=histwrap ontoggle="if(this.open)loadHist()">
<summary style="cursor:pointer;color:#8b949e">Trade history (click to expand)</summary>
<div id=hist>loading...</div>
</details>
<h3>Risk Limits</h3><div id=risk></div>
<h3>Controls</h3>
<button class=halt onclick="post('/api/fleet/halt',{bot:'all'})">STOP ALL</button>
<div id=pathbtns style="margin:4px 0"></div>
<button onclick="resumeAll()">Reset Blocks</button>
<script>
const LABELS={max_position_pct:'Max % in one trade',max_risk_per_trade_pct:'Max loss risked per trade %',
max_risk_pct:'Planned loss cap per trade, % of equity (not gap protection)',
max_daily_loss_pct:'Daily loss limit % (hard cap)',max_drawdown_pct:'Drawdown limit % (hard cap)',
max_consecutive_losses:'Losses in a row before cool-off',max_trades_per_day:'Max trades per day',
max_open_positions:'Max trades open at once',cooldown_min:'Cool-off minutes',allocation_pct:'Account share %'};
function cls(x){return x>=0?'pos':'neg'}
async function askAI(){const q=document.getElementById('askq').value.trim();if(!q)return;
const o=document.getElementById('askout');o.style.display='block';o.textContent='Q: '+q+'\\n\\nthinking...';
try{const d=await(await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})})).json();o.textContent='Q: '+q+'\\n\\n'+(d.text||d.error||'-')}catch(e){o.textContent='ask failed: '+e}}
async function getAI(){ai.textContent='analyzing market state...';
try{const d=await(await fetch('/api/analyze',{method:'POST'})).json();ai.textContent=d.text||'-'}catch(e){ai.textContent='analysis failed: '+e}}
let curperf=1;
async function loadPerf(d){curperf=d;
['pb1','pb7','pb30','pb0'].forEach(id=>{const el=document.getElementById(id);el.style.borderColor='#30363d';el.style.color='#c9d1d9'});
document.getElementById('pb'+d).style.borderColor='#58a6ff';
document.getElementById('pb'+d).style.color='#79c0ff';
try{
const m=await(await fetch('/api/perf?days='+d)).json();
const r=(k)=>m[k]!==undefined?m[k]:'-';
perf.innerHTML=m.trades?`<table><tr><th>Net PnL</th><th>%</th><th>Win rate</th><th>Trades</th><th>Avg W</th><th>Avg L</th><th>Fees</th></tr>
<tr><td class=${cls(m.net_pnl)}>${m.net_pnl>=0?'+':''}${m.net_pnl.toFixed(4)}</td><td class=${cls(m.net_pnl)}>${(m.net_pct||0).toFixed(2)}%</td><td>${(m.win_rate||0).toFixed(0)}%</td><td>${m.trades}</td><td>${(m.avg_win||0).toFixed(4)}</td><td>${(m.avg_loss||0).toFixed(4)}</td><td>$${(m.fees||0).toFixed(4)}</td></tr></table>
<div style="font-size:12px;color:#8b949e;margin-top:4px">avg ${(m.expectancy||0)>=0?'+':''}${(m.expectancy||0).toFixed(4)}/trade | wins recover ${((m.profit_factor||0)*100).toFixed(0)}% of losses | worst drop ${(m.max_drawdown_pct||0).toFixed(1)}%</div>`+(m.by_path?'<div style="font-size:12px;margin-top:2px">'+Object.entries(m.by_path).map(([p,v])=>`${p}: ${v.trades} trades, ${v.trades?Math.round(v.wins/v.trades*100):0}% won, ${v.net>=0?'+':''}$${v.net.toFixed(3)}`).join(' | ')+'</div>':'')+(m.regret&&m.regret.checked?`<div style="font-size:12px;color:#8b949e">early exits: ${m.regret.recovered} of ${m.regret.checked} later recovered (avg rally +${m.regret.avg_max_rally_pct}%)</div>`:''):'no trades in this window yet';
}catch(e){perf.textContent='perf error: '+e}}
const fmt=(x)=>x>=1?x.toFixed(4):x.toPrecision(4);
let _ac=null,_seenPos=null,_seenTr=null;
function _tone(f,delay,dur){try{_ac=_ac||new(window.AudioContext||window.webkitAudioContext)();const o=_ac.createOscillator(),g=_ac.createGain();o.frequency.value=f;o.connect(g);g.connect(_ac.destination);g.gain.setValueAtTime(0.15,_ac.currentTime+delay);g.gain.exponentialRampToValueAtTime(0.001,_ac.currentTime+delay+dur);o.start(_ac.currentTime+delay);o.stop(_ac.currentTime+delay+dur)}catch(e){}}
function ding(){_tone(880,0,0.15)}
function trill(up){_tone(up?660:880,0,0.12);_tone(up?990:440,0.14,0.18)}
document.addEventListener('click',()=>{try{_ac=_ac||new(window.AudioContext||window.webkitAudioContext)();_ac.resume()}catch(e){}},{once:true});
const symL=(x)=>`<a href="https://www.kucoin.com/trade/${x}" target="_blank" style="color:#e6edf3;text-decoration:none">${x}</a>`;
const pathLabel=(p)=>({rhythm:'Rhythm',knife:'Knife',gated:'Gated',new:'Chatty',claude:'Claude',swing:'Swing',short:'LongShort',long:'LongShort',longshort:'LongShort',longshort_long:'LongShorts (Long)',longshort_short:'LongShorts (Short)',ranger:'Ranger',grokky:'Grokky',grokky_long:'Grokky (Long)',grokky_short:'Grokky (Short)',manual:'Manual','adopted-orphan':'Adopted'}[p]||'Unknown');
const bcls=(b)=>b==='new'?'bnew':b==='swing'?'bswing':String(b).startsWith('claude')?'bclaude':b==='15m'?'b15m':'b1m';
const btf=(b)=>b==='new'?'new':b==='swing'?'1h':b==='short'?'LS':b==='ranger'?'rng':b==='grokky'?'':b==='longshort'?'':(b==='15m'||b==='claude15')?'15m':'1m';
const tbtn=(label,bot,path,b)=>{if(!b)return '';const off=(b.paths||{})[path]!==true,down=b.peer_offline;return `<button ${down?'disabled':''} style="border:2px solid ${off?'#f85149':'#3fb950'};color:${off?'#f85149':'#3fb950'};background:transparent" onclick="post('/api/path',{bot:'${bot}',path:'${path}',on:${off?1:0}})">${label} ${down?'OFFLINE':off?'OFF':'on'}</button>`};
function shortBox(b){if(!b)return 'Long Shorts offline';const t=(rows)=>rows&&rows.length?('<table><tr><th>Symbol</th><th>Px</th><th>Stretch%</th><th>Vol5x</th><th>Move5%</th><th>Score</th><th>Result</th></tr>'+rows.slice(0,12).map(r=>`<tr><td>${symL(r.symbol)}</td><td>${fmt(r.px)}</td><td class=${cls(r.stretch)}>${r.stretch}</td><td>${r.vr}</td><td class=${cls(r.move5)}>${r.move5}</td><td>${r.score}</td><td>${r.blocked||'<b class=pos>ENTER</b>'}</td></tr>`).join('')+'</table>'):'none';return `${b.mode.toUpperCase()} · ${b.status}${b.halted?' HALTED':''} · ${b.watched||0} watched · BTC 1h ${b.btc_1h==null?'?':b.btc_1h.toFixed(2)}% · realized ${(b.realized||0).toFixed(3)} · trades ${b.trades_today||0}<br><b>LONGS</b> (needs stretch BELOW mean, turn UP)<br>`+t(b.long_candidates)+`<br><b>SHORTS</b> (needs stretch ABOVE mean, turn DOWN)<br>`+t(b.short_candidates);}
function rangerBox(b){if(!b)return 'Ranger offline';const t=(rows)=>rows&&rows.length?('<table><tr><th>Symbol</th><th>Px</th><th>Floor</th><th>Ceil</th><th>Rng%</th><th>Touch</th><th>Result</th></tr>'+rows.slice(0,12).map(r=>`<tr><td>${symL(r.symbol)}</td><td>${fmt(r.px)}</td><td>${r.floor?fmt(r.floor):''}</td><td>${r.ceil?fmt(r.ceil):''}</td><td>${r.rng||''}</td><td>${r.touches||''}</td><td>${r.blocked||'<b class=pos>ENTER</b>'}</td></tr>`).join('')+'</table>'):'none';const pp=(b.positions||[]).map(p=>`<div>${symL(p.symbol)} @${fmt(p.entry)} px ${fmt(p.px)} <b class=${p.gain_pct>0?'pos':'neg'}>${p.gain_pct}%</b> floor ${p.floor?fmt(p.floor):''}</div>`).join('');return `${b.mode.toUpperCase()} · ${b.status} · ${b.watched||0} watched · realized ${(b.realized_pnl||0).toFixed(3)} · trades ${b.trades_today||0}`+(pp?`<br><b>OPEN</b><br>${pp}`:'')+`<br>`+t(b.candidates);}
function claudeBox(b,label){if(!b)return label+' offline';const ci=b.claude_info||{},td=ci.today||{};
const head=`${b.mode.toUpperCase()} · ${b.status}${b.halted?' <b class=neg>HALTED: '+b.halt_reason+'</b>':''} · ${ci.status||'warming'} · ${ci.watched||0} watched · ${ci.ts||'—'}<br>`+
`Market: <b class=${ci.regime_ok?'pos':'neg'}>${ci.regime_ok?'tailwind':'paused'}</b> ${ci.regime_ok?'':'('+(ci.regime||'-')+')'} · BTC ${ci.btc_label||''} ${ci.btc_chg==null?'?':(ci.btc_chg>=0?'+':'')+ci.btc_chg+'%'} · vs EMA50 ${ci.btc_vs_ema==null?'?':ci.btc_vs_ema+'%'} · breadth ${ci.breadth==null?'?':ci.breadth+'% green'}<br>`+
`Today: ${td.wins||0}W / ${td.losses||0}L · net <b class=${cls(td.net||0)}>${(td.net||0)>=0?'+':''}${(td.net||0).toFixed(4)}</b><br>Blocks: ${(ci.blocked||[]).map(([r,n])=>`${n} ${r}`).join(' · ')||'none'}`;
const rows=b.claude_candidates||[],pp=b.mode==='paper'?(b.positions||[]):[];
const ptab=pp.length?'<div style="margin-top:4px"><b class=b15m style="padding:1px 6px;border-radius:6px">PAPER positions</b></div><table><tr><th>Symbol</th><th>Entry</th><th>Last</th><th>uPnL%</th><th>Stop</th><th>Held</th><th></th></tr>'+pp.map(p=>`<tr><td>${symL(p.symbol)}</td><td>${fmt(p.entry)}</td><td>${fmt(p.last)}</td><td class=${cls(p.upnl_pct)}>${p.upnl_pct.toFixed(2)}%</td><td>${fmt(p.stop)}</td><td>${p.held_s|0}s</td><td><button style="color:#f85149;border:1px solid #f85149;background:transparent;padding:1px 7px" onclick="manualClose('${b.bot_id}','${p.symbol}')">✕</button></td></tr>`).join('')+'</table>':'';
return `<div style="font-size:12px;color:#8b949e">${head}</div>`+ptab+(rows.length?'<table><tr><th>Symbol</th><th>Price</th><th>Vol</th><th>Stop</th><th>Size</th><th>Score</th><th>Status</th></tr>'+rows.map(r=>`<tr><td>${symL(r.symbol)}</td><td>${r.price?fmt(r.price):'-'}</td><td>${r.vr==null?'-':r.vr+'x'}</td><td>${r.stop_pct==null?'-':r.stop_pct+'%'}</td><td>${r.quote==null?'-':'$'+r.quote}</td><td>${r.score?r.score.toFixed(2):'-'}</td><td>${r.blocked}</td></tr>`).join('')+'</table>':'no watch list yet')}
function swingBox(b,label){if(!b)return label+' offline';const si=b.swing_info||{},td=si.today||{},pm=si.params||{};
const head=`${b.mode.toUpperCase()} · ${b.status}${b.halted?' <b class=neg>HALTED: '+b.halt_reason+'</b>':''} · ${si.status||'warming'} · ${si.watched||0} watched · ${si.ts||'—'}<br>`+
`Market: <b class=${si.regime_ok?'pos':'neg'}>${si.regime_ok?'clear':'paused'}</b> ${si.regime_ok?'':'('+(si.regime||'-')+')'} · BTC ${si.btc_label||''} ${si.btc_chg==null?'?':(si.btc_chg>=0?'+':'')+si.btc_chg+'%'} · breadth ${si.breadth==null?'?':si.breadth+'% green'}<br>`+
`Today: ${td.wins||0}W / ${td.losses||0}L · net <b class=${cls(td.net||0)}>${(td.net||0)>=0?'+':''}${(td.net||0).toFixed(4)}</b> · entry score ≥${pm.score_min||'?'} · decline ≥${pm.min_decline||'?'}%<br>Blocks: ${(si.blocked||[]).map(([r,n])=>`${n} ${r}`).join(' · ')||'none'}`;
const rows=b.swing_candidates||[],pp=b.mode==='paper'?(b.positions||[]):[];
const ptab=pp.length?'<div style="margin-top:4px"><b class=b15m style="padding:1px 6px;border-radius:6px">PAPER positions</b></div><table><tr><th>Symbol</th><th>Entry</th><th>Last</th><th>uPnL%</th><th>Stop</th><th>High</th><th>Held</th><th></th></tr>'+pp.map(p=>`<tr><td>${symL(p.symbol)}</td><td>${fmt(p.entry)}</td><td>${fmt(p.last)}</td><td class=${cls(p.upnl_pct)}>${p.upnl_pct.toFixed(2)}%</td><td>${fmt(p.stop)}</td><td>${fmt(p.take)}</td><td>${(p.held_s/3600).toFixed(1)}h</td><td><button style="color:#f85149;border:1px solid #f85149;background:transparent;padding:1px 7px" onclick="manualClose('${b.bot_id}','${p.symbol}')">✕</button></td></tr>`).join('')+'</table>':'';
return `<div style="font-size:12px;color:#8b949e">${head}</div>`+ptab+(rows.length?'<table><tr><th>Symbol</th><th>Price</th><th>Decline</th><th>Weak</th><th>Break lvl</th><th>Score</th><th>Status</th></tr>'+rows.map(r=>`<tr><td>${symL(r.symbol)}</td><td>${r.price?fmt(r.price):'-'}</td><td>${r.decline==null?'-':r.decline+'/5'}</td><td>${r.weak==null?'-':r.weak+'/7'}</td><td>${r.level==null?'-':fmt(r.level)}</td><td>${r.score?r.score.toFixed(1):'-'}</td><td>${r.blocked}</td></tr>`).join('')+'</table>':'no watch list yet')}
const fmtQ=(x)=>x>=100?x.toLocaleString(undefined,{maximumFractionDigits:0}):x.toFixed(6);
async function loadHist(){try{
const d=await(await fetch('/api/history')).json();
const ts=d.trades||[];
const tot=ts.reduce((a,t)=>a+t.net,0);
hist.innerHTML=ts.length?(
'<table><tr><th>Bot</th><th>Symbol</th><th>Qty</th><th>Value</th><th>Entry</th><th>Exit</th><th>Net PnL</th><th>Reason</th><th>Held</th><th>Start</th><th>End</th></tr>'+
ts.map(t=>`<tr><td><span class="badge ${bcls(t.bot)}">${pathLabel(t.path)} ${btf(t.bot)}</span></td><td>${symL(t.symbol)}</td><td>${fmtQ(t.qty)}</td><td>$${(t.qty*t.exit).toFixed(2)}</td><td>${fmt(t.entry)}</td><td>${fmt(t.exit)}</td><td class=${cls(t.net)}>${t.net>=0?'+':''}${t.net.toFixed(4)}</td><td style="font-size:10px;white-space:nowrap">${t.reason}</td><td style="white-space:nowrap">${t.held_s>=120?Math.round(t.held_s/60)+'m':(t.held_s|0)+'s'}</td><td style="white-space:nowrap">${new Date(t.entry_ts*1000).toLocaleTimeString()}</td><td style="white-space:nowrap">${new Date(t.exit_ts*1000).toLocaleTimeString()}</td></tr>`).join('')+'</table>'):'no closed trades yet';
}catch(e){hist.textContent='history error: '+e}}
async function post(u,b){await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});tick()}
async function manualClose(bot,symbol){if(!confirm(`Sell ${symbol} (${bot}) at market?`))return;
try{const r=await fetch('/api/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bot,symbol})});
const d=await r.json();if(!d.ok)alert(`Not sold: ${d.error||'unknown error'}`);await tick()}catch(e){alert(`Not sold: ${e}`)}}
async function setRisk(bot,k,v){post('/api/fleet/risk',{bot:'all',key:k,val:parseFloat(v)})}
function candTable(cs){return cs.length?('<table><tr><th>Symbol</th><th>Score</th><th>RelVol</th><th>Mom%</th></tr>'+
cs.slice(0,5).map(c=>`<tr><td>${symL(c.symbol)}</td><td>${c.score.toFixed(1)}</td><td>${c.rel_vol.toFixed(2)}x</td><td class=${cls(c.mom)}>${c.mom.toFixed(2)}</td></tr>`).join('')+'</table>'):'scanning...'}
function botStatus(b){return `<span class="badge ${b.bot_id==='15m'?'b15m':'b1m'}">${b.bot_id}</span> ${b.status}${b.halted?' <b class=neg>HALTED</b>':''} — eq ${b.equity.toFixed(2)}`}
async function tick(){try{
const s=await(await fetch('/api/fleet')).json();
pathbtns.innerHTML=['gated','rhythm','knife'].map(p=>['main','15m'].filter(n=>s.bots[n]).map(n=>{const off=(s.bots[n].paths||{})[p]===false;return `<button style="border:2px solid ${off?'#f85149':'#3fb950'};color:${off?'#f85149':'#3fb950'};background:transparent" onclick="post('/api/path',{bot:'${n}',path:'${p}',on:${off?1:0}})">${n==='15m'?'15m':'1m'} ${p[0].toUpperCase()+p.slice(1)} ${off?'OFF':'on'}</button>`}).join(' ')).join(' · ')+(s.bots.new?(()=>{
const off=s.bots.new.paths?.new!==true,down=s.bots.new.peer_offline;return ` · <button ${down?'disabled':''} style="border:2px solid ${off?'#f85149':'#3fb950'};color:${off?'#f85149':'#3fb950'};background:transparent" onclick="post('/api/path',{bot:'new',path:'new',on:${off?1:0}})">Chatty ${down?'OFFLINE':off?'OFF':'on'}</button>`})():'')+
(s.bots.claude||s.bots.claude15?' · '+[tbtn('Claude 1m','claude','claude',s.bots.claude),tbtn('Claude 15m','claude15','claude',s.bots.claude15)].filter(x=>x).join(' '):'')+
(s.bots.swing?' · '+tbtn('Swing','swing','swing',s.bots.swing):'')+
(s.bots.short?' · '+tbtn('Long Shorts Long','short','long',s.bots.short)+' '+tbtn('Long Shorts Short','short','short',s.bots.short):'')+(s.bots.ranger?' · '+tbtn('Ranger','ranger','ranger',s.bots.ranger):'')+(s.bots.grokky?' · '+tbtn('Grokky Long','grokky','grokky_long',s.bots.grokky)+' '+tbtn('Grokky Short','grokky','grokky_short',s.bots.grokky):'');
claude_1m.innerHTML=claudeBox(s.bots.claude,'Claude 1m');
claude_15m.innerHTML=claudeBox(s.bots.claude15,'Claude 15m');
if(document.getElementById('swing_1h'))swing_1h.innerHTML=swingBox(s.bots.swing,'Swing');
if(document.getElementById('ranger_1h'))ranger_1h.innerHTML=rangerBox(s.bots.ranger);
if(document.getElementById('grokky_1h'))grokky_1h.innerHTML=rangerBox(s.bots.grokky);
if(document.getElementById('short_1h'))short_1h.innerHTML=shortBox(s.bots.short);
async function resumeAll(){await post('/api/fleet/resume',{bot:'all'});const s=await(await fetch('/api/fleet')).json();document.title=((s.positions||[]).length?`(${s.positions.length}) `:'')+(Object.values(s.bots||{}).some(b=>b.halted)?'[!] ':'')+'ScalperBot'}
const errs=Object.entries(s.bots||{}).flatMap(([n,b])=>(b.errors||[]).map(e=>`${n==='main'?'1m':n} ${e}`));
errlog.innerHTML=errs.length?errs.slice(0,6).join('<br>'):'';
const nb=s.bots.new, ni=nb?.new_scan_info||{};
newbot.innerHTML=nb?`<span class="badge bnew">Chatty</span> ${nb.mode.toUpperCase()} · ${nb.status}${nb.halted?' HALTED: '+nb.halt_reason:''} · ${ni.status||'warming'} · ${ni.watched||0} watched · BTC regime ${ni.btc_regime_pct==null?'unknown':ni.btc_regime_pct.toFixed(2)+'%'} · ${ni.ts||'—'}<br>Blocks: ${(ni.blocked||[]).map(([reason,n])=>`${n} ${reason}`).join(' · ')||'none'}<br>`+
((nb.new_candidates||[]).length?'<table><tr><th>Symbol</th><th>Price</th><th>Fee / side</th><th>Result</th></tr>'+(nb.new_candidates||[]).map(r=>`<tr><td>${symL(r.symbol)}</td><td>${fmt(r.price)}</td><td>${r.fee.toFixed(2)}%</td><td>${r.blocked}</td></tr>`).join('')+'</table>':'No eligible watch symbols yet'):'Chatty offline';
const posKeys=new Set((s.positions||[]).map(p=>p.bot+':'+p.symbol));
if(_seenPos===null){_seenPos=posKeys}
else{posKeys.forEach(k=>{if(!_seenPos.has(k)){_seenPos.add(k);ding()}})}
const newestTr=(s.trades||[]).length?Math.max(...s.trades.map(t=>t.exit_ts)):0;
if(_seenTr===null){_seenTr=newestTr}else if(newestTr>_seenTr){const t=s.trades.find(x=>x.exit_ts===newestTr);trill(t&&t.net>=0);_seenTr=newestTr}
const halted=Object.values(s.bots||{}).some(b=>b.halted);
document.title=(s.positions.length?`(${s.positions.length}) `:'')+(halted?'[!] ':'')+'ScalperBot';
mode.textContent='['+s.mode+']';
equity.textContent='$'+(s.spot_equity??s.account_equity).toFixed(2);
margin_eq.textContent='$'+(s.margin_equity??0).toFixed(2);
upnl.textContent=(s.unrealized>=0?'+':'')+s.unrealized.toFixed(4);upnl.className=cls(s.unrealized);
rpnl.textContent=(s.day_realized>=0?'+':'')+s.day_realized.toFixed(4);rpnl.className=cls(s.day_realized);
fees.textContent='$'+s.fees_today.toFixed(4);trades.textContent=s.trades_today;
npos.textContent='('+s.positions.length+' open)';
positions.innerHTML=s.positions.length?('<table><tr><th>Bot</th><th>Symbol</th><th>Qty</th><th>Value</th><th>Entry</th><th>Last</th><th>PnL%</th><th>Stop</th><th>Target</th><th>Start</th><th>Held</th></tr>'+
s.positions.map(p=>`<tr><td><span class="badge ${bcls(p.bot)}">${pathLabel(p.path)} ${p.side?p.side.toUpperCase():btf(p.bot)}</span></td><td>${symL(p.symbol)}</td><td>${fmtQ(p.qty)}</td><td>$${(p.qty*p.last).toFixed(2)}</td><td>${fmt(p.entry)}</td><td>${fmt(p.last)}</td><td class=${cls(p.upnl_pct)} style="white-space:nowrap">${p.upnl_pct.toFixed(2)}%</td><td>${fmt(p.stop)}</td><td>${fmt(p.take)}</td><td style="white-space:nowrap">${new Date(Date.now()-p.held_s*1000).toLocaleTimeString()}</td><td style="white-space:nowrap">${p.held_s>=120?Math.round(p.held_s/60)+'m':(p.held_s|0)+'s'}</td><td><button style="color:#f85149;border:1px solid #f85149;background:transparent;padding:1px 7px" onclick="manualClose('${p.bot}','${p.symbol}')">✕</button></td></tr>`).join('')+'</table>'):'No trades open'+(Object.entries(s.bots||{}).flatMap(([n,b])=>Object.entries(b.cooldowns||{}).map(([sym,sec])=>`${sym} ${Math.ceil(sec/60)}m (${n==='15m'?'15m':'1m'})`)).length?' — cooldown: '+Object.entries(s.bots||{}).flatMap(([n,b])=>Object.entries(b.cooldowns||{}).map(([sym,sec])=>`${sym} ${Math.ceil(sec/60)}m (${n==='15m'?'15m':'1m'})`)).join(', '):'');
for(const name of ['main','15m']){const b=s.bots[name];
 if(b){document.getElementById('cands_'+name).innerHTML=candTable(b.candidates||[]);
   const ss=b.scan_stats||{};
   document.getElementById('stats_'+name).textContent=
     `spikes ${ss.spike_events_today??0} today | max relVol ${(ss.max_relvol_today??0).toFixed(2)}x`;}}
ai.textContent=(s.bots.main&&s.bots.main.ai_analysis)||'-';
function rhythmTable(b){const rh=(b&&b.rhythm)||[];const inf=(b&&b.rhythm_scan_info)||{};
const st=b&&b.rhythm_scanning?`<div class=pos style="font-size:12px">scanning for pairs...</div>`:
`<div style="font-size:12px;color:#8b949e">last scan ${inf.ts||'—'}: ${inf.pairs||0} pairs, ${inf.found||0} active swings, ${inf.watching||0} fast-watched, ${inf.flow_watch||0} flow-watched<br>Geometry: ${((inf.filtered)||[]).map(([why,n])=>`${n} ${why}`).join(' · ')}<br>Entry checks (overlap): ${((inf.gates)||[]).map(([why,n])=>`${n} ${why}`).join(' · ')}</div>`;
const mk=(v)=>v===undefined||v===null?'<span style="color:#484f58">?</span>':v?'<b class=pos>✓</b>':'<b class=neg>✗</b>';
const bullCells=(r)=>[0,1,2].map((i)=>{const v=(r.bulls||[])[i];return i===0
?`<span style="color:#6e7681" title="Older completed - informational only, not a gate">${v?'✓':'–'}</span>`
:`<span title="${i===1?'Previous completed (required)':'Forming now (required)'}">${mk(v)}</span>`}).join(' | ');
return st+(rh.length?('<table><tr><th>Symbol</th><th>Range</th><th>Pos</th><th>Floor</th><th>Bulls (old info | prev required | live required)</th><th>Buyers</th><th>Flow</th><th>Checks</th><th>Still needed</th></tr>'+
rh.slice(0,8).map(r=>`<tr><td>${symL(r.symbol)}</td><td>${r.range_atr.toFixed(1)}x</td><td>${(r.zone*100).toFixed(0)}%${r.in_zone?' <b class=pos>◄</b>':''}</td><td>${mk(r.near_floor)}</td><td>${bullCells(r)}</td><td>${mk(r.buyers)}</td><td>${r.flow||'pending'}</td><td>${r.ready??0}/4</td><td>${r.blocked||'checking'}</td></tr>`).join('')+'</table>'):'no recent confirmed swings; no older coins padded into the list')}
document.getElementById('rhythm_main').innerHTML=rhythmTable(s.bots.main);
document.getElementById('rhythm_15m').innerHTML=rhythmTable(s.bots['15m']);
function knifeTable(b){const ks=(b&&b.knives)||[];
return ks.length?`<table><tr><th>Symbol</th><th>Drop</th><th>Bounce rec</th><th>Px</th></tr>`+ks.map(r=>`<tr><td>${symL(r.symbol)}</td><td class=neg>-${r.drop}%</td><td>${r.rec}</td><td>${fmt(r.price)}</td></tr>`).join('')+'</table>':'no knives qualifying';}
document.getElementById('knife_main').innerHTML=knifeTable(s.bots.main);
document.getElementById('knife_15m').innerHTML=knifeTable(s.bots['15m']);
const r=s.risk_limits||{};
if(!document.activeElement||!document.getElementById('risk').contains(document.activeElement)){
// risknote removed
risk.innerHTML='<table>'+Object.entries(r).map(([k,v])=>`<tr><td>${LABELS[k]||k}</td><td>${v}</td><td><input id=r_${k} placeholder=new onkeydown="if(event.key==='Enter')setRisk('main','${k}',this.value)"><button onclick="setRisk('main','${k}',r_${k}.value)">set</button></td></tr>`).join('')+'</table>';
}}catch(e){document.getElementById('equity').textContent='err: '+e}}
document.querySelectorAll('details[id]').forEach(d=>{const k='pnl_'+d.id,v=localStorage.getItem(k);if(v!==null)d.open=v==='1';d.addEventListener('toggle',()=>localStorage.setItem(k,d.open?'1':'0'))});
setInterval(tick,2000);tick();
</script></body></html>"""


PEER_BOTS = {
    kv.split("=")[0]: kv.split("=", 1)[1]
    for kv in os.environ.get("PEER_BOTS", "").split(",") if "=" in kv
}


class Dashboard:
    def __init__(self, cfg, bot):
        self.cfg, self.bot = cfg, bot

    async def start(self):
        if not self.cfg.dashboard.enabled:
            return
        app = web.Application(middlewares=[basic_auth])
        app.router.add_get("/", self.index)
        app.router.add_get("/api/state", self.state)
        app.router.add_get("/api/fleet", self.fleet)
        app.router.add_get("/api/history", self.history)
        app.router.add_get("/api/perf", self.perf)
        app.router.add_post("/api/analyze", self.analyze)
        app.router.add_post("/api/ask", self.ask)
        app.router.add_post("/api/fleet/risk", self.fleet_risk)
        app.router.add_post("/api/fleet/halt", self.fleet_halt)
        app.router.add_post("/api/path", self.path_toggle)
        app.router.add_post("/api/fleet/resume", self.fleet_resume)
        app.router.add_post("/api/halt", self.halt)
        app.router.add_post("/api/resume", self.resume)
        app.router.add_post("/api/close", self.close_pos)
        app.router.add_post("/api/risk", self.risk)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.cfg.dashboard.host,
                           self.cfg.dashboard.port)
        await site.start()
        log.info("dashboard: http://%s:%s", self.cfg.dashboard.host,
                 self.cfg.dashboard.port)

    async def index(self, _):
        return web.Response(
            text=PAGE, content_type="text/html",
            headers={"Cache-Control": "no-store"})

    async def state(self, _):
        return web.json_response(self.bot.snapshot())

    async def halt(self, _):
        self.bot.emergency_stop("dashboard button")
        return web.json_response({"ok": True})

    async def close_pos(self, req):
        """Manual close of one open position at market."""
        try:
            body = await req.json()
            sym, bot = body.get("symbol"), body.get("bot")
            if bot != self.bot.bot_id:
                url = PEER_BOTS.get(bot)
                if not url:
                    return web.json_response({"ok": False, "error": "unknown bot"},
                                             status=400)
                async with self.bot.session.post(
                        url + "/api/close", json=body,
                        headers=self._auth()) as response:
                    return web.json_response(
                        await response.json(), status=response.status)
            if not sym or sym not in self.bot.pm.open:
                return web.json_response({"ok": False, "error": "not open"},
                                         status=404)
            st = self.bot.mds.states.get(sym)
            px = st.last_price if st else 0
            trade = await self.bot.close_position(sym, "manual", px)
            return web.json_response({"ok": bool(trade),
                                      "error": None if trade else "sell not filled"})
        except Exception as e:
            log.warning("manual close failed: %s", e)
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    async def resume(self, _):
        self.bot.risk.resume()
        self.bot._cd.clear()                       # clear symbol cooldowns too
        return web.json_response({"ok": True})

    def _persist(self, key, val):
        """Write a risk change back to the mounted config so it survives
        restarts (regex-replaces the `key: value` line, keeps comments)."""
        try:
            import re as _re
            path = os.environ.get("CONFIG_PATH", "config.yaml")
            txt = open(path).read()
            new = _re.sub(rf"^(\s*{key}:\s*)(?:[0-9.eE+-]+|true|false)",
                          rf"\g<1>{val}", txt, count=1, flags=_re.M)
            if new != txt:
                open(path, "w").write(new)
        except Exception as e:
            log.warning("config persist %s: %s", key, e)

    async def risk(self, req):
        try:
            body = await req.json()
            applied = self.bot.risk.update_limits(**body)
            for k in applied:
                self._persist(k, applied[k])
            return web.json_response({"ok": True, "applied": applied})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    # ------------------------------------------------------- fleet view
    def _auth(self):
        u, p = os.environ.get("DASHBOARD_USER", ""), \
            os.environ.get("DASHBOARD_PASSWORD", "")
        return {"Authorization": "Basic " + base64.b64encode(
            f"{u}:{p}".encode()).decode()} if u and p else {}

    async def _peer(self, url):
        try:
            async with self.bot.session.get(
                    url + "/api/state", headers=self._auth(),
                    timeout=__import__('aiohttp').ClientTimeout(total=5)
                    ) as r:
                return await r.json()
        except Exception:
            return None

    async def fleet(self, _):
        own = self.bot.snapshot()
        bots = {own["bot_id"]: own}
        if not hasattr(self, "_last_peer"):
            self._last_peer = {}
        for name, url in PEER_BOTS.items():
            s = await self._peer(url)
            if s:
                self._last_peer[name] = s
                bots[s.get("bot_id", name)] = s
            elif name in self._last_peer:
                bots[name] = {**self._last_peer[name],
                              "status": "offline", "peer_offline": True}
        account_bots = {name: b for name, b in bots.items()
                        if b.get("mode") == own["mode"]}
        total_alloc = sum(b.get("allocation_pct", 100)
                          for b in account_bots.values())
        reserve = own["real_total"] * max(0, 100 - total_alloc) / 100
        positions = []
        for name, b in account_bots.items():
            for p in b.get("positions", []):
                positions.append({
                    "qty": p.get("qty", 0),
                    "last": p.get("last") or p.get("px", 0),
                    "upnl_pct": p.get("upnl_pct", 0),
                    "held_s": p.get("held_s", 0),
                    "take": p.get("take", 0),
                    "path": p.get("path", ""),
                    **p, "bot": name})
        pos_value = sum(p.get("qty", 0) * p.get("last", 0)
                        for p in positions)
        margin_eq = own.get("margin_equity", 0)
        # real_total is the whole spot account when account_totals succeeds.
        # On the fallback path it only covers cash + shared-DB positions, so
        # JSON-side bots (short/ranger) still need their live positions added.
        extra_positions = 0.0 if own.get("spot_total_complete") else sum(
            p.get("qty", 0) * p.get("last", 0) for p in positions
            if p.get("bot") in ("short", "longshort", "ranger"))
        spot_eq = max(0.0, own["real_total"]) + extra_positions
        if not spot_eq:
            spot_eq = (sum(b["equity"] for b in account_bots.values())
                       + reserve + extra_positions)
        return web.json_response({
            "mode": own["mode"],
            # spot equity must never be reduced by margin equity; they are
            # separate accounts and margin is displayed as its own card.
            "account_equity": spot_eq + margin_eq,
            "margin_equity": margin_eq,
            "spot_equity": spot_eq,
            "spot_total_complete": own.get("spot_total_complete", False),
            "unrealized": sum(b.get("unrealized", 0)
                              for b in account_bots.values()),
            "day_realized": sum(b.get("day_realized", 0)
                                for b in account_bots.values()),
            "fees_today": sum(b.get("fees_today", 0)
                              for b in account_bots.values()),
            "trades_today": sum(b.get("trades_today", 0)
                                for b in account_bots.values()),
            "positions": positions,
            "bots": bots,
            "risk_limits": own.get("risk_limits", {}),
        })

    async def fleet_risk(self, req):
        try:
            body = await req.json()
            bot, key, val = body.get("bot"), body.get("key"), body.get("val")
            if bot == "all":
                applied = self.bot.risk.update_limits(**{key: val})
                for k in applied:
                    self._persist(k, applied[k])
                for name, url in PEER_BOTS.items():
                    if name.startswith("claude") or name == "swing":
                        continue        # independent bots keep their own caps
                    try:
                        await self.bot.session.post(
                            url + "/api/risk", json={key: val},
                            headers=self._auth(),
                            timeout=__import__('aiohttp').ClientTimeout(total=5))
                    except Exception as e:
                        log.warning("fleet risk peer %s: %s", url, e)
                return web.json_response({"ok": True, "applied": applied})
            if bot in (None, "main", self.bot.bot_id):
                applied = self.bot.risk.update_limits(**{key: val})
                for k in applied:
                    self._persist(k, applied[k])
                return web.json_response({"ok": True, "applied": applied})
            url = PEER_BOTS.get(bot)
            if not url:
                return web.json_response({"ok": False,
                                          "error": "unknown bot"}, status=404)
            async with self.bot.session.post(
                    url + "/api/risk", json={key: val}, headers=self._auth(),
                    timeout=__import__('aiohttp').ClientTimeout(total=5)) as r:
                return web.json_response(await r.json(), status=r.status)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    async def path_toggle(self, req):
        try:
            d = await req.json()
        except Exception:
            d = dict(req.query)
        bot, path = d.get("bot"), d.get("path")
        on = str(d.get("on")) in ("1", "true", "True") or d.get("on") is True
        if path not in ("gated", "rhythm", "knife", "new", "claude",
                        "swing", "short", "long", "ranger",
                        "grokky_long", "grokky_short"):
            return web.json_response({"ok": False}, status=400)
        own = {"new": "new", "claude": "claude", "claude15": "claude",
               "swing": "swing", "short": "short", "long": "short",
               "ranger": "ranger", "grokky": "grokky"}
        if bot != "all" and own.get(bot, "classic") != (
                path if path in ("new", "claude", "swing", "short", "long",
                                 "ranger") else
                "grokky" if path.startswith("grokky") else "classic"):
            return web.json_response({"ok": False}, status=400)
        if bot == "all" and path in ("new", "claude", "swing", "short"):
            return web.json_response({"ok": False}, status=400)
        if bot in (self.bot.bot_id, "all"):
            setattr(self.bot.cfg.strategy, f"{path}_enabled", on)
            self._persist(f"{path}_enabled",
                          "true" if on else "false")
        targets = (list(PEER_BOTS) if bot == "all"
                   else ([] if bot == self.bot.bot_id else [bot]))
        for name in targets:
            url = PEER_BOTS.get(name)
            if url:
                try:
                    import aiohttp as _a
                    async with _a.ClientSession() as se:
                        await se.post(url + "/api/path", json={
                            "bot": name, "path": path, "on": on},
                            headers=self._auth())
                except Exception as e:
                    log.warning("peer path %s: %s", name, e)
        return web.json_response({"ok": True})

    async def _peer_post(self, bot, path):
        if bot == "all":
            targets = [None] + list(PEER_BOTS.values())
        elif bot in ("main", self.bot.bot_id):
            targets = [None]
        else:
            targets = [PEER_BOTS.get(bot)]
        for url in targets:
            try:
                if url is None:
                    if "halt" in path:
                        self.bot.emergency_stop("dashboard")
                    else:
                        self.bot.risk.resume()
                        self.bot._cd.clear()
                else:
                    await self.bot.session.post(
                        url + path, headers=self._auth(),
                        timeout=__import__('aiohttp').ClientTimeout(total=5))
            except Exception as e:
                log.warning("fleet %s failed for %s: %s", path, url, e)

    async def fleet_halt(self, req):
        body = await req.json()
        await self._peer_post(body.get("bot", "all"), "/api/halt")
        return web.json_response({"ok": True})

    async def fleet_resume(self, req):
        body = await req.json()
        await self._peer_post(body.get("bot", "all"), "/api/resume")
        return web.json_response({"ok": True})

    async def analyze(self, _):
        txt = await self.bot.analyst.analyze(
            self.bot.snapshot(), force=True)
        self.bot.ai_analysis = txt
        return web.json_response({"text": txt})

    async def ask(self, req):
        try:
            body = await req.json()
            q = (body.get("question") or "").strip()[:500]
            if not q:
                return web.json_response({"text": "ask something first"})
            txt = await self.bot.analyst.ask(q, self.bot.snapshot())
            return web.json_response({"text": txt})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)},
                                     status=500)

    async def perf(self, req):
        """Timeframe stats from the shared trades table (both bots)."""
        try:
            from .performance import compute
            days = float(req.query.get("days", "0"))
            rows = self.bot.storage.trades(mode=self.bot.cfg.execution.mode)
            if days > 0:
                cut = time.time() - days * 86400
                rows = [t for t in rows if t["exit_ts"] >= cut]
            base = (self.bot.real_total
                    or self.bot.risk.start_equity or 1.0)
            rows2 = [dict(t) for t in rows]
            m = compute(rows2, base)
            m["net_pct"] = m.get("net_pnl", 0) / base * 100 if base else 0
            # path scoreboard: which hunter earns its keep?
            by_path = {}
            for t in rows2:
                try:
                    mt = t.get("meta") or {}
                    if isinstance(mt, str):
                        mt = json.loads(mt)
                    p = signal_path(mt.get("signal"))
                except Exception:
                    p = "unknown"
                d = by_path.setdefault(p, {"trades": 0, "wins": 0, "net": 0.0})
                d["trades"] += 1
                d["net"] += t["net_pnl"]
                d["wins"] += t["net_pnl"] > 0
            m["by_path"] = by_path
            # regret analysis: did time_exited trades recover in the next 40m?
            tex = [t for t in rows2 if t["exit_reason"] == "time_exit"][-25:]
            rec, rally = 0, []
            for t in tex:
                try:
                    kk = await self.bot.rest.candles(
                        t["symbol"], self.bot.cfg.market.candle_interval,
                        int(t["exit_ts"]), int(t["exit_ts"]) + 2400)
                    if kk and t["entry_price"]:
                        mx = max(float(r[3]) for r in kk)
                        rally.append((mx / t["entry_price"] - 1) * 100)
                        if mx > t["entry_price"]:
                            rec += 1
                except Exception:
                    pass
            m["regret"] = {"checked": len(tex), "recovered": rec,
                           "avg_max_rally_pct": round(
                               sum(rally) / len(rally), 2) if rally else 0}
            return web.json_response(m)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)},
                                     status=500)

    async def history(self, _):
        """Closed trades from the SHARED db - both bots land here."""
        try:
            rows = self.bot.storage.trades(mode=self.bot.cfg.execution.mode)
            out = []
            for t in reversed(rows[-200:]):
                t = dict(t)
                meta = json.loads(t.get("meta") or "{}")
                path = signal_path(meta.get("signal"))
                if path == "unknown":
                    path = (f"{meta.get('bot')}_{t.get('side')}"
                            if meta.get("bot") in ("grokky", "longshort")
                            and t.get("side")
                            else meta.get("bot") or path)
                out.append({
                    "bot": meta.get("bot", "-"),
                    "path": path,
                    "symbol": t["symbol"],
                    "entry_ts": t["entry_ts"], "exit_ts": t["exit_ts"],
                    "held_s": t["exit_ts"] - t["entry_ts"],
                    "qty": t["qty"], "entry": t["entry_price"],
                    "exit": t["exit_price"], "net": t["net_pnl"],
                    "fees": t["fees"], "reason": t["exit_reason"],
                })
            return web.json_response({"trades": out})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)},
                                     status=500)
