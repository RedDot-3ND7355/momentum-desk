"use strict";
const $ = (s, r = document) => r.querySelector(s);
const TZ = "America/Toronto";
let D = null, LIVE = {}, usdcadLive = null, wsOK = false, range = "1D", tab = "home", feedFilter = "all", liveSeries = [];
const AGENTS = ["Scanner", "Analyst", "Executor", "Risk"];

/* ---------- formatting ---------- */
const nf = (n, d = 2) => Number(n).toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = n => (n < 0 ? "-" : "") + "$" + nf(Math.abs(n));
const sgn = (n, d = 2) => (n >= 0 ? "+" : "-") + nf(Math.abs(n), d);
const pxs = v => v == null ? "–" : v >= 1000 ? nf(v, 2) : v >= 10 ? nf(v, 2) : v >= 0.01 ? nf(v, 4) : Number(v).toPrecision(3);
const tfmt = (t, o) => new Date(t * 1000).toLocaleString("en-CA", Object.assign({ timeZone: TZ }, o));
const tTime = t => tfmt(t, { hour: "numeric", minute: "2-digit" });
const tDay = t => tfmt(t, { month: "short", day: "numeric" });
const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return (s / 3600).toFixed(1).replace(".0", "") + " h ago"; return Math.round(s / 86400) + " d ago"; };
const fx = () => usdcadLive || (D && D.account.usdcad) || 1.4;
const cls = n => n >= 0 ? "up" : "dn";

/* ---------- live prices ---------- */
function livePrice(c) { const l = LIVE[c.ws]; return l ? l.last : c.price; }
function liveBid(sym, fb) { const l = LIVE[sym]; return l ? l.bid : fb; }
function liveAccount() {
  const a = D.account; let pos = 0;
  for (const p of D.positions) pos += p.volume * liveBid(p.ws, p.bid) * (p.quote === "USD" ? fx() : 1);
  const total = a.cash_cad + a.cash_usd * fx() + pos;
  return { total, pnl: total - a.start, pct: (total / a.start - 1) * 100, mult: total / a.start, pos };
}
function connectWS() {
  if (!D) return;
  let ws; try { ws = new WebSocket("wss://ws.kraken.com/v2"); } catch (e) { return; }
  ws.onopen = () => ws.send(JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: D.ws_symbols } }));
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.channel !== "ticker" || !m.data) return;
    if (!wsOK) { wsOK = true; setPill(); }
    for (const d of m.data) { LIVE[d.symbol] = { last: d.last, bid: d.bid, pct: d.change_pct }; if (d.symbol === "USD/CAD") usdcadLive = d.last; }
    scheduleLive();
  };
  ws.onclose = () => { wsOK = false; setPill(); setTimeout(connectWS, 4000); };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}
function setPill() { const p = $("#livepill"); p.className = "livepill" + (wsOK ? "" : " off"); $("span", p).textContent = wsOK ? "LIVE" : "OFFLINE"; }
let liveT = null;
function scheduleLive() { if (liveT) return; liveT = setTimeout(() => { liveT = null; applyLive(); }, 700); }
function applyLive() {
  const a = liveAccount();
  liveSeries.push({ t: Date.now() / 1000, v: a.total }); if (liveSeries.length > 900) liveSeries.shift();
  if (tab === "home" && $("#v-coin").hidden) { updateBalance(a); drawHomeChart(); updatePositionsLive(); }
  if (!$("#v-coin").hidden) renderCoinLive();
}

/* ---------- odometer ---------- */
function odoBuild(el, str) {
  el.innerHTML = '<span class="cur">C$</span>';
  el._cols = [];
  for (const ch of str) {
    if (/\d/.test(ch)) {
      const col = document.createElement("span"); col.className = "col";
      col.innerHTML = "<div>" + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<span>${d}</span>`).join("") + "</div>";
      el.appendChild(col); el._cols.push(col.firstChild);
    } else { const s = document.createElement("span"); s.className = "ch"; s.textContent = ch; el.appendChild(s); }
  }
  el._len = str.length;
}
function odoSet(el, str, animateFromZero) {
  if (!el._cols || el._len !== str.length) { odoBuild(el, str); animateFromZero = true; }
  const digits = str.replace(/\D/g, "");
  const apply = () => el._cols.forEach((c, i) => { c.style.transform = `translateY(-${Number(digits[i]) * 1.1}em)`; });
  if (animateFromZero) { el._cols.forEach(c => { c.style.transition = "none"; c.style.transform = "translateY(0)"; }); void el.offsetHeight; el._cols.forEach((c, i) => { c.style.transition = `transform ${0.9 + i * 0.12}s cubic-bezier(.2,.8,.2,1)`; }); requestAnimationFrame(apply); }
  else apply();
}

/* ---------- charts ---------- */
function chartSVG(pts, o = {}) {
  // pts: [{t,v}] ; o.lines: [{v,color,label,dash}] ; returns {svg, X(t), Y(v)}
  const W = 400, H = 200, padT = 22, padB = 14, padR = o.padR || 6;
  const vs = pts.map(p => p.v).concat((o.lines || []).map(l => l.v));
  let lo = Math.min(...vs), hi = Math.max(...vs); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const m = (hi - lo) * 0.12; lo -= m; hi += m;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = t => 4 + (W - 4 - padR) * ((t - t0) / Math.max(1, t1 - t0));
  const Y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const col = o.color || "#2dff8a";
  const path = pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join("");
  const area = path + `L${X(t1).toFixed(1)} ${H}L${X(t0).toFixed(1)} ${H}Z`;
  const id = "g" + Math.random().toString(36).slice(2, 7);
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 1; i < 4; i++) s += `<line x1="0" x2="${W}" y1="${padT + (H - padT - padB) * i / 4}" y2="${padT + (H - padT - padB) * i / 4}" stroke="#1a2321" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  s += `<path d="${area}" fill="url(#${id})"/>`;
  for (const l of o.lines || []) s += `<line x1="0" x2="${W}" y1="${Y(l.v).toFixed(1)}" y2="${Y(l.v).toFixed(1)}" stroke="${l.color}" stroke-width="1.5" stroke-dasharray="${l.dash || "5 4"}" vector-effect="non-scaling-stroke"/>`;
  s += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 5px ${col}88)"/>`;
  s += "</svg>";
  const last = pts[pts.length - 1];
  return { svg: s, X: t => X(t) / W * 100, Y: v => Y(v) / H * 100, last: { x: X(last.t) / W * 100, y: Y(last.v) / H * 100 }, W, H };
}
function pillsHTML(ch, evs) {
  let out = "", lastX = -99;
  for (const e of evs) {
    const x = ch.X(e.t); if (x < 3 || x > 97) continue;
    const y = ch.Y(e.yv); if (Math.abs(x - lastX) < 11) continue; lastX = x;
    const label = e.kind === "bought" ? "Buy " + e.coin : (e.pnl_pct >= 0 ? "+" : "") + nf(e.pnl_pct, 1) + "% " + e.coin;
    const c = e.kind === "bought" ? "buy" : e.win ? "win" : "stop";
    out += `<span class="evt ${c}" style="left:${x}%;top:${y}%">${label}</span>`;
  }
  return out;
}
function yAt(pts, t) { let v = pts[0].v; for (const p of pts) { if (p.t <= t) v = p.v; else break; } return v; }

/* ---------- HOME ---------- */
function rangePts() {
  const now = Date.now() / 1000, h = D.history.slice(); const a = liveAccount();
  h.push({ t: now, v: a.total });
  if (range === "LIVE") {
    const base = liveSeries.length > 1 ? liveSeries : [];
    const seed = h.filter(p => p.t >= now - 3600);
    return seed.concat(base).sort((x, y) => x.t - y.t);
  }
  const span = { "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800, ALL: 1e12 }[range];
  const cut = now - span; let pts = h.filter(p => p.t >= cut);
  if (pts.length < 2) { const prev = [...h].reverse().find(p => p.t < cut); if (prev) pts.unshift({ t: cut, v: prev.v }); }
  return pts.length >= 2 ? pts : h.slice(-2);
}
function drawHomeChart() {
  const box = $("#hchart"); if (!box) return;
  const pts = rangePts(); const up = pts[pts.length - 1].v >= pts[0].v;
  const ch = chartSVG(pts, { color: up ? "#2dff8a" : "#ff4d5e" });
  const evs = D.trades.filter(t => t.t >= pts[0].t && t.t <= pts[pts.length - 1].t).map(t => Object.assign({ yv: yAt(pts, t.t) }, t));
  const dot = `<span style="position:absolute;left:${ch.last.x}%;top:${ch.last.y}%;width:10px;height:10px;margin:-5px;border-radius:50%;background:#fff;box-shadow:0 0 12px ${up ? "#2dff8a" : "#ff4d5e"}"></span>`;
  box.innerHTML = ch.svg + pillsHTML(ch, evs) + dot;
}
function updateBalance(a) {
  const el = $("#odo"); if (!el) return;
  odoSet(el, nf(a.total), false);
  const p = $("#pnl"); const c = a.pnl >= 0 ? "up" : "dn";
  p.innerHTML = `<span class="${c}">${a.pnl >= 0 ? "▲" : "▼"} ${money(a.pnl)} (${sgn(a.pct)}%)</span><span class="pill ${a.pnl >= 0 ? "" : "dn"}">${nf(a.mult, 2)}x</span><span class="mut" style="font-weight:600;font-size:12px">since start</span>`;
}
function agentCards() {
  const s = D.stats, top = [...D.coins].sort((a, b) => b.score - a.score || b.ch24 - a.ch24)[0];
  const held = D.positions;
  const tape = [...D.coins].sort((a, b) => b.ch24 - a.ch24).map(c => `<span class="${cls(c.ch24)}">${c.coin} ${c.ch24 >= 0 ? "+" : ""}${nf(c.ch24, 1)}%</span>`).join("");
  const ring = (sc) => { const r = 32, C = 2 * Math.PI * r; return `<svg class="gauge" viewBox="0 0 80 80"><circle cx="40" cy="40" r="${r}" fill="none" stroke="#1e2826" stroke-width="8"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="${sc >= 5 ? "#2dff8a" : sc >= 4 ? "#ffc24a" : "#7d8b86"}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C * sc / 5} ${C}" transform="rotate(-90 40 40)"/><text x="40" y="47" text-anchor="middle">${sc}/5</text></svg>`; };
  const nextOrder = held.length ? `Holding ${held.map(p => p.coin).join(", ")}` : (D.btc && !D.btc.ok ? "Waiting · BTC filter blocked" : s.at5 ? s.at5 + " coin(s) ready to buy" : "Waiting for a 5/5 setup");
  return [
    `<div class="acard" data-go="agents"><h3><i></i>Scanner</h3><div class="big">${s.scanned} coins</div><div class="small">Kraken 1h candles<br>${s.at5} at 5/5 · ${s.at4} at 4/5</div><div class="tape"><div>${tape}</div></div></div>`,
    `<div class="acard" data-go="agents"><h3><i></i>Analyst</h3><div class="big">${top.coin}</div><div class="small">Top score now<br>${top.checks.filter(x => !x).length ? "Missing: " + missing(top) : "All checks pass"}</div>${ring(top.score)}</div>`,
    `<div class="acard" data-go="agents"><h3><i></i>Executor</h3><div class="big">${s.entries} trades</div><div class="small">${s.wins}W / ${s.losses}L closed<br>Order: ${nextOrder}</div></div>`,
    `<div class="acard" data-go="agents"><h3><i></i>Risk</h3><div class="big">${held.length} guarded</div><div class="small">ATR stops, 2.5x trailing,<br>break-even &amp; EMA50 exit${D.btc ? "<br>BTC filter: " + (D.btc.ok ? "OPEN" : "BLOCKED") : ""}</div></div>`
  ].join("");
}
const SHORTCK = ["EMA20", "20>50", "24h", "volume", "breakout"];
const missing = c => c.checks.map((x, i) => x ? null : SHORTCK[i]).filter(Boolean).join(", ");
function feedItem(t) {
  if (t.run) return `<div class="it"><div class="ic run">⟳</div><div class="m"><div class="t">Scanned ${t.scanned} coins</div><div class="s">Scanner · ${tTime(t.t)} · ${tDay(t.t)}</div></div><div class="a"><span class="mut">${t.passed} passed</span></div></div>`;
  const cad = t.value * (t.quote === "USD" ? D.account.usdcad : 1);
  const c = t.kind === "bought" ? "buy" : t.win ? "win" : "stop";
  const title = t.kind === "bought" ? "Bought " + t.coin : t.kind === "stopped" ? "Stopped " + t.coin : "Sold " + t.coin;
  const icon = t.kind === "bought" ? "＋" : t.kind === "stopped" ? "✕" : "✓";
  const right = t.kind === "bought" ? `<b>${money(cad)}</b>` : `<b class="${cls(t.pnl_cad)}">${t.pnl_cad >= 0 ? "+" : "-"}${money(Math.abs(t.pnl_cad))}</b><small class="${cls(t.pnl_pct)}">${sgn(t.pnl_pct)}%</small>`;
  return `<div class="it" data-coin="${t.coin}" data-win="${t.win ? 1 : 0}"><div class="ic ${c}">${icon}</div><div class="m"><div class="t">${title}</div><div class="s">${t.source} · ${tTime(t.t)} · ${tDay(t.t)}</div></div><div class="a">${right}</div></div>`;
}
function renderHome() {
  const a = liveAccount(), s = D.stats;
  $("#v-home").innerHTML = `
  <div class="bal-label">Paper account · total balance <span class="paper">PAPER</span></div>
  <div class="odo" id="odo"></div>
  <div class="pnl" id="pnl"></div>
  <div class="sub">Today ${D.account.today_pnl >= 0 ? "+" : "-"}${money(Math.abs(D.account.today_pnl))} (${sgn(D.account.today_pnl_pct)}%) · start $${nf(D.account.start, 0)} CAD · simulated money</div>
  <div class="chartwrap" id="hchart"></div>
  <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-r="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("")}</div>
  <div class="sub" style="text-align:center;margin-top:10px">Last bot run <b>${D.last_run ? tTime(D.last_run) + " · " + ago(D.last_run) : "–"}</b> · next about every 2 h</div>
  <h2>Agents <span class="running"><i></i>4 running</span></h2>
  <div class="carousel">${agentCards()}</div>
  <div id="homepos"></div>
  <h2>Activity <a data-go="activity">See all</a></h2>
  <div class="card feed">${activityItems().slice(0, 5).map(feedItem).join("") || '<div class="mut">No trades yet</div>'}</div>`;
  odoSet($("#odo"), nf(a.total), true); updateBalance(a); drawHomeChart(); updatePositionsLive();
}
function updatePositionsLive() {
  const box = $("#homepos"); if (!box) return;
  if (!D.positions.length) { box.innerHTML = `<div class="card note" style="margin-top:14px">💤 Flat – all cash. ${D.btc && !D.btc.ok ? "BTC is below its 1h EMA50 (" + sgn(D.btc.pct, 2) + "%), so new entries are blocked." : "Waiting for a coin to pass 5/5 checks."}</div>`; return; }
  box.innerHTML = `<h2>Open positions <small>live</small></h2><div class="card feed">` + D.positions.map(p => {
    const b = liveBid(p.ws, p.bid), pct = (b / p.entry - 1) * 100, v = p.volume * b * (p.quote === "USD" ? fx() : 1);
    return `<div class="it" data-coin="${p.coin}"><div class="ic buy">${p.coin.slice(0, 3)}</div><div class="m"><div class="t">${p.coin}</div><div class="s">stop ${pxs(p.stop)} · ${p.breakeven ? "break-even armed" : "initial/trailing"}</div></div><div class="a"><b>${money(v)}</b><small class="${cls(pct)}">${sgn(pct)}%</small></div></div>`;
  }).join("") + "</div>";
}
function activityItems() {
  const items = D.trades.map(t => t).concat(D.runs.map(r => ({ run: true, t: r.t, scanned: r.scanned, passed: r.passed })));
  return items.sort((a, b) => b.t - a.t);
}

/* ---------- ACTIVITY ---------- */
function renderActivity() {
  let items = activityItems();
  if (feedFilter === "trades") items = items.filter(i => !i.run); else if (feedFilter === "runs") items = items.filter(i => i.run);
  $("#v-activity").innerHTML = `<h2>Activity <small>${D.trades.length} fills · ${D.runs.length} runs</small></h2>
  <div class="chips">${[["all", "All"], ["trades", "Trades"], ["runs", "Scans"]].map(([k, l]) => `<button data-f="${k}" class="${feedFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <div class="card feed">${items.map(feedItem).join("")}</div>
  <div class="sub">Tap a trade to open the coin. Amounts in CAD (USD pairs converted at ${nf(D.account.usdcad, 4)}).</div>`;
}

/* ---------- AGENTS ---------- */
function renderAgents() {
  const sorted = [...D.coins].sort((a, b) => b.score - a.score || b.ch24 - a.ch24);
  const b = D.btc;
  $("#v-agents").innerHTML = `<h2>Agents <span class="running"><i></i>4 running</span></h2>
  <div class="card"><h4>BTC filter ${b ? `<span class="pill ${b.ok ? "" : "dn"}">${b.ok ? "OPEN" : "BLOCKED"}</span>` : ""}</h4>
  <div class="note">${b ? `BTC 1h close <b>${nf(b.close, 2)}</b> vs EMA50 <b>${nf(b.ema50, 2)}</b> (${sgn(b.pct, 2)}%). New entries are only allowed while BTC closes <b>above</b> its 1h EMA50.` : "No BTC data."}</div></div>
  <div class="carousel" style="margin-bottom:14px">${agentCards()}</div>
  <div class="card"><h4>What each agent does</h4><div class="note">
  <b>Scanner</b> – reads Kraken 1h candles for ${D.stats.scanned} coins.<br>
  <b>Analyst</b> – scores each coin out of 5: ${D.rules.checks.join(" · ")}. Needs 5/5.<br>
  <b>Executor</b> – buys the strongest 5/5 coin (max ${D.rules.max_positions} positions, ${D.rules.size_pct}% each; memecoins ${D.rules.meme_size_pct}%, max ${D.rules.max_memes}).<br>
  <b>Risk</b> – ATR stop, 2.5x ATR trailing stop, break-even and EMA50 exit. ${D.rules.cooldown_h} h cooldown after a loss.</div></div>
  <h2>All ${D.coins.length} coins <small>scores as of ${D.signals_at ? tTime(D.signals_at) : "–"}</small></h2>
  <div class="card tbl">${sorted.map(c => `<div class="r" data-coin="${c.coin}"><div class="n">${c.coin}${c.meme ? " 🐸" : ""}</div><div class="dots">${c.checks.map(x => `<i class="${x ? "y" : ""}"></i>`).join("")}</div><div class="p">${c.quote === "USD" ? "US$" : "$"}${pxs(livePrice(c))}</div><div class="c ${cls(c.ch24)}">${c.score}/5</div></div>`).join("")}</div>`;
}

/* ---------- COIN ---------- */
let coinSel = null;
function openCoin(coin) { coinSel = coin; location.hash = "coin/" + coin; renderCoin(); $("#v-coin").hidden = false; $("#v-coin").scrollTop = 0; }
function closeCoin() { coinSel = null; $("#v-coin").hidden = true; if (location.hash.startsWith("#coin")) history.replaceState(null, "", location.pathname + location.search); }
function coinCtx() {
  const c = D.coins.find(x => x.coin === coinSel); if (!c) return null;
  const pos = D.positions.find(p => p.coin === coinSel);
  const last = [...D.trades].reverse().find(t => t.coin === coinSel && t.side === "sell");
  const lastBuy = [...D.trades].reverse().find(t => t.coin === coinSel && t.side === "buy");
  return { c, pos, last, lastBuy };
}
function coinLines(pos, last) {
  const lines = [];
  if (pos) { lines.push({ v: pos.entry, color: "#8ab4ff", label: "Entry" }); lines.push({ v: pos.stop, color: "#ff4d5e", label: "Trailing stop", dash: "2 3" }); }
  else if (last) { lines.push({ v: last.entry, color: "#8ab4ff", label: "Last entry" }); if (last.stop) lines.push({ v: last.stop, color: "#ff4d5e", label: "Final stop", dash: "2 3" }); }
  return lines;
}
function renderCoin() {
  const x = coinCtx(); if (!x) return; const { c, pos, last, lastBuy } = x; const q = c.quote === "USD" ? "US$" : "$";
  $("#v-coin").innerHTML = `<div class="coinhead"><button class="back" id="backbtn">‹ Back</button><div class="mut" style="font-weight:700">${c.coin}/${c.quote} <span class="paper">PAPER</span></div></div>
  <div class="price" id="cprice"></div><div id="cchg" style="font-weight:700"></div>
  <div class="chartwrap" id="cchart" style="margin-top:12px"></div><div class="sub" style="text-align:center">Last 72 hours · 1h closes${pos ? " · live tick on the last point" : ""}</div>
  <h2>Stats</h2><div class="grid" id="cstats"></div>
  <h2>Your position</h2><div class="card" id="cpos"></div>
  <h2>Risk</h2><div class="card" id="crisk"></div>
  <h2>Entry checks <small>${c.score}/5</small></h2><div class="card">${c.checks.map((ok, i) => `<div class="chk"><i class="${ok ? "y" : "n"}">${ok ? "✓" : "✕"}</i>${D.rules.checks[i]}</div>`).join("")}${D.btc ? `<div class="chk"><i class="${D.btc.ok ? "y" : "n"}">${D.btc.ok ? "✓" : "✕"}</i>BTC filter ${D.btc.ok ? "open" : "blocked"} (${sgn(D.btc.pct, 2)}% vs EMA50)</div>` : ""}</div>`;
  $("#backbtn").onclick = closeCoin; renderCoinLive();
}
function renderCoinLive() {
  const x = coinCtx(); if (!x || !$("#cprice")) return; const { c, pos, last } = x; const q = c.quote === "USD" ? "US$" : "$";
  const p = livePrice(c); const bid = liveBid(c.ws, c.bid);
  $("#cprice").textContent = q + pxs(p);
  let chg, label;
  if (pos) { chg = (bid / pos.entry - 1) * 100; label = "since entry"; } else { chg = (LIVE[c.ws] ? LIVE[c.ws].pct : c.ch24); label = "24h"; }
  $("#cchg").innerHTML = `<span class="${cls(chg)}">${chg >= 0 ? "▲" : "▼"} ${sgn(chg)}%</span> <span class="mut" style="font-weight:600">${label}</span>`;
  // chart with live tail
  const pts = c.spark.map((v, i) => ({ t: c.spark_t0 + i * 3600, v })); pts.push({ t: Date.now() / 1000, v: p });
  const lines = coinLines(pos, last);
  const ch = chartSVG(pts, { lines, color: chg >= 0 ? "#2dff8a" : "#ff4d5e", padR: 70 });
  let labels = lines.map(l => `<span class="evt buy" style="left:2%;transform:translateY(-125%);top:${ch.Y(l.v)}%;color:${l.color};border-color:${l.color}55;background:#0b0f0e">${l.label} ${pxs(l.v)}</span>`).join("");
  const dot = `<span style="position:absolute;left:${ch.last.x}%;top:${ch.last.y}%;width:10px;height:10px;margin:-5px;border-radius:50%;background:#fff;box-shadow:0 0 12px #2dff8a"></span>`;
  const myTrades = D.trades.filter(t => t.coin === c.coin && t.t >= pts[0].t).map(t => Object.assign({ yv: t.price }, t));
  $("#cchart").innerHTML = ch.svg + pillsHTML(ch, myTrades) + labels + dot;
  const f = v => v == null ? "–" : q + pxs(v);
  const st = [["24h at last scan", `<span class="${cls(c.ch24)}">${sgn(c.ch24)}%</span>`], ["Score", c.score + "/5"], ["Volume (6h vs avg)", c.vol_ratio != null ? nf(c.vol_ratio, 2) + "x" : "–"], ["ATR14 (1h)", f(c.atr)], ["EMA20", f(c.e20)], ["EMA50", f(c.e50)], ["24h high (prior)", f(c.hh24)], ["Bid", f(bid)]];
  $("#cstats").innerHTML = st.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
  if (pos) {
    const val = pos.volume * bid * (pos.quote === "USD" ? fx() : 1), cost = pos.volume * pos.entry * (pos.quote === "USD" ? fx() : 1), pl = val - cost;
    $("#cpos").innerHTML = [["Status", "<b class='up'>OPEN</b> (paper)"], ["Size", nf(pos.volume, 4) + " " + c.coin], ["Entry", f(pos.entry)], ["Value now", money(val) + " CAD"], ["P&L", `<b class="${cls(pl)}">${pl >= 0 ? "+" : "-"}${money(Math.abs(pl))} (${sgn((bid / pos.entry - 1) * 100)}%)</b>`], ["Opened", tDay(pos.opened) + " " + tTime(pos.opened)]].map(([k, v]) => `<div class="row"><span class="mut">${k}</span><span>${v}</span></div>`).join("");
    const gap = (bid / pos.stop - 1) * 100;
    $("#crisk").innerHTML = `<div class="note">Trailing stop at <b>${f(pos.stop)}</b> (${nf(gap, 2)}% below price). Initial stop was ${f(pos.initial_stop)} (entry − 2× ATR, clamped 2–6%). The trailing stop sits 2.5× ATR below the highest bid (${f(pos.highest)}) and only moves up. Break-even ${pos.breakeven ? "<b class='up'>is armed</b>" : "arms after +1.5× ATR"}. The bot also sells on a 1h close below EMA50 (${f(c.e50)}).</div>`;
  } else {
    $("#cpos").innerHTML = last ? `<div class="row"><span class="mut">Status</span><span>No open position</span></div><div class="row"><span class="mut">Last trade</span><span>${last.kind === "stopped" ? "Stopped" : "Sold"} ${tDay(last.t)} ${tTime(last.t)}</span></div><div class="row"><span class="mut">Entry → exit</span><span>${f(last.entry)} → ${f(last.price)}</span></div><div class="row"><span class="mut">Result</span><b class="${cls(last.pnl_cad)}">${last.pnl_cad >= 0 ? "+" : "-"}${money(Math.abs(last.pnl_cad))} (${sgn(last.pnl_pct)}%)</b></div><div class="note" style="margin-top:8px">${last.reason}</div>` : `<div class="note">No open position and no past trades in ${c.coin}. It buys only when all 5 checks pass and the BTC filter is open.</div>`;
    $("#crisk").innerHTML = `<div class="note">If bought: initial stop = entry − 2× ATR (${f(c.atr)} now), clamped to 2–6% below entry${c.meme ? " (memecoins up to 8%)" : ""}. Then a trailing stop 2.5× ATR below the highest bid, break-even after +1.5× ATR, and an exit on a 1h close below EMA50 (${f(c.e50)}).</div>`;
  }
}

/* ---------- ACCOUNT ---------- */
function renderAccount() {
  const a = D.account, s = D.stats, r = D.rules;
  const topic = localStorage.getItem("ntfyTopic") || "";
  $("#v-account").innerHTML = `<h2>Account <span class="paper">PAPER</span></h2>
  <div class="warn">This is a <b>simulation</b>. No real money, no exchange account is connected. Paper balance of Kraken's paper-trading engine, shown in CAD.</div>
  <div class="card"><div class="row"><span class="mut">Total value</span><b>${money(liveAccount().total)} CAD</b></div>
  <div class="row"><span class="mut">Started with</span><span>${money(a.start)} CAD</span></div>
  <div class="row"><span class="mut">Cash (CAD / USD)</span><span>${money(a.cash_cad)} / US${money(a.cash_usd)}</span></div>
  <div class="row"><span class="mut">Open positions</span><span>${D.positions.length} (${money(a.positions_value)})</span></div>
  <div class="row"><span class="mut">Today (realized)</span><span class="${cls(a.today_realized)}">${a.today_realized >= 0 ? "+" : "-"}${money(Math.abs(a.today_realized))}</span></div>
  <div class="row"><span class="mut">Closed trades</span><span>${s.closed} (${s.wins}W / ${s.losses}L) · realized ${s.realized >= 0 ? "+" : "-"}${money(Math.abs(s.realized))}</span></div>
  <div class="row"><span class="mut">Bot runs recorded</span><span>${s.runs}</span></div>
  <div class="row"><span class="mut">Last bot run</span><span>${D.last_run ? tDay(D.last_run) + " " + tTime(D.last_run) : "–"}</span></div>
  <div class="row"><span class="mut">Data published</span><span>${tTime(D.generated_at)} · ${ago(D.generated_at)}</span></div></div>
  <h2>Rules</h2><div class="card note">
  <b>Entry (need 5/5, 1h candles):</b> ${r.checks.join(" · ")}. 24h range +${r.ch24[0]}% to +${r.ch24[1]}% (memes up to +${r.ch24_meme[1]}%). Strongest 24h first.<br>
  <b>BTC filter:</b> ${D.btc ? (D.btc.ok ? "open" : "blocked") + ` – BTC ${sgn(D.btc.pct, 2)}% vs 1h EMA50` : "–"}.<br>
  <b>Stops:</b> ${r.stop}. ${r.trail}. ${r.breakeven}. ${r.ema_exit}.<br>
  <b>Sizing:</b> ${r.size_pct}% per position (memecoins ${r.meme_size_pct}%), max ${r.max_positions} positions, max ${r.max_memes} memecoins. ${r.halt}. ${r.cooldown_h} h cooldown per coin after a losing exit.</div>
  <h2>Notifications</h2><div class="card note">
  GitHub Pages can't send push messages, so alerts come through the free <b>ntfy</b> app. After each bot run, the publisher sends a short alert <b>only</b> when a trade opened or closed, and for the <b>10 PM daily summary</b>. Tapping the alert opens this app.
  <ol class="steps"><li>Install <b>ntfy</b> from Google Play (or F-Droid).</li><li>Tap <b>+</b>, keep the server <code>ntfy.sh</code>, and subscribe to your private topic name (it was sent to you in chat – it is not stored in this public page).</li><li>Allow notifications for ntfy in Android settings.</li></ol>
  <input class="f" id="topicin" placeholder="Paste your topic here (stays on this phone)" value="${topic}">
  <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" id="ntfylink" href="#">Open in ntfy app</a><button class="btn ghost" id="ntfytest">Send test alert</button></div>
  <div class="sub" id="ntfymsg"></div></div>
  <h2>App</h2><div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="installbtn" hidden>Install app</button><button class="btn ghost" id="refresh">Refresh data</button><button class="btn ghost" id="confbtn">🎉 Confetti</button></div>
  <div class="sub">Live prices: Kraken public WebSocket (${wsOK ? "connected" : "offline"}). Trades, positions and scores update when the bot runs (about every 2 h). Not financial advice.</div></div>`;
  const upd = () => { const t = $("#topicin").value.trim(); localStorage.setItem("ntfyTopic", t); $("#ntfylink").href = t ? "ntfy://ntfy.sh/" + encodeURIComponent(t) : "https://ntfy.sh/"; };
  $("#topicin").oninput = upd; upd();
  $("#ntfytest").onclick = async () => { const t = $("#topicin").value.trim(); if (!t) { $("#ntfymsg").textContent = "Paste your topic first."; return; }
    try { const r = await fetch("https://ntfy.sh/" + encodeURIComponent(t), { method: "POST", body: "Test alert from Momentum Desk (paper)", headers: { Title: "Momentum Desk test", Click: location.origin + location.pathname } }); $("#ntfymsg").textContent = r.ok ? "Sent – check your ntfy app." : "ntfy returned " + r.status; } catch (e) { $("#ntfymsg").textContent = "Could not reach ntfy.sh"; } };
  $("#refresh").onclick = async () => { await loadData(true); render(); };
  $("#confbtn").onclick = () => confetti();
  if (deferredInstall) $("#installbtn").hidden = false;
  $("#installbtn").onclick = async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $("#installbtn").hidden = true; } };
}
let deferredInstall = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; const b = $("#installbtn"); if (b) b.hidden = false; });

/* ---------- confetti ---------- */
function confetti() {
  const cv = $("#confetti"), ctx = cv.getContext("2d"); cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const cols = ["#2dff8a", "#00c46a", "#ffffff", "#ffc24a", "#8ab4ff"]; const P = [];
  for (let i = 0; i < 140; i++) P.push({ x: innerWidth / 2 + (Math.random() - .5) * 60, y: innerHeight * .4, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length] });
  let f = 0;
  (function tick() { ctx.clearRect(0, 0, innerWidth, innerHeight); f++;
    for (const p of P) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - f / 150); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
    if (f < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight); })();
}
function checkWins() {
  const seen = JSON.parse(localStorage.getItem("seenTrades") || "null");
  const ids = D.trades.map(t => t.id);
  if (seen) { const fresh = D.trades.filter(t => t.win && !seen.includes(t.id)); if (fresh.length) setTimeout(confetti, 900); }
  localStorage.setItem("seenTrades", JSON.stringify(ids));
  if (/confetti=1/.test(location.search)) setTimeout(confetti, 1200);
}

/* ---------- shell ---------- */
function render() {
  if (!D) return;
  renderHome(); renderAgents(); renderActivity(); renderAccount();
  if (coinSel) renderCoin();
}
function showTab(t) {
  tab = t; closeCoin();
  for (const v of ["home", "agents", "activity", "account"]) $("#v-" + v).hidden = v !== t;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  scrollTo(0, 0);
}
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { showTab(g.dataset.go); return; }
  const tb = e.target.closest("#tabs button"); if (tb) { showTab(tb.dataset.tab); return; }
  const rg = e.target.closest("[data-r]"); if (rg) { range = rg.dataset.r; document.querySelectorAll(".ranges button").forEach(b => b.classList.toggle("on", b.dataset.r === range)); drawHomeChart(); return; }
  const fl = e.target.closest("[data-f]"); if (fl) { feedFilter = fl.dataset.f; renderActivity(); return; }
  const it = e.target.closest("[data-coin]"); if (it) { if (it.dataset.win === "1") confetti(); openCoin(it.dataset.coin); }
});
addEventListener("popstate", () => { if (!location.hash.startsWith("#coin")) { coinSel = null; $("#v-coin").hidden = true; } });
async function loadData(force) {
  try { const r = await fetch("app-data.json?t=" + Date.now(), { cache: "no-store" }); const nd = await r.json(); const first = !D; D = nd; if (first) { connectWS(); } else if (D.ws_symbols) {} return true; }
  catch (e) { return !!D; }
}
(async function init() {
  setPill();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await loadData();
  if (!D) { $("#v-home").innerHTML = '<div class="card">Could not load app-data.json</div>'; return; }
  render(); checkWins();
  const m = location.hash.match(/^#coin\/(\w+)/); if (m && D.coins.find(c => c.coin === m[1])) openCoin(m[1]);
  setInterval(async () => { const old = D.generated_at; await loadData(); if (D.generated_at !== old && !coinSel) { render(); checkWins(); } }, 60000);
  setInterval(() => { if (tab === "home" && !coinSel) { drawHomeChart(); } }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadData().then(() => { if (!coinSel) { render(); checkWins(); } }); });
})();
