import {
  analyticsFor,
  errorSource,
  groupStats,
  highestObservedGroups,
  inhibitionGrade,
  mean,
  quadraticFit,
  recordDiagnostics,
  recordInclusion,
  stddev,
  validRecords,
  yieldPercentFor,
} from "../domain/experiments/analytics.js";
import { DEMO_RECORDS } from "../shared/demo-records.js";


function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function nowIso() {
  return new Date().toISOString();
}
function isDemo(url) {
  return (
    url.searchParams.get("demo") === "1" ||
    url.searchParams.get("mode") === "demo"
  );
}
function recordsFor(url, records) {
  return isDemo(url) ? DEMO_RECORDS : records;
}
function petriSvg(zone = 12, opts = {}) {
  const grade = inhibitionGrade(zone);
  const control = opts.control ?? 0;
  const dots = Array.from({ length: 80 }, (_, i) => {
    const angle = (i * 137.5) % 360;
    const r = 8 + ((i * 19) % 88);
    const x = 120 + Math.cos((angle * Math.PI) / 180) * r;
    const y = 120 + Math.sin((angle * Math.PI) / 180) * r;
    const inZone = Math.hypot(x - 120, y - 120) < Number(zone) * 4.2;
    const op = inZone ? 0.18 : 0.72;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.2 + (i % 3) * 0.45).toFixed(1)}" fill="#10b981" opacity="${op}"/>`;
  }).join("");
  return `<svg class="petri-svg" viewBox="0 0 240 240" role="img" aria-label="虚拟培养皿"><defs><radialGradient id="dish" cx="50%" cy="45%"><stop offset="0%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#dbeafe"/></radialGradient><filter id="soft"><feGaussianBlur stdDeviation="2"/></filter></defs><circle cx="120" cy="120" r="106" fill="url(#dish)" stroke="#94a3b8" stroke-width="2"/><circle cx="120" cy="120" r="96" fill="none" stroke="#e2e8f0" stroke-width="1"/>${dots}<circle cx="120" cy="120" r="${Math.max(2, Number(zone) * 4.2).toFixed(1)}" fill="#f97316" opacity=".18" filter="url(#soft)"/><circle cx="120" cy="120" r="${Math.max(2, Number(zone) * 4.2).toFixed(1)}" fill="none" stroke="${grade.color}" stroke-width="3" stroke-dasharray="6 5"/><line x1="${(120 - Number(zone) * 4.2).toFixed(1)}" y1="120" x2="${(120 + Number(zone) * 4.2).toFixed(1)}" y2="120" stroke="${grade.color}" stroke-width="2"/><text x="120" y="134" text-anchor="middle" font-size="13" fill="#0f172a" font-weight="700">${Number(zone).toFixed(1)} mm</text></svg>`;
}

function petriTwinSvg(zone = 12) {
  const grade = inhibitionGrade(zone);
  const draw = (cx, label, z, accent, seedOffset = 0) => {
    const dots = Array.from({ length: 72 }, (_, i) => {
      const angle = ((i + seedOffset) * 137.5) % 360;
      const r = 7 + (((i + seedOffset) * 23) % 74);
      const x = cx + Math.cos((angle * Math.PI) / 180) * r;
      const y = 132 + Math.sin((angle * Math.PI) / 180) * r;
      const inZ = Math.hypot(x - cx, y - 132) < Number(z) * 3.05;
      const density = z > 1 ? (inZ ? 0.14 : 0.68) : 0.78;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.1 + (i % 3) * 0.42).toFixed(1)}" fill="#10b981" opacity="${density}"/>`;
    }).join("");
    return `<g><circle cx="${cx}" cy="132" r="82" fill="url(#dishTwin)" stroke="#94a3b8" stroke-width="2"/><circle cx="${cx}" cy="132" r="73" fill="none" stroke="#e2e8f0"/><g>${dots}</g><circle cx="${cx}" cy="132" r="${Math.max(2, Number(z) * 3.05).toFixed(1)}" fill="${accent}" opacity=".18"/><circle cx="${cx}" cy="132" r="${Math.max(2, Number(z) * 3.05).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="7 5"><animate attributeName="stroke-dashoffset" values="0;24" dur="2.6s" repeatCount="indefinite"/></circle><line x1="${(cx - Number(z) * 3.05).toFixed(1)}" y1="132" x2="${(cx + Number(z) * 3.05).toFixed(1)}" y2="132" stroke="${accent}" stroke-width="2"/><text x="${cx}" y="236" text-anchor="middle" font-size="13" fill="#475569" font-weight="800">${label}</text><text x="${cx}" y="256" text-anchor="middle" font-size="12" fill="#64748b">${Number(z).toFixed(1)} mm</text></g>`;
  };
  return `<div class="digital-twin-card"><div class="digital-twin-head"><div><div class="kicker">Measurement Visualisation</div><h3>抑菌圈测量可视化</h3></div><strong style="color:${grade.color}">${grade.level}</strong></div><svg class="petri-twin-svg" viewBox="0 0 520 280" role="img" aria-label="精油组与空白对照组抑菌圈测量示意"><defs><radialGradient id="dishTwin" cx="50%" cy="45%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dbeafe"/></radialGradient></defs><rect width="520" height="280" rx="28" fill="#f8fafc"/><text x="260" y="32" text-anchor="middle" font-size="14" fill="#0f172a" font-weight="800">E. coli 抑菌圈测量示意</text>${draw(145, "空白对照组", 0, "#94a3b8", 0)}${draw(375, "精油乳液组", zone, grade.color, 9)}<path d="M260 74 V218" stroke="#e2e8f0" stroke-dasharray="6 8"/></svg><p class="small">${grade.note} 该图用于辅助测量和对照观察，不是自动图像识别，也不等同于临床药敏判定。</p></div>`;
}
function trendSvg(records, currentConc = 3, currentYield = null) {
  const stats = groupStats(records);
  const data = stats
    .map((s) => ({ x: s.conc, y: s.count ? s.meanYield : 0, n: s.count }))
    .filter((p) => p.n > 0);
  const best = highestObservedGroups(stats);
  const maxY = Math.max(2.2, ...data.map((d) => d.y)) * 1.12;
  const W = 640,
    H = 400,
    L = 92,
    R = 28,
    T = 56,
    B = 84;
  const PW = W - L - R,
    PH = H - T - B;
  const x = (v) => L + (v / 4) * PW;
  const y = (v) => T + PH - (v / maxY) * PH;
  const xTicks = [0, 1, 3, 4];
  const yTicks = [0, 0.6, 1.2, 1.8, 2.4].filter((v) => v <= maxY + 0.02);

  const gridX = xTicks
    .map(
      (v) =>
        `<line x1="${x(v).toFixed(1)}" y1="${T}" x2="${x(v).toFixed(1)}" y2="${H - B}" stroke="#f0f4fa" stroke-width="1"/>`,
    )
    .join("");
  const gridY = yTicks
    .map(
      (v) =>
        `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="#e7edf6" stroke-width="1"/>`,
    )
    .join("");
  const xLabels = xTicks
    .map(
      (v) =>
        `<text x="${x(v).toFixed(1)}" y="${H - B + 28}" text-anchor="middle" font-size="13" fill="#4f5f7a" font-family="Inter,sans-serif">${v}%</text>`,
    )
    .join("");
  const yLabels = yTicks
    .map(
      (v) =>
        `<text x="${L - 12}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7a93" font-family="Inter,sans-serif">${v.toFixed(1)}</text>`,
    )
    .join("");

  const axis = `
    <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#8ea0be" stroke-width="1.5"/>
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#8ea0be" stroke-width="1.5"/>
    <text x="${(L + PW / 2).toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="12" fill="#4f5f7a" font-family="Inter,sans-serif">NH₄Cl 浓度 (%)</text>
    <text x="26" y="${(T + PH / 2).toFixed(1)}" transform="rotate(-90 26 ${(T + PH / 2).toFixed(1)})" text-anchor="middle" font-size="12" fill="#4f5f7a" font-family="Inter,sans-serif">平均出油率 (%)</text>
  `;

  const linePath = data
    .map((d, i) => `${i ? "L" : "M"}${x(d.x).toFixed(1)} ${y(d.y).toFixed(1)}`)
    .join(" ");
  const line = linePath
    ? `<path d="${linePath}" fill="none" stroke="#e87c2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  const pointLayer = data
    .map((d) => {
      const isBest = best.some((group) => group.conc === d.x);
      return `<g>
      <circle cx="${x(d.x).toFixed(1)}" cy="${y(d.y).toFixed(1)}" r="6.8" fill="${isBest ? "#f97316" : "#4f7ee8"}" stroke="#fff" stroke-width="2.8"/>
      <text x="${x(d.x).toFixed(1)}" y="${(y(d.y) - 13).toFixed(1)}" text-anchor="middle" font-size="11.2" font-weight="800" fill="${isBest ? "#b45309" : "#2f43b7"}" font-family="Inter,sans-serif" paint-order="stroke" stroke="#fff" stroke-width="4">${d.y.toFixed(2)}%</text>
      <text x="${x(d.x).toFixed(1)}" y="${(y(d.y) + 18).toFixed(1)}" text-anchor="middle" font-size="9.8" fill="#6a7aa0" font-family="Inter,sans-serif">n=${d.n}</text>
    </g>`;
    })
    .join("");

  const legend = `
    <g transform="translate(${W - 214},26)">
      <rect width="186" height="24" rx="8" fill="#f8fbff" stroke="#e6edf7"/>
      <line x1="12" y1="12" x2="34" y2="12" stroke="#e87c2e" stroke-width="3"/>
      <circle cx="23" cy="12" r="4.5" fill="#4f7ee8" stroke="#fff" stroke-width="1.8"/>
      <text x="42" y="16" font-size="10.5" fill="#4f5f7a" font-family="Inter,sans-serif">均值趋势线（Origin 风格）</text>
    </g>`;

  const curMarker =
    Number.isFinite(currentYield) && xTicks.includes(+currentConc)
      ? `<polygon points="${x(currentConc).toFixed(1)},${(H - B + 8).toFixed(1)} ${(x(currentConc) - 5).toFixed(1)},${(H - B + 18).toFixed(1)} ${(x(currentConc) + 5).toFixed(1)},${(H - B + 18).toFixed(1)}" fill="#2563eb"/>`
      : "";

  const note = best.length
    ? `${best.map((group) => `${group.conc}%`).join("、")} NH₄Cl 组观测均值${best.length > 1 ? "并列最高" : "最高"}；不代表最优条件。`
    : "暂无可比较数据；空组不代表零得率。";
  return `<svg id="live-trend-svg" class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="NH₄Cl 浓度与平均出油率趋势图" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="22" fill="#ffffff" stroke="#e6edf7" stroke-width="1.2"/>
    <text x="${L}" y="30" font-size="18" fill="#101b33" font-weight="900" font-family="Inter,sans-serif">NH₄Cl 浓度—平均出油率趋势</text>
    <text x="${L}" y="50" font-size="12" fill="${best.length ? "#b45309" : "#64748b"}" font-family="Inter,sans-serif" font-weight="700">${note}</text>
    ${legend}
    ${gridX}
    ${gridY}
    ${axis}
    ${line}
    ${pointLayer}
    ${xLabels}
    ${yLabels}
    ${curMarker}
    <text x="${W - R}" y="${H - 12}" text-anchor="end" font-size="10" fill="#b2bfd3" font-family="Inter,sans-serif">Origin 风格：标准坐标系呈现</text>
  </svg>`;
}

function decisionSummaryCard(records = DEMO_RECORDS) {
  const stats = groupStats(records);
  const best = highestObservedGroups(stats);
  const three = stats.find((s) => s.conc === 3) || {
    meanYield: 0,
    count: 0,
    phase: 0,
    meanZone: 0,
  };
  const four = stats.find((s) => s.conc === 4) || {
    meanYield: 0,
    count: 0,
    phase: 0,
    meanZone: 0,
  };
  const omitted = records.filter((record) => !recordInclusion(record, records).included).length;
  const conclusion = best.length
    ? `${best.map((group) => `${group.conc}%`).join("、")} NH₄Cl 组的观测均值${best.length > 1 ? "并列最高" : "最高"}。这只比较已有观测，不确定最优条件。`
    : "暂无可比较数据。教师排除或尚待复核的记录不进入此比较。";
  const rows = stats
    .map(
      (s) =>
        '<div class="decision-row ' +
        (best.some((group) => group.conc === s.conc) ? "is-best" : "") +
        '"><span>' +
        s.conc +
        "% NH₄Cl</span><b>" +
        (s.count ? s.meanYield.toFixed(2) + "%" : "—") +
        "</b><em>n=" +
        s.count +
        "</em></div>",
    )
    .join("");
  return (
    '<div class="decision-card"><div class="kicker">Exploratory Decision Support</div><h3>有效数据描述性比较</h3><p>' +
    conclusion +
    '</p><div class="decision-rows">' +
    rows +
    '</div><div class="decision-metrics"><div><small>3% 组均值</small><strong>' +
    (three.count ? three.meanYield.toFixed(2) + "%" : "—") +
    "</strong></div><div><small>4% 组均值</small><strong>" +
    (four.count ? four.meanYield.toFixed(2) + "%" : "—") +
    "</strong></div><div><small>未参与比较</small><strong>" +
    omitted +
    '</strong></div></div><p class="small">教师已纳入的记录参与比较，即使原记录带有异常标记；教师已排除或仍需复核的记录不参与。其余通过规则检查的记录也参与此描述性比较。封存科学分析另需教师明确纳入。</p></div>'
  );
}

function limoneneStructureSvg() {
  return `<svg class="limonene-structure-svg" viewBox="0 0 640 430" role="img" aria-label="D-柠檬烯标准结构示意图"><defs><radialGradient id="limBg" cx="50%" cy="45%"><stop offset="0%" stop-color="#172554"/><stop offset="100%" stop-color="#020617"/></radialGradient><filter id="limGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><marker id="wedge" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 Z" fill="#f97316" opacity=".88"/></marker></defs><rect width="640" height="430" rx="30" fill="url(#limBg)"/><circle cx="520" cy="70" r="150" fill="#2563eb" opacity=".13"/><circle cx="130" cy="360" r="170" fill="#f97316" opacity=".10"/><g transform="translate(320 222) scale(1.18)" stroke="#93c5fd" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#limGlow)"><path d="M-94,-60 L0,-108 L94,-60 L94,54 L0,108 L-94,54 Z"/><path d="M-82,-48 L2,-91" stroke="#f97316" stroke-width="5"/><path d="M-94,-60 L-154,-104"/><path d="M94,54 L166,24" marker-end="url(#wedge)"/><path d="M166,24 L232,-22"/><path d="M166,24 L212,88"/><path d="M232,-22 L276,-62" stroke="#f97316" stroke-width="5"/><path d="M238,-8 L282,-48" stroke="#f97316" stroke-width="5"/></g><g font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif"><text x="34" y="42" fill="#e2e8f0" font-size="18" font-weight="900">D-Limonene / D-柠檬烯</text><text x="34" y="70" fill="#94a3b8" font-size="13">C₁₀H₁₆ · (R)-1-methyl-4-(prop-1-en-2-yl)cyclohex-1-ene</text><text x="112" y="94" fill="#fed7aa" font-size="12" font-weight="800">环内 C=C</text><text x="118" y="126" fill="#cbd5e1" font-size="12">甲基</text><text x="468" y="190" fill="#cbd5e1" font-size="12">异丙烯基</text><text x="448" y="338" fill="#94a3b8" font-size="12">* 手性中心示意</text><rect x="34" y="342" width="572" height="54" rx="16" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.08)"/><text x="54" y="366" fill="#e2e8f0" font-size="13" font-weight="800">结构说明</text><text x="54" y="386" fill="#94a3b8" font-size="12">此图按柠檬烯标准拓扑绘制：一个环己烯骨架、一个甲基和一个异丙烯基；GLB 文件保留为三维模型素材。</text></g></svg>`;
}
function moleculeSvg() { return `<div class="card"><h3>Molecular illustration</h3><p>This source snapshot excludes the legacy binary model. The original code-drawn topology remains a teaching illustration.</p>${limoneneStructureSvg()}</div>`; }
function battleSvg(_zone = 13.5) {
  return `<div class="isim" id="isim"><div class="isim-header"><div><div class="kicker">抑菌圈观察动态示意</div><strong>E. coli · 空白对照 vs 精油乳液组</strong></div><span id="isim-grade-badge" style="font-weight:800;font-size:13px;color:#10b981">中等抑制</span></div><canvas id="isim-canvas" class="isim-canvas" aria-label="抑菌圈实时观察对照示意图"></canvas><div class="isim-stats"><div><small>抑菌圈直径</small><b id="isim-diam">13.5 mm</b></div><div><small>抑制等级</small><b id="isim-level">中等抑制</b></div><div><small>边界</small><b id="isim-edge">清晰</b></div></div><p class="small">输入直径后培养皿实时更新。左：空白对照（无处理）；右：精油乳液组；不等同于临床药敏判定。</p></div>`;
}
function _battleSvgOld(zone = 13.5) {
  const z = Math.max(0, Number(zone) || 0);
  const r = Math.max(18, Math.min(68, z * 3.2));
  const colonies = Array.from({ length: 56 }, (_, i) => {
    const angle = (i * 137.5) % 360;
    const dist = 22 + ((i * 31) % 108);
    const x = 150 + Math.cos((angle * Math.PI) / 180) * dist;
    const y = 108 + Math.sin((angle * Math.PI) / 180) * dist;
    const clear = Math.hypot(x - 150, y - 108) < r;
    const op = clear ? 0.08 : 0.62;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.6 + (i % 4) * 0.35).toFixed(1)}" fill="#6b7280" opacity="${op}"/>`;
  }).join("");
  return `<svg class="battle-svg inhibition-plate" viewBox="0 0 300 238" role="img" aria-label="抑菌圈观察示意图"><defs><radialGradient id="agarGrad" cx="50%" cy="48%"><stop offset="0%" stop-color="#fffaf0"/><stop offset="68%" stop-color="#f3ead5"/><stop offset="100%" stop-color="#e8dcc8"/></radialGradient></defs><rect width="300" height="238" rx="26" fill="#ffffff"/><text x="22" y="28" fill="#0f172a" font-size="13" font-weight="900">抑菌圈观察示意</text><text x="22" y="48" fill="#64748b" font-size="10">按培养皿观察结果表达透明抑菌区，不表现“粒子攻击”过程</text><circle cx="150" cy="112" r="86" fill="url(#agarGrad)" stroke="#cbd5e1" stroke-width="2"/><circle cx="150" cy="112" r="78" fill="none" stroke="#e2e8f0"/><g>${colonies}</g><circle cx="150" cy="112" r="${r.toFixed(1)}" fill="#ffffff" opacity=".72" stroke="#f97316" stroke-width="3"/><circle cx="150" cy="112" r="8" fill="#f97316" opacity=".82"/><line x1="${(150 - r).toFixed(1)}" y1="112" x2="${(150 + r).toFixed(1)}" y2="112" stroke="#f97316" stroke-width="2"/><text x="150" y="210" text-anchor="middle" fill="#334155" font-size="13" font-weight="900">抑菌圈直径 ${z.toFixed(1)} mm</text><text x="150" y="226" text-anchor="middle" fill="#64748b" font-size="10">课堂示意：用于读数、对照与重复实验讨论</text></svg>`;
}

function extractionSimulator() {
  return `<div class="dsim" id="dsim"><div class="dsim-header"><div><div class="kicker">Clevenger 装置动态模拟</div><strong>水蒸气蒸馏 · 冷凝 · Clevenger 分水器收集精油</strong><small>拖动时间轴或点击播放，观察蒸发冷凝、油水分层、多次放水与精油积累</small></div><span id="dsim-phase" style="font-weight:800;font-size:13px;color:#f59e0b">预热中</span></div><canvas id="dsim-canvas" class="dsim-canvas" aria-label="Clevenger水蒸气蒸馏装置动态模拟"></canvas><div class="dsim-controls"><label>NH₄Cl <select id="dsim-conc"><option value="0">0%</option><option value="1">1%</option><option value="3" selected>3%</option><option value="4">4%</option></select></label><input id="dsim-slider" type="range" min="0" max="60" value="0"/><button id="dsim-play" class="dsim-play-btn" type="button">▶ 播放</button><span id="dsim-time" style="font-weight:800;font-size:14px;min-width:48px;text-align:right">0 min</span></div><div class="dsim-stats"><div><small>当前阶段</small><b id="dsim-stage">预热中</b></div><div><small>精油积累</small><b id="dsim-yield">0.00%</b></div><div><small>NH₄Cl效果</small><b id="dsim-effect">—</b></div></div><p class="small">Clevenger 装置：烧瓶初始水量最多，水蒸气与精油一同蒸发并冷凝进入分水器；油水分层后，旋开活塞将水相多次放出再旋关，精油在分水器上层积累，实验结束后分离收集。模拟仅用于课堂教学。</p></div>`;
}

function layout(title, body, opts = {}) {
  const session = opts.session;
  const userChip = session
    ? `<span class="user-chip">${esc(session.name)} · ${esc(session.role)}</span><a href="${session.role === "student" ? "/submit" : session.role === "teacher" ? "/admin" : "/admin/console"}">工作台</a><a href="/logout">退出</a>`
    : `<a class="login-pill student" href="/student/login">学生登录</a><a class="login-pill teacher" href="/teacher/login">教师登录</a><a class="login-pill admin" href="/admin/login">管理员登录</a>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(title)}</title><link rel="stylesheet" href="/static/styles.css?v=v213-measure"/></head><body class="page-enter"><header class="nav-shell"><div class="wrap nav-inner"><a class="brand" href="/"><div class="logo">C</div><div><div class="brand-title">柑橘精油综合探究平台</div><div class="brand-sub">高中自然科学 · 化学实验 · 抑菌观察 · AI 反馈</div></div></a><nav class="nav-actions"><a href="/engineering">Engineering</a><a href="/theme">主题页</a><a class="nav-primary" href="/demo">立即体验</a><a href="/practice">习题</a><a href="/llm-teaching">AI 助教</a><a href="/resources">资源库</a><a href="/curriculum">课标映射</a>${userChip}</nav></div></header><main class="page-main">${body}</main><footer class="footer"><div class="wrap">柑橘精油综合探究课程资源与数据分析平台</div></footer><script src="/static/client.js?v=beta18-outbox" defer></script></body></html>`;
}
function previewWindow(records = DEMO_RECORDS) { return `<div class="preview-shell"><div class="preview-card"><div class="kicker">Synthetic classroom example</div>${trendSvg(records)}<p class="small">Code-drawn illustration of the separately labeled legacy synthetic classroom fixture. The scientific fixture and its assumptions are described in the engineering notebook.</p><a href="/walkthrough">Trace the scientific fixture →</a></div></div>`; }
function homePage(session, records = DEMO_RECORDS, demoCredentialsEnabled = false) {
  const studentLoginNote = demoCredentialsEnabled
    ? "隔离演示账号 student001 / 123456。"
    : "使用管理员分配的学生账号登录。";
  const teacherLoginNote = demoCredentialsEnabled
    ? "隔离演示账号 teacher001 / 123456。"
    : "使用管理员分配的教师账号登录。";
  const adminLoginNote = demoCredentialsEnabled
    ? "隔离演示账号 admin / 123456。"
    : "使用已安全配置的管理员账号登录。";
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-inner"><div><div class="eyebrow"><span class="dot"></span>Reproducible Scientific Data Platform · 高中自然科学综合探究</div><h1>EchoClass 科学数据平台</h1><p class="lead">面向化学实验课堂的数据采集、规则诊断、教师复核与可复现分析平台。当前版本保留教学工作流，并明确区分演示数据、确定性规则和 AI 解释。</p><div class="tags"><span class="tag">NH₄Cl 盐析分离</span><span class="tag">抑菌圈测量可视化</span><span class="tag">数据质量助手</span></div></div>${previewWindow(records)}</div></section><section class="section wrap"><div class="section-head"><div class="kicker">Role System</div><h2>体验模式、学生、教师与管理员各自有明确权限。</h2><p>右上角入口可直接进入；体验模式用于展示，不读取课堂数据库；登录用户进入对应班级或管理范围。</p></div><div class="grid-4"><a class="card" href="/demo"><div class="icon blue">体验</div><h3>在线体验</h3><p>无需账号进入体验流程，体验学生端或教师端流程，不影响课堂数据。</p></a><a class="card" href="/student/login"><div class="icon orange">S</div><h3>学生登录</h3><p>${esc(studentLoginNote)}</p></a><a class="card" href="/teacher/login"><div class="icon green">T</div><h3>教师登录</h3><p>${esc(teacherLoginNote)}</p></a><a class="card" href="/admin/login"><div class="icon purple">A</div><h3>管理员登录</h3><p>${esc(adminLoginNote)}</p></a></div></section>`;
  return layout("柑橘精油综合探究平台", body, { session });
}

function themePage(session, records = DEMO_RECORDS) {
  const data = records && records.length ? records : DEMO_RECORDS;
  const summaryRows = [0, 1, 3, 4]
    .map((conc) => {
      const rows = validRecords(data).filter(
        (record) => Number(record.nh4cl_concentration) === conc,
      );
      return `<tr><td>${conc}%</td><td>${rows.length}</td><td>${rows.length ? mean(rows.map((row) => Number(row.oil_mass))).toFixed(4) + " g" : "—"}</td><td>${rows.length ? mean(rows.map(yieldPercentFor)).toFixed(2) + "%" : "—"}</td></tr>`;
    })
    .join("");
  const materialLinks = `<div class="card"><div class="kicker">Synthetic materials</div><h3>Scientific source and sample data</h3><p>The portfolio snapshot contains anonymous synthetic records and original code-generated illustrations.</p><a class="btn btn-secondary" href="/walkthrough">Trace the scientific fixture</a><a class="btn btn-secondary" href="/static/materials/nh4cl-yield-sample.csv" download>Download the classroom sample CSV</a></div>`;
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-inner"><div><div class="eyebrow"><span class="dot"></span>Theme Overview</div><h1 class="page-title theme-title">柑橘精油综合探究主题页</h1><p class="lead">以NH₄Cl 盐辅助水蒸馏数据、红外图谱、抑菌观察图像与柠檬烯模型为支撑，形成“提取—分离—表征—抑菌—反馈”的高中自然科学综合探究主题。</p><div class="page-actions"><a class="btn btn-primary" href="/">返回首页</a><a class="btn btn-secondary" href="/demo">立即体验</a><a class="btn btn-secondary" href="/resources">查看资源库</a></div></div><div>${previewWindow(records)}</div></div></section>
  <section class="section wrap"><div class="section-head"><div class="kicker">Real Materials</div><h2>课程材料已形成可展示资源体系。</h2><p>红外图谱、抑菌观察图、原始数据表与柠檬烯三维模型统一接入资源库，支撑课堂展示、学生探究与教师复盘。</p></div>${materialLinks}</section>
  <section class="section wrap"><div class="section-head"><div class="kicker">Demonstration Data</div><h2>NH₄Cl 演示数据用于验证工作流。</h2><p>当前发布包仅包含标记为 synthetic_demo 的匿名示例记录；下表均值为页面加载时从当前数据计算，不是预填统计。</p></div><div class="grid-2"><div class="card">${trendSvg(data)}</div><div class="card"><h3>数据均值摘要</h3><table><thead><tr><th>NH₄Cl 浓度</th><th>n</th><th>平均产物质量</th><th>平均出油率</th></tr></thead><tbody>${summaryRows}</tbody></table><p>这些小样本演示数据只能用于描述性比较，不支持确定最优条件。</p></div></div></section>
  <section class="section wrap"><div class="section-head"><div class="kicker">Science Visualizations</div><h2>动态可视化围绕“过程、结构、抑菌、决策”展开。</h2><p>提取曲线、分子投影、抑菌热力图和描述性比较卡均作为教学示意，不构成真实机理证明或工艺最优性结论。</p></div><div class="grid-2"><div class="card">${extractionSimulator()}</div><div class="card dark-card">${battleSvg(13.5)}</div><div class="card dark-card" style="grid-column:1/-1">${decisionSummaryCard(data)}</div></div></section>
  <section class="section wrap"><div class="section-head"><div class="kicker">Curriculum Logic</div><h2>高中主线与大学衔接分层呈现。</h2></div><div class="grid-2"><div class="card"><h3>高中主线</h3><p>水蒸气蒸馏、NH₄Cl 电解质与盐析、控制变量、数据处理、对照实验、抑菌圈观察。</p></div><div class="card"><h3>大中衔接</h3><p>GC–MS 成分分析、IR / ATR-FTIR 特征峰、D-柠檬烯分子模型。这部分作为拓展，不替代高中课堂主线。</p></div></div></section>`;
  return layout("主题总览页", body, { session });
}

function demoPage(session) {
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>Course Preview</div><h1 class="page-title">无需登录，进入在线体验。</h1><p class="lead">快速体验学生记录、教师看板、班级趋势和 AI 反馈的完整探究流程。</p><div class="page-actions"><a class="btn btn-primary" href="/submit?demo=1">体验学生端</a><a class="btn btn-secondary" href="/admin?demo=1">体验教师端</a></div></div></section><section class="section wrap"><div class="flow-shell"><div class="flow-tabs"><button class="flow-tab active" onclick="showFlow(0)">1 微课学习</button><button class="flow-tab" onclick="showFlow(1)">2 NH₄Cl 探究</button><button class="flow-tab" onclick="showFlow(2)">3 数据分析</button><button class="flow-tab" onclick="showFlow(3)">4 抑菌观察</button><button class="flow-tab" onclick="showFlow(4)">5 AI 反馈</button></div><div class="flow-content"><div><div id="flow-kicker" class="kicker">Step 01</div><h3 id="flow-title" class="flow-title">微课学习：水蒸气蒸馏与盐析分离</h3><p id="flow-desc">用短视频解释柑橘精油的挥发性、水蒸气蒸馏思路，以及 NH₄Cl 盐析辅助油水分层的观察要点。</p></div><div class="flow-visual" id="flow-visual"><div class="flow-mini-card"><strong>课程片段</strong><div>《柑橘精油的提取：水蒸气蒸馏与 NH₄Cl 盐析分离》</div></div><div class="flow-mini-card"><strong>知识点</strong><div>混合物分离、电解质、盐析、控制变量</div></div></div></div></div></section><section class="section wrap"><div class="grid-3"><div class="card">${extractionSimulator()}</div><div class="card dark-card">${moleculeSvg()}</div><div class="card dark-card">${battleSvg(13.5)}</div></div></section>`;
  return layout("在线体验", body, { session, active: "demo" });
}
function loginPage(role, session, demoCredentialsEnabled = false) {
  const title =
    role === "student"
      ? "学生登录"
      : role === "teacher"
        ? "教师登录"
        : "管理员登录";
  const demo =
    role === "student"
      ? "student001"
      : role === "teacher"
        ? "teacher001"
        : "admin";
  const target =
    role === "student" ? "学生" : role === "teacher" ? "教师" : "管理员";
  const credentialNote = demoCredentialsEnabled
    ? `当前启用了隔离演示账号：${demo} / 123456。`
    : "请输入管理员分配的账号和密码；当前未启用固定演示凭据。";
  const usernameValue = demoCredentialsEnabled ? demo : "";
  const passwordValue = demoCredentialsEnabled ? "123456" : "";
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap auth-grid"><div><div class="eyebrow"><span class="dot"></span>${esc(title)}</div><h1 class="page-title">进入${esc(target)}工作区。</h1><p class="lead">${esc(credentialNote)}</p></div><form class="auth-card" id="auth-form" method="POST" action="/api/auth/login" autocomplete="on"><input type="hidden" name="role" value="${role}"/><label for="login-username">账号</label><input id="login-username" name="username" value="${esc(usernameValue)}" autocomplete="username" required/><label for="login-password">密码</label><input id="login-password" name="password" type="password" value="${esc(passwordValue)}" autocomplete="current-password" required/><button class="submit-button" type="submit">登录</button><a class="btn btn-secondary" href="/demo">不登录，进入在线体验</a></form></div></section>`;
  return layout(title, body, { session });
}
function changePasswordPanel() {
  return `<div class="card change-password-card">
    <div class="kicker">Account Security</div>
    <h2>首次登录建议修改密码</h2>
    <p class="small">当前账号仍在使用临时密码。请立即修改并妥善保管新密码。</p>
    <form id="change-password-form" class="form-grid" autocomplete="off">
      <div class="input-group"><label>当前密码</label><input name="oldPassword" type="password" autocomplete="current-password" required></div>
      <div class="input-group"><label>新密码</label><input name="newPassword" type="password" placeholder="至少 6 位" autocomplete="new-password" required></div>
      <div class="input-group"><label>确认新密码</label><input name="confirmPassword" type="password" placeholder="再次输入新密码" autocomplete="new-password" required></div>
      <div class="input-group"><label>&nbsp;</label><button class="btn btn-primary" type="submit">保存新密码</button></div>
    </form>
    <p id="password-result" class="small strong"></p>
  </div>`;
}

function studentPage(records, session, demo = false) {
  const data = recordsFor(
    { searchParams: new URLSearchParams(demo ? "demo=1" : "") },
    records,
  );
  const current =
    session?.role === "student"
      ? session
      : { name: "演示学生 03", class_name: "演示化学班", group_name: "演示 3 组" };
  const trend = trendSvg(data, 3, 1.46);
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>${demo ? "Student Workspace" : "Student Workspace"}</div><h1 class="page-title">学生探究工作台</h1><p class="lead">记录提取条件、上传抑菌观察图像、查看班级趋势，并由 数据质量助手提供规则诊断与可复核提示。</p></div></section><div class="wrap app-grid"><form id="student-form" class="form-card" data-demo="${demo ? "1" : "0"}" data-submission-context="${!demo && session ? esc(JSON.stringify({user_id: session.id, role: session.role, class_name: session.class_name, group_name: session.group_name || "", name: session.name})) : ""}"><input type="hidden" name="mode" value="${demo ? "demo" : "real"}"/><div class="kicker">Experiment Record</div><h2>填写本组探究数据</h2><div id="sync-status" class="offline-status">网络状态检测中……</div><div class="form-section"><h3>身份信息</h3><div class="form-grid"><div class="input-group"><label>姓名</label><input name="student_name" value="${esc(current.name || "演示学生 03")}" required/></div><div class="input-group"><label>班级</label><input name="class_name" value="${esc(current.class_name || "演示化学班")}"/></div><div class="input-group"><label>小组</label><input name="group_name" value="${esc(current.group_name || "演示 3 组")}"/></div><div class="input-group"><label>实验日期</label><input name="experiment_date" type="date"/></div></div></div><div class="form-section"><h3>提取条件</h3><div class="form-grid"><div class="input-group"><label>NH₄Cl 质量分数</label><select id="nh4cl_concentration" name="nh4cl_concentration"><option value="0">0% 对照组</option><option value="1">1% 低盐组</option><option value="3" selected>3% 重点观察组</option><option value="4">4% 高盐比较组</option></select></div><div class="input-group"><label>蒸馏时间 / min</label><input name="distillation_time" type="number" value="45"/></div><div class="input-group"><label>橘皮质量 / g</label><input id="peel_mass" name="peel_mass" type="number" step="0.1" value="50.0" required/></div><div class="input-group"><label>精油质量 / g</label><input id="oil_mass" name="oil_mass" type="number" step="0.01" value="0.73" required/></div><div class="input-group"><label>分层清晰度</label><select id="phase_clarity_score" name="phase_clarity_score"><option value="1">1 很不清晰</option><option value="2">2 较弱</option><option value="3">3 一般</option><option value="4">4 较清晰</option><option value="5" selected>5 很清晰</option></select></div><div class="input-group"><label>乳化情况</label><select id="emulsification_level" name="emulsification_level"><option>分层清晰</option><option>轻微乳化</option><option>明显乳化</option></select></div></div></div><div class="form-section"><h3>抑菌观察与本地辅助测量</h3><div class="form-grid"><div class="input-group"><label>选择本地培养皿图像（≤10MB）</label><input id="plate_image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"/><small class="small">图像只在本机浏览器中用于手动框选测量，不上传或写入数据库。</small></div><div class="input-group"><label>培养皿规格 / mm</label><input id="petri_diameter_mm" name="petri_diameter_mm" type="number" step="0.1" value="90"/><small class="small">常用规格：60 / 90 / 100 mm，可自定义。</small></div><div class="input-group"><label>精油乳液浓度 / %</label><input name="emulsion_concentration" type="number" value="30"/></div><div class="input-group"><label>观察组别</label><select name="ecoli_observation_group"><option>空白对照组</option><option>Tween 80 对照组</option><option selected>高浓度精油乳液组</option></select></div><div class="input-group"><label>抑菌圈直径 / mm</label><input id="inhibition_zone_diameter" name="inhibition_zone_diameter" type="number" step="0.1" value="13.5"/></div><div class="input-group"><label>菌落生长评分</label><select name="colony_growth_score"><option value="1">1 明显受抑</option><option value="2" selected>2 较明显受抑</option><option value="3">3 一般</option><option value="4">4 生长较多</option><option value="5">5 接近对照</option></select></div><div class="input-group"><label>主要误差来源</label><select name="error_source"><option>无明显异常</option><option>乳化严重</option><option>称量误差</option><option>混入水相</option><option>分层不清</option><option>污染标记</option><option>边缘模糊</option></select></div></div><label class="checkbox"><input name="异常标记" type="checkbox"/> 标记为疑似污染或异常观察</label><div class="input-group"><label>实验备注</label><textarea name="note">油水界面较清楚，抑菌圈边缘较明显。</textarea></div></div><button class="submit-button" type="submit">${demo ? "体验提交" : "提交到课堂数据库"}</button><p id="submit-result" class="small strong"></p></form><aside class="side-panel"><div class="diagnosis"><div class="kicker">Live Audit</div><h2>数据质量助手</h2><div id="yield-text" class="big-number">--.--%</div><p>当前精油得率</p><div class="field-grid"><div class="field-box"><small>抑菌圈直径</small><strong id="zone-text">-- mm</strong></div><div class="field-box"><small>数据状态</small><strong id="data-status">待提交</strong></div><div class="field-box"><small>抑菌分级</small><strong id="grade-text">--</strong></div><div class="field-box"><small>模式</small><strong>${demo ? "体验模式" : "课堂数据库"}</strong></div></div><p id="diagnosis-text">输入数据后，系统会主动识别逻辑冲突。</p></div><div class="image-preview" id="image-preview"><span>本地选择的培养皿图像会显示在这里</span></div><div id="petri-preview">${petriTwinSvg(13.5)}</div><div class="visual-card">${trend}</div><div class="visual-card dark">${decisionSummaryCard(data)}</div></aside></div><section class="section wrap"><div class="grid-2"><div class="card">${extractionSimulator()}</div><div class="card dark-card">${battleSvg(13.5)}</div></div></section><section class="section wrap"><div class="practice-entry-banner"><div class="practice-entry-content"><div class="kicker">Practice &amp; Review</div><h2>知识点习题练习</h2><p>完成实验记录后，前往习题页面完成本节内容练习。系统根据你的正确率提示不同难度的题目，你的作答记录将关联至账号「${esc(session?.name || current.name)}」，供教师查阅。</p>${demo ? `<p class="small" style="color:#f97316">体验模式：请先<a href="/student/login">登录</a>再作答，以便关联学生身份。</p>` : `<a class="btn btn-primary" href="/practice">进入习题练习 →</a>`}</div><div class="practice-entry-stats"><span class="practice-stat-item"><strong>30</strong><small>题目总量</small></span><span class="practice-stat-item"><strong>3</strong><small>难度层级</small></span><span class="practice-stat-item"><strong>AI</strong><small>智能推送</small></span></div></div></section><section class="section wrap" style="padding-top:0"><div class="practice-entry-banner" style="background:linear-gradient(135deg,#f5f3ff 0%,#eff6ff 100%);border-color:#c4b5fd"><div class="practice-entry-content"><div class="kicker">AI Teaching Assistant</div><h2>AI 教学辅助</h2><p>课前预习知识要点、课后答疑解惑、拓展探究思路。AI 实时回答化学实验、生物探究相关疑问，帮助你高效学习。</p><a class="btn btn-primary" href="/llm-teaching" style="background:#6366f1">进入 AI 助教 →</a></div><div class="practice-entry-stats"><span class="practice-stat-item" style="background:rgba(139,92,246,.08)"><strong>3</strong><small>学习场景</small></span><span class="practice-stat-item" style="background:rgba(139,92,246,.08)"><strong>AI</strong><small>实时对话</small></span></div></div></section>${session?.defaultPassword && !demo ? `<section class="section wrap">${changePasswordPanel()}</section>` : ""}`;
  const trustedMeasurementBody = body.replace(
    '<input type="hidden" name="mode"',
    '<input type="hidden" name="measurement_method" value="manual_direct"/>' +
      '<input type="hidden" name="measurement_image_state" value="manual_only"/>' +
      '<input type="hidden" name="mode"',
  );
  const evidenceRows = !demo && session?.role === "student"
    ? data.filter((record) => record.created_by_user_id === session.id && record.status !== "deleted")
      .map((record) => `<li><a href="/evidence?record_id=${encodeURIComponent(record.id)}">${esc(record.experiment_date || "实验记录")} · ${esc(record.group_name || "本组")} · ${esc(record.id)} · 查看 / 添加附件</a></li>`).join("")
    : "";
  const evidenceSection = !demo && session?.role === "student"
    ? `<section class="section wrap"><div class="card"><h2>我的实验附件</h2><p>提交记录后，可在这里附上 PNG、JPEG 或 PDF。附件从实际上传成功时开始保管；后来补交不能证明此前浏览器测量使用了该文件。</p>${evidenceRows ? `<ul>${evidenceRows}</ul>` : "<p>暂无本人已提交记录；提交后刷新本页即可添加附件。</p>"}</div></section>`
    : "";
  return layout("学生探究工作台", trustedMeasurementBody + evidenceSection, { session });
}
function teacherPage(records, session, demo = false) {
  const data = demo ? DEMO_RECORDS : records;
  const analytics = analyticsFor(data);
  const stats = analytics.stats;
  const maxYield = Math.max(1.6, ...stats.map((s) => s.meanYield));
  const bars = stats
    .map(
      (s) =>
        `<div class="bar-ui" style="height:${Math.max(8, (s.meanYield / maxYield) * 90)}%"><b>${s.count ? s.meanYield.toFixed(2) + "%" : "—"}</b><span>${s.conc}%</span></div>`,
    )
    .join("");
  const seen = new Map();
  const duplicateKeys = new Set();
  for (const r of data) {
    const key = `${r.student_name || ""}|${r.class_name || ""}|${r.group_name || ""}|${Number(r.nh4cl_concentration)}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) duplicateKeys.add(k);
  const rows =
    data
      .slice(0, 80)
      .map((r) => {
        const inc = recordInclusion(r, data);
        const d = recordDiagnostics(r, data);
        const key = `${r.student_name || ""}|${r.class_name || ""}|${r.group_name || ""}|${Number(r.nh4cl_concentration)}`;
        const dup = duplicateKeys.has(key);
        const reason = dup
          ? "重复提交：同一学生/小组/浓度出现多条记录，建议仅保留最新或人工确认。"
          : inc.reasons[0] || d.reasons[0] || r.note || "—";
        const cls =
          inc.status === "review" || dup
            ? "review-row"
            : inc.status === "excluded"
              ? "excluded-row"
              : "";
        const badge = dup && inc.status === "normal" ? "需复核" : inc.label;
        const actions = demo
          ? '<span class="small">演示数据不可操作</span>'
          : `<div class="record-actions"><a class="mini-btn" href="/evidence?record_id=${encodeURIComponent(r.id)}">附件</a><button class="mini-btn" data-record-action="include" data-record-id="${esc(r.id)}" type="button">纳入</button><button class="mini-btn warn" data-record-action="exclude" data-record-id="${esc(r.id)}" type="button">排除</button><button class="mini-btn danger" data-record-action="delete" data-record-id="${esc(r.id)}" type="button">删除</button></div>`;
        return `<tr class="${cls}" data-record-row data-review-state="${esc(inc.status)}"><td>${esc(r.student_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.group_name)}</td><td>${r.nh4cl_concentration}%</td><td>${yieldPercentFor(r).toFixed(2)}%</td><td>${Number(r.inhibition_zone_diameter).toFixed(1)} mm</td><td><span class="state-badge state-${esc(inc.status)}">${esc(badge)}</span>${dup ? '<span class="state-badge state-review">重复</span>' : ""}</td><td>${esc(reason)}</td><td>${actions}</td></tr>`;
      })
      .join("") || '<tr><td colspan="9">暂无学生提交数据</td></tr>';
  const hot = analytics.hotwords
    .map(([w, n]) => `<span style="font-size:${12 + n * 2}px">${esc(w)}</span>`)
    .join("");
  const heat = Object.entries(analytics.errorCounts)
    .filter(([k]) => k !== "无明显异常")
    .map(
      ([k, v]) =>
        `<div class="heat-row"><span>${esc(k)}</span><b style="width:${Math.min(100, v * 18)}%"></b><em>${v}</em></div>`,
    )
    .join("");
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>${demo ? "Demo Teacher Dashboard" : "Teacher Dashboard"}</div><h1 class="page-title">教师数据工作台</h1><p class="lead">从班级趋势、异常数据、误差热力图和学生问题热点中形成课堂二次教学依据。系统将“需复核/已排除”记录移出描述性统计，教师仍需复核并记录决定。</p><div class="page-actions"><a class="btn btn-primary" href="/report${demo ? "?demo=1" : ""}">查看报告</a><a class="btn btn-secondary" href="/admin/users">账号管理</a></div></div></section><section class="section wrap"><div class="grid-4"><div class="card"><div class="kicker">提交记录</div><h3>${data.length}</h3><p>${demo ? "演示数据" : "课堂数据"}</p></div><div class="card"><div class="kicker">有效数据</div><h3>${analytics.validCount}</h3><p>参与描述性统计</p></div><div class="card"><div class="kicker">待复核</div><h3>${analytics.reviewCount}</h3><p>默认不进入描述性统计</p></div><div class="card"><div class="kicker">已排除</div><h3>${analytics.excludedCount || 0}</h3><p>教师手动排除记录</p></div></div><div class="grid-2" style="margin-top:24px"><div class="chart-panel"><h2>NH₄Cl 浓度—平均得率趋势</h2><div class="bars-ui">${bars}</div>${analytics.fit ? `<p class="small">探索性二阶拟合候选点为 ${analytics.fit.optimum}%，拟合值 ${analytics.fit.predictedYield}%；当前小样本未经稳定性与交叉验证，不可解释为最优条件或确认性预测。</p>` : ""}</div><div class="card dark-card">${decisionSummaryCard(data)}</div></div><div class="grid-2" style="margin-top:24px"><div class="card"><div class="kicker">Error Heatmap</div><h2>实验误差来源热力图</h2><div class="heatmap">${heat}</div></div><div class="card"><div class="kicker">Learning Insights</div><h2>课堂难点热词</h2><div class="hotword-cloud">${hot}</div><p class="small">计数仅来自当前实验记录中的乳化、对照组、抑菌圈与异常字段；不包含 AI 提问语义分析。</p></div></div><div class="card ai-class-summary-card" style="margin-top:24px"><div class="kicker">AI Class Diagnosis</div><h2>AI 班级诊断摘要</h2><p class="small">汇总本班实验数据与习题正确率，可选地由 DeepSeek 生成解释草稿；内容需教师复核，不作为自动数据排除依据。</p><div id="class-summary-box" class="class-summary-content"><p style="color:#94a3b8">点击下方按钮生成诊断报告。</p></div><button class="btn btn-primary" type="button" id="gen-class-summary" onclick="generateClassSummary()" style="margin-top:16px">生成 AI 班级诊断</button></div><div class="section-head" style="margin-top:30px"><div class="kicker">Data Review</div><h2>学生数据管理</h2><p>“需复核”默认不会进入趋势图和报告描述性统计；教师可手动纳入、排除或删除。</p><div class="filter-tabs"><button type="button" data-record-filter="all" class="active">全部</button><button type="button" data-record-filter="normal">正常</button><button type="button" data-record-filter="review">需复核</button><button type="button" data-record-filter="included">已纳入</button><button type="button" data-record-filter="excluded">已排除</button></div></div><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>学生</th><th>班级</th><th>小组</th><th>NH₄Cl</th><th>得率</th><th>抑菌圈</th><th>状态</th><th>诊断 / 备注</th><th>教师操作</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="section wrap"><div class="section-head"><div class="kicker">习题作答情况</div><h2>学生习题答题记录</h2><p>展示本班学生在探究习题页的作答情况，包括各难度层级正确率。仅登录教师可查看。</p></div><div id="pq-results-panel"><p class="small" style="color:#94a3b8">正在加载数据……</p></div><script>if(typeof loadPQResults==='function') loadPQResults(); else window.addEventListener('DOMContentLoaded',()=>{ if(typeof loadPQResults==='function') loadPQResults(); });</script></section>${session?.defaultPassword && !demo ? `<section class="section wrap">${changePasswordPanel()}</section>` : ""}`;
  return layout("教师数据工作台", (!demo ? '<div class="wrap page-actions"><a class="btn btn-secondary" href="/csv">CSV 实验导入与导出</a><a class="btn btn-secondary" href="/scientific-analysis">封存科学分析</a></div>' : "") + body, { session });
}

function adminPage(records, users, session) {
  const analytics = analyticsFor(records);
  const classNames = [
    ...new Set([
      ...(records || []).map((r) => r.class_name || "未分班"),
      ...(users || []).map((u) => u.class_name).filter(Boolean),
    ]),
  ];
  const classCards =
    classNames
      .map((c, i) => {
        const rows = records.filter((r) => (r.class_name || "未分班") === c);
        const classUsers = users.filter((u) => u.class_name === c);
        const a = analyticsFor(rows);
        return `<button class="card admin-class-card" type="button" data-class-target="class-${i}"><div class="kicker">Class</div><h3>${esc(c)}</h3><p>记录 ${rows.length} 份｜账号 ${classUsers.length} 个｜疑似异常 ${a.reviewCount} 份</p><span>查看班级数据</span></button>`;
      })
      .join("") || '<div class="card"><h3>暂无班级数据</h3></div>';
  const classTables = classNames
    .map((c, i) => {
      const rows = records.filter((r) => (r.class_name || "未分班") === c);
      const body =
        rows
          .slice(0, 12)
          .map(
            (r) =>
              `<tr><td>${esc(r.student_name)}</td><td>${esc(r.group_name)}</td><td>${Number(r.nh4cl_concentration)}%</td><td>${yieldPercentFor(r).toFixed(2)}%</td><td>${Number(r.inhibition_zone_diameter || 0).toFixed(1)} mm</td><td>${recordDiagnostics(r, rows).status === "review" ? "需复核" : "正常"} · <a href="/evidence?record_id=${encodeURIComponent(r.id)}">附件</a></td></tr>`,
          )
          .join("") || '<tr><td colspan="6">该班暂无提交记录</td></tr>';
      return `<div class="class-data-panel" id="class-${i}"><div class="section-head"><div class="kicker">Class Data</div><h2>${esc(c)}</h2><p>展示该班最近提交记录，管理员可用于全校数据巡检。</p></div><div class="table-wrap"><table><thead><tr><th>学生</th><th>小组</th><th>NH₄Cl</th><th>得率</th><th>抑菌圈</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
    })
    .join("");
  const userRows = users
    .map(
      (u) =>
        `<tr data-user-row data-username="${esc(u.username)}" data-name="${esc(u.name)}" data-class="${esc(u.class_name || "")}"><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.name)}</td><td>${esc(u.class_name || "—")}</td><td>${u.defaultPassword ? "临时密码" : "已修改"}</td><td><button class="mini-btn" data-reset-user="${esc(u.username)}" type="button">生成临时密码</button></td></tr>`,
    )
    .join("");
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>Admin Console</div><h1 class="page-title">管理员控制台</h1><p class="lead">查看全校班级数据，检索学生与教师账号，并为忘记密码的用户重置初始密码。</p></div></section><section class="section wrap admin-dashboard"><div class="grid-4 admin-stat-grid"><a class="card admin-stat" href="#class-overview"><div class="kicker">班级数量</div><h3>${classNames.length}</h3><p>点击查看班级概览</p></a><a class="card admin-stat" href="#school-records"><div class="kicker">总记录数</div><h3>${records.length}</h3><p>点击查看全校记录</p></a><a class="card admin-stat" href="#account-tools"><div class="kicker">账号数量</div><h3>${users.length}</h3><p>点击检索账号</p></a><a class="card admin-stat" href="#school-records"><div class="kicker">异常记录</div><h3>${analytics.reviewCount}</h3><p>点击查看状态</p></a></div><div id="class-overview" class="section-head admin-section-head"><h2>班级数据概览</h2><p>班级来自账号与提交记录两类数据；即使暂未提交，也会在全校视角中出现。</p></div><div class="grid-3 admin-class-grid">${classCards}</div>${classTables}<div id="account-tools" class="section-head admin-section-head"><h2>账号与密码管理</h2><p>输入学号或账号可定位用户，再执行重置。用户登录后可自行修改密码。</p></div><div class="admin-user-tools grid-2" style="margin-top:16px"><div class="card"><div class="kicker">Create Account</div><h3>新建单个账号</h3><p class="small">可为临时加入的学生或教师快速开通账号，必须填写独立临时密码，禁止使用隔离演示密码。</p><form id="admin-create-user-form" class="form-grid"><div class="input-group"><label>角色</label><select name="role"><option value="student">学生</option><option value="teacher">教师</option></select></div><div class="input-group"><label>账号</label><input name="username" placeholder="如 student004 / teacher002" required></div><div class="input-group"><label>姓名</label><input name="name" placeholder="学生或教师姓名" required></div><div class="input-group"><label>班级</label><input name="class_name" value="高二化学探究班"></div><div class="input-group"><label>小组（教师可空）</label><input name="group_name" placeholder="如 第4组"></div><div class="input-group"><label>初始密码</label><input name="password" placeholder="6-72 位独立临时密码" required></div><button class="btn btn-primary" type="submit">创建 / 更新账号</button></form><p id="admin-create-user-result" class="small strong"></p></div><div class="card"><div class="kicker">Excel Import</div><h3>从 Excel 批量注册</h3><p class="small">支持直接从 Excel 复制表格后粘贴；也支持 CSV 内容。第一列可写 student/teacher，或中文“学生/教师”。</p><textarea id="admin-import-users-text" rows="8" placeholder="角色&#9;账号&#9;姓名&#9;班级&#9;小组&#9;密码&#10;student&#9;student004&#9;宋予航&#9;高二化学探究班&#9;第4组&#9;&#10;teacher&#9;teacher002&#9;李老师&#9;高二化学探究班&#9;&#9;"></textarea><div class="page-actions" style="margin-top:12px"><button class="btn btn-primary" type="button" id="admin-import-users-btn">一键导入账号</button><button class="btn btn-secondary" type="button" id="admin-fill-import-example">填入示例</button></div><p id="admin-import-users-result" class="small strong"></p></div></div><div class="admin-search-card card"><div class="input-group"><label>学号 / 账号 / 姓名</label><input id="admin-user-search" placeholder="例如：student001 或 林知远"/></div><div id="admin-user-detail" class="admin-user-detail">输入后显示匹配账号信息</div><p id="admin-result" class="small strong"></p></div><div class="table-wrap admin-user-table"><table><thead><tr><th>账号</th><th>角色</th><th>姓名</th><th>班级</th><th>密码状态</th><th>操作</th></tr></thead><tbody>${userRows}</tbody></table></div><div id="school-records" class="section-head admin-section-head"><h2>全校提交记录</h2></div><div class="table-wrap"><table><thead><tr><th>学生</th><th>班级</th><th>小组</th><th>NH₄Cl</th><th>得率</th><th>状态</th></tr></thead><tbody>${records
    .slice(0, 30)
    .map(
      (r) =>
        `<tr><td>${esc(r.student_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.group_name)}</td><td>${Number(r.nh4cl_concentration)}%</td><td>${yieldPercentFor(r).toFixed(2)}%</td><td>${recordDiagnostics(r, records).status === "review" ? "需复核" : "正常"} · <a href="/evidence?record_id=${encodeURIComponent(r.id)}">附件</a></td></tr>`,
    )
    .join("")}</tbody></table></div></section>`;
  return layout("管理员控制台", '<div class="wrap page-actions"><a class="btn btn-secondary" href="/csv">CSV 实验导入与导出</a><a class="btn btn-secondary" href="/scientific-analysis">封存科学分析</a></div>' + body, { session });
}
function practicePage(session) {
  const MODS = [
    {
      id: "sep",
      icon: "⚗️",
      label: "物质分离与提纯",
      kicker: "Module A · 化学",
      desc: "基于水蒸气蒸馏提取柑橘精油，掌握蒸馏原理、沸点差异分离与提纯思想。",
      qs: [
        {
          id: "q1",
          type: "mc",
          text: "水蒸气蒸馏法提取精油，利用的核心原理是：",
          opts: [
            "精油不溶于水，自然漂浮在水面",
            "混合体系沸点低于各组分单独沸点，精油随水蒸气低温馏出",
            "精油密度小于水，受浮力作用分层",
            "精油能被水分子强力吸附后随蒸气携出",
          ],
          ans: 1,
          explain:
            "两种不互溶液体的混合沸点低于任一组分纯液态沸点，使高沸点精油在较低温度随水蒸气馏出，避免高温分解。",
        },
        {
          id: "q2",
          type: "mc",
          text: "蒸馏后收集到油水混合物，进一步分离油相，最合适的操作是：",
          opts: [
            "蒸发结晶（适合固体析出）",
            "静置分层后用分液漏斗分液",
            "过滤（适合固液分离）",
            "升华（适合固体气化）",
          ],
          ans: 1,
          explain:
            "油水不互溶且密度不同，静置后明显分两层，用分液漏斗放出下层水相即可分离。",
        },
        {
          id: "q3",
          type: "mc",
          text: "相比直接蒸馏，水蒸气蒸馏的最大优势是：",
          opts: [
            "设备更简单，成本更低",
            "提取温度低于精油沸点，适合热不稳定的天然挥发性成分",
            "蒸馏速度更快，效率更高",
            "馏出液就是纯精油，无需再处理",
          ],
          ans: 1,
          explain:
            "水蒸气蒸馏使操作温度显著低于精油自身沸点，保护热不稳定成分；馏出液仍是油水混合物，需分液处理。",
        },
        {
          id: "q4",
          type: "sa",
          text: "收集瓶内油层与水层界面模糊（乳化）。请分析可能的原因（至少两点），并说明如何处理。",
          ans: "可能原因：①蒸馏过快，液滴被气流带出形成乳浊液；②橘皮中的果胶等物质充当天然乳化剂；③静置时间不足（＜15min）；④操作时剧烈振荡加速乳化。\n处理方法：延长静置时间（建议≥30min）；加入少量NaCl盐析促进分层；轻旋容器而非剧烈振荡；若仍无法分层，标记为异常数据并在报告中注明剔除原因。",
        },
        {
          id: "q21",
          type: "mc",
          text: '蒸馏实验中冷凝水应"下进上出"，最合理的解释是：',
          opts: [
            "下进上出使水循环利用率更高",
            "下进上出为逆流冷凝，冷水与热蒸汽方向相反，换热效率最高",
            "下进上出是防止水流进入蒸馏烧瓶",
            "实验规程的规定，无特别原因",
          ],
          ans: 1,
          explain:
            "逆流冷凝：冷水从下进，蒸汽从上往下流，二者逆向流动温差最大、换热最充分，冷凝效果显著优于顺流（同向）冷凝。",
        },
        {
          id: "q22",
          type: "mc",
          text: "分液操作中，取出分液漏斗下层液体的正确步骤是：",
          opts: [
            "从上口用胶头滴管吸出下层",
            "旋开下口旋塞缓缓放液，流完后关闭旋塞，再从上口倒出上层",
            "倒置漏斗加快流速",
            "先倒出上层再取下层",
          ],
          ans: 1,
          explain:
            "分液标准步骤：下层从旋塞放出，上层从上口倒出，两步独立操作避免混合。拔开上口玻璃塞是为了平衡气压让下层顺利流出，而非直接取液。",
        },
      ],
    },
    {
      id: "salt",
      icon: "🧪",
      label: "溶解度与盐析",
      kicker: "Module B · 化学",
      desc: "通过NH₄Cl浓度梯度实验，理解溶解平衡与盐析效应，训练变量控制思维。",
      qs: [
        {
          id: "q5",
          type: "mc",
          text: "NH₄Cl 溶于水后，溶液中主要存在的粒子是：",
          opts: [
            "NH₄Cl 分子（未电离）",
            "NH₄⁺ 和 Cl⁻（完全电离）",
            "NH₃ 和 HCl（分解产物）",
            "N²⁻ 和 H⁺（不存在此形式）",
          ],
          ans: 1,
          explain:
            "NH₄Cl 是强电解质，在水中完全电离。主要粒子为 NH₄⁺ 和 Cl⁻，以及少量 H⁺、OH⁻。",
        },
        {
          id: "q6",
          type: "mc",
          text: "加入适量NH₄Cl后油水分层更明显，主要原因是：",
          opts: [
            "NH₄Cl与精油发生化学反应，生成了新物质",
            "NH₄⁺和Cl⁻增大水相离子强度，降低精油在水中的溶解度（盐析效应）",
            "NH₄Cl增加了水的黏度，阻止精油扩散",
            "NH₄Cl改变了精油分子的相对分子质量",
          ],
          ans: 1,
          explain:
            "盐析效应：大量离子争夺水分子的水化层，疏水性有机物在水中溶解度下降，从水相析出，促进油水分离，不涉及化学反应。",
        },
        {
          id: "q7",
          type: "mc",
          text: "有效数据（剔除污染样本）：0%→0.76%，1%→1.08%，3%→1.42%，4%→1.22%。以下结论最准确的是：",
          opts: [
            "NH₄Cl浓度越高得率越高，应继续提高至5%甚至更高",
            "在这组小样本中，3%组观测均值较高，4%组较低；尚不能确认最优浓度",
            "0%对照组意义不大，下次实验可省略",
            "各组n值太小，完全无法作出任何判断",
          ],
          ans: 1,
          explain:
            '3%组观测均值较高，4%组较低；这可形成待验证的乳化假设，不能在 n=1–2 时确认最优浓度。0%对照是必要参照。',
        },
        {
          id: "q8",
          type: "sa",
          text: '某同学认为"NH₄Cl浓度越高，盐析越强，精油得率一定越高"。请用原理和本实验数据评价该观点。',
          ans: "该观点不受当前证据支持。\n①原理上，高盐浓度可能同时影响粘度、分层和乳化，因此不应假设得率单调上升。\n②这组演示数据中，4% 组观测均值低于 3% 组，可用来提出乳化影响的待检验假设。\n限制：各组 n=1–2，不能因此确认转折点、最优区间或因果机制。",
        },
        {
          id: "q23",
          type: "mc",
          text: "盐析效应对哪类物质作用最显著？",
          opts: [
            "带正电荷的无机离子（如Na⁺、K⁺）",
            "亲水性小分子（如葡萄糖、乙醇）",
            "疏水性非极性有机物（如精油、蛋白质疏水区）",
            "强酸根离子（如Cl⁻、SO₄²⁻）",
          ],
          ans: 2,
          explain:
            "盐析通过大量电解质离子争夺水化层，降低疏水性物质的溶解度，使其从水相析出。精油（非极性萜烯）和蛋白质（疏水区域大）是典型对象；亲水性小分子和离子受盐析影响很小。",
        },
        {
          id: "q24",
          type: "mc",
          text: "若去掉0% NH₄Cl对照组，本实验最主要的缺陷是：",
          opts: [
            "实验组数减少，统计可靠性反而增强",
            "无法判断NH₄Cl本身是否提升了精油得率（缺乏基准参照）",
            "程序会自动补充0%组数据",
            "0%组数据对结论无影响，可以省略",
          ],
          ans: 1,
          explain:
            '对照实验原则：0%组是判断"盐析是否有效"的基准，没有0%就无法与有盐条件比较，无法得出"NH₄Cl改善分层"的有效结论。这是违反实验设计基本原则的缺陷。',
        },
      ],
    },
    {
      id: "organic",
      icon: "🌱",
      label: "有机化学与绿色化学",
      kicker: "Module C · 化学",
      desc: "认识柠檬烯的分子结构与性质，理解绿色化学理念在天然产物提取中的体现。",
      qs: [
        {
          id: "q9",
          type: "mc",
          text: "柠檬烯（C₁₀H₁₆）所含的官能团是：",
          opts: [
            "羟基（—OH），具有醇的性质",
            "羧基（—COOH），具有酸性",
            "碳碳双键（C=C），属于不饱和烃",
            "氨基（—NH₂），具有碱性",
          ],
          ans: 2,
          explain:
            "柠檬烯是单萜烯，环内和侧链各含一个C=C，属不饱和烃。无羟基、羧基、氨基等官能团。",
        },
        {
          id: "q10",
          type: "mc",
          text: "下列最能体现本实验绿色化学理念的是：",
          opts: [
            "使用精密贵重仪器以提高精度",
            "以废弃橘皮为原料，用水蒸气代替有机溶剂，实现废物资源化利用",
            "操作时穿戴全套防护装备",
            "尽量缩短加热时间以节约电力",
          ],
          ans: 1,
          explain:
            "绿色化学核心：原料可再生无害、废物最小化、避免有毒溶剂。废橘皮+水蒸气蒸馏完全符合；防护装备是安全规范，不属于绿色化学特征。",
        },
        {
          id: "q11",
          type: "sa",
          text: "根据柠檬烯含有C=C，推测其可能发生哪些类型的化学反应？每类至少举一个典型反应物。",
          ans: "①加成反应（C=C特征）：与H₂（催化加氢，碳碳双键饱和）；与Br₂水溶液（溴水褪色，鉴定不饱和键）；与HCl（马氏加成规则）。\n②氧化反应：与酸性高锰酸钾（KMnO₄）溶液反应，溶液褪色，C=C被氧化断裂。\n③加聚反应：在催化剂下多个柠檬烯分子加聚，生成高分子聚柠檬烯（生物基聚合物）。\n④完全燃烧：C₁₀H₁₆ + 14O₂ → 10CO₂ + 8H₂O，释放大量热。",
        },
        {
          id: "q12",
          type: "sa",
          text: '从"原料来源、提取方法、产品价值"三个角度，说明本实验如何体现可持续发展理念。',
          ans: "①原料来源：利用食品加工后废弃的橘皮，变废为宝，减少固体废弃物排放，符合循环利用原则，避免浪费新鲜生物质原料。\n②提取方法：采用水蒸气蒸馏，以水为唯一介质，不使用苯、乙醚等有毒有机溶剂，从源头减少有害物排放，保护环境和实验者健康。\n③产品价值：天然精油可替代化学合成香料、防腐剂或生物农药，减少石化原料消耗与化学品污染风险，助力绿色农业和可持续消费模式。",
        },
        {
          id: "q25",
          type: "mc",
          text: "柠檬烯与溴水振荡后溴水褪色，下列解释最准确的是：",
          opts: [
            "柠檬烯是强还原剂，将Br₂还原为Br⁻（氧化还原反应）",
            "柠檬烯中的C=C双键与Br₂发生加成反应，生成邻二溴化合物而消耗Br₂",
            "柠檬烯使Br₂沸点升高，Br₂挥发量减少",
            "柠檬烯与水反应间接消耗Br₂",
          ],
          ans: 1,
          explain:
            "碳碳双键与Br₂的加成反应：柠檬烯 + Br₂ → 邻二溴化物（无色），Br₂被消耗使溴水橙棕色消失。同时柠檬烯可萃取部分Br₂至有机层，两者均使水层变浅，但加成是主要原因。",
        },
        {
          id: "q26",
          type: "mc",
          text: "NH₄Cl在水溶液中属于：",
          opts: [
            "弱电解质，部分电离",
            "强电解质，完全电离为NH₄⁺和Cl⁻",
            "非电解质，不电离",
            "两性电解质，既能电离也能水解",
          ],
          ans: 1,
          explain:
            "NH₄Cl是强酸（HCl）与弱碱（NH₃·H₂O）生成的盐，属强电解质，在水中完全电离为NH₄⁺和Cl⁻。NH₄⁺会轻微水解（使溶液显弱酸性），但这是水解现象，NH₄Cl本身仍为强电解质。",
        },
      ],
    },
    {
      id: "bio",
      icon: "🦠",
      label: "生物学关联",
      kicker: "Module D · 生物",
      desc: "从植物次生代谢、微生物抑制和细胞膜功能角度，理解精油的生物学意义。",
      qs: [
        {
          id: "q13",
          type: "mc",
          text: "植物产生精油等次生代谢产物，下列哪项不属于其生物学意义？",
          opts: [
            "吸引传粉者，协助完成有性生殖",
            "抵御病原微生物侵害，发挥防御功能",
            "直接为植物细胞提供生命活动所需的能量",
            "驱避草食性昆虫或动物，减少天敌取食",
          ],
          ans: 2,
          explain:
            "次生代谢产物的功能是防御、吸引和信号传递，不直接提供能量。能量来自光合作用产生的葡萄糖等初生代谢产物（ATP）。",
        },
        {
          id: "q14",
          type: "mc",
          text: "精油组抑菌圈直径13mm，Tween 80对照组无明显抑菌圈，最合理的初步结论是：",
          opts: [
            "精油对E.coli有抑制作用，且该作用来自精油成分本身而非乳化剂",
            "精油能完全杀灭大肠杆菌，浓度足够时可替代抗生素",
            "Tween 80无抑菌效果，说明所有天然产物对细菌也无害",
            "Tween 80对照组有问题，整组实验数据不可信，需重做",
          ],
          ans: 0,
          explain:
            'Tween 80（乳化剂）对照排除乳化剂干扰，精油组出现抑菌圈证明是精油成分发挥作用。13mm属中等抑制，不能推断"完全杀灭"或临床应用价值，需更多实验。',
        },
        {
          id: "q15",
          type: "sa",
          text: '柠檬烯可能通过破坏细菌细胞膜发挥抑菌作用。请用高中生物语言解释"细胞膜被破坏"对细菌生命活动的影响。',
          ans: "细胞膜是细胞与外界进行物质交换的屏障，具有选择透过性。被破坏后产生以下影响：\n①内容物外漏：细胞内蛋白质、核酸、无机盐等生命物质流出细胞，细菌失去维持代谢所需的物质基础。\n②外界物质大量进入：破坏细胞内稳态（渗透压平衡失调），细菌可能因过度吸水膨胀裂解，或因失水皱缩死亡。\n③膜蛋白失活：膜上载体蛋白和酶蛋白丧失功能，主动运输中断，影响营养物质吸收和代谢废物排出。\n综合效应：细菌代谢活动停止，停止生长甚至死亡，宏观表现为抑菌圈形成。",
        },
        {
          id: "q16",
          type: "sa",
          text: '请设计对照实验验证"3% NH₄Cl组精油的抑菌效果优于0%组"。写出自变量、因变量、主要控制变量和结果判断标准。',
          ans: "自变量：精油来源（3% NH₄Cl条件提取 vs 0%条件提取）。\n因变量：抑菌圈直径（mm）。\n主要控制变量：精油乳液浓度（如均配为30% v/v）；大肠杆菌菌液浓度（OD600相同）；培养基种类、用量和配制方式；培养温度（37℃）与时间（24h）；操作人员、实验环境一致。\n结果判断：若3%组抑菌圈直径显著大于0%组（需重复实验≥3次，进行t检验或比较均值），且Tween 80空白对照组无抑菌圈，则支持假设；若两组差异不显著（p＞0.05），则该假设不成立，需进一步分析原因（如提取方式差异是否导致成分变化）。",
        },
        {
          id: "q27",
          type: "mc",
          text: "纸片扩散法中，抑菌圈大小最主要取决于：",
          opts: [
            "培养皿的直径与品牌",
            "精油的最低抑菌浓度（MIC）与精油在培养基中的扩散速率",
            "操作人员取样的熟练程度",
            "大肠杆菌的菌落数量",
          ],
          ans: 1,
          explain:
            "抑菌圈边界出现在精油扩散浓度下降至MIC（最低抑菌浓度）的位置；圈的大小由MIC高低和扩散距离（受分子量、培养基密度等影响）共同决定，与操作者熟练度和培养皿品牌无关。",
        },
        {
          id: "q28",
          type: "mc",
          text: "精油嵌入细菌细胞膜磷脂双层疏水区域的化学原理是：",
          opts: [
            "氢键：精油与磷脂亲水头部形成大量氢键",
            "相似相溶：非极性精油溶入磷脂双层内核的非极性脂肪酸尾部区域",
            "离子键：精油带正电荷与磷脂负电荷相吸",
            "共价键：精油与磷脂分子形成共价化合物",
          ],
          ans: 1,
          explain:
            '"相似相溶"原理：非极性溶质（精油萜烯）易溶入非极性介质（磷脂疏水内核）。精油嵌入后破坏膜完整性，导致通透性改变、物质外漏，是精油发挥抑菌作用的重要分子机制。',
        },
      ],
    },
    {
      id: "inquiry",
      icon: "📊",
      label: "科学探究流程",
      kicker: "Module E · 探究",
      desc: "对应新课标科学探究能力：提出问题、建立假设、控制变量、数据分析、得出结论。",
      qs: [
        {
          id: "q17",
          type: "data",
          text: "根据下表演示数据，识别观测均值较高的已测条件，并说明为什么不能宣称它是最优浓度。",
          table: [
            [
              "NH₄Cl浓度",
              "有效样本(n)",
              "平均精油得率",
              "分层清晰度(满分5)",
              "平均抑菌圈",
            ],
            ["0%", "1", "0.76%", "2.0", "0.0 mm"],
            ["1%", "1", "1.08%", "3.0", "8.5 mm"],
            ["3%", "2", "1.42%", "4.5", "13.2 mm"],
            ["4%", "1", "1.22%", "4.0", "15.2 mm"],
          ],
          ans: "在这组演示数据中，3% NH₄Cl 组是最高的已测观测均值：得率 1.42%、分层清晰度 4.5，且抑菌圈观测值为 13.2 mm。\n4% 组的观测得率较低，可作为进一步检验乳化影响的假设线索。\n限制：各组 n=1–2，不足以确认最优浓度、显著差异或因果关系；需更多预先设计的平行实验。",
        },
        {
          id: "q18",
          type: "mc",
          text: "研究NH₄Cl浓度对精油得率的影响时，下列属于需要严格控制的无关变量的是：",
          opts: [
            "NH₄Cl的浓度（0%/1%/3%/4%梯度）",
            "精油的质量（计算得率的依据）",
            "每次实验橘皮的质量与新鲜程度",
            "记录的抑菌圈直径大小",
          ],
          ans: 2,
          explain:
            "A是自变量（主动改变）；B是因变量（测量指标）；D是另一实验问题的因变量；C是影响精油提取量的无关变量，各组必须保持一致，确保只有NH₄Cl浓度不同。",
        },
        {
          id: "q19",
          type: "sa",
          text: "4%组有一条数据得率高达2.50%，远超其余各组。①分析异常原因；②说明数据处理方法；③该处理对实验结论有何影响？",
          ans: '①可能原因包括水相混入、未扣除容器皮重、污染或记录错误。该演示记录带有学生异常标记，但系统标记不等于教师决定。\n②处理方法：保留原始记录和证据，由教师复核后记录纳入或排除决定及理由；不应由规则或 LLM 自动删除。\n③异常值会明显改变 4% 组均值，所以报告应同时呈现复核决定、纳入规则和敏感性。即使排除后，n=1–2 仍不足以确认最优区间。',
        },
        {
          id: "q20",
          type: "sa",
          text: '请按规范格式写出本次探究的实验结论：以"在本实验条件下……结果表明……但由于……结论仅供参考"开头。',
          ans: "在本演示数据的已测条件中，3% NH₄Cl 组的观测平均得率较高，4% 组较低。但由于各组有效样本量只有 n=1–2，审核决定也会影响均值，这些结果只能用于描述性比较和生成待检验假设，不足以确认最优浓度。",
        },
        {
          id: "q29",
          type: "mc",
          text: '以下方案中最符合"控制变量"原则的是：',
          opts: [
            "各小组使用不同质量的橘皮，但NH₄Cl浓度相同",
            "同一小组在不同日期分别完成各浓度组实验",
            "同批橘皮同日处理，各组仅NH₄Cl浓度不同，其余条件完全一致",
            "用不同品种橘皮分别代表不同浓度组",
          ],
          ans: 2,
          explain:
            "控制变量要求：改变自变量（NH₄Cl浓度），保持其他所有无关变量一致。同批橘皮同日操作确保原料质量、操作条件统一，只有自变量不同，符合单因素对照原则。其余选项都引入了额外变量（橘皮质量、日期差异、品种差异）。",
        },
        {
          id: "q30",
          type: "mc",
          text: '"3%组平均得率最高，为1.42%"这句话属于：',
          opts: [
            "实验结论（基于数据的推断）",
            "实验结果（直接观测/计算值）",
            "实验假设（实验前预期）",
            "异常数据（需要剔除）",
          ],
          ans: 1,
          explain:
            '"实验结果"是直接测量或计算得出的客观数值陈述。"实验结论"是在结果基础上的逻辑推断（如"NH₄Cl盐析促进油水分离"），需说明理由。"1.42%最高"是数值陈述，属于结果，不是推断。',
        },
      ],
    },
  ];
  // Difficulty level per question (1=基础 2=提升 3=拓展)
  const QLVL = {
    q1: 1,
    q2: 1,
    q3: 2,
    q4: 3,
    q5: 1,
    q6: 2,
    q7: 2,
    q8: 3,
    q9: 1,
    q10: 1,
    q11: 2,
    q12: 3,
    q13: 1,
    q14: 2,
    q15: 2,
    q16: 3,
    q17: 3,
    q18: 1,
    q19: 2,
    q20: 3,
    q21: 1,
    q22: 2,
    q23: 2,
    q24: 2,
    q25: 1,
    q26: 1,
    q27: 2,
    q28: 3,
    q29: 1,
    q30: 2,
  };
  const LVL_NAMES = ["", "基础", "提升", "拓展"];
  const totalMC = MODS.reduce(
    (s, m) => s + m.qs.filter((q) => q.type === "mc").length,
    0,
  );
  const totalQ = MODS.reduce((s, m) => s + m.qs.length, 0);
  const tabBtns = MODS.map(
    (m, i) =>
      `<button class="pq-tab${i === 0 ? " active" : ""}" type="button" onclick="pqSwitch('${m.id}')" data-mod="${m.id}">${m.icon} ${esc(m.label)}</button>`,
  ).join("");
  const panels = MODS.map((m, i) => {
    const qCards = m.qs
      .map((q, qi) => {
        const num = `${String.fromCharCode(65 + i)}-${qi + 1}`;
        const lv = QLVL[q.id] || 1;
        const lvBadge = `<span class="pq-lv-badge pq-lv-${lv}" data-lvbadge="${q.id}">${LVL_NAMES[lv]}</span>`;
        if (q.type === "mc") {
          const optHtml = q.opts
            .map(
              (o, oi) =>
                `<button class="pq-opt" type="button" data-qi="${q.id}" data-oi="${oi}" data-correct="${oi === q.ans ? 1 : 0}" onclick="pqAnswer(this)">${String.fromCharCode(65 + oi)}. ${esc(o)}</button>`,
            )
            .join("");
          return `<div class="pq-card" id="pqcard-${q.id}" data-level="${lv}" data-qid="${q.id}"><div class="pq-card-head">${lvBadge}<span class="pq-badge pq-badge-mc">选择题</span><span class="pq-num">${num}</span></div><p class="pq-text">${esc(q.text)}</p><div class="pq-opts">${optHtml}</div><div class="pq-feedback" id="pqfb-${q.id}" style="display:none"></div><div class="pq-explain" id="pqex-${q.id}" style="display:none"><div class="pq-explain-label">解析</div><p class="pq-explain-text">${esc(q.explain)}</p></div></div>`;
        }
        if (q.type === "data") {
          const thead = q.table[0].map((h) => `<th>${esc(h)}</th>`).join("");
          const tbody = q.table
            .slice(1)
            .map(
              (row) =>
                `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`,
            )
            .join("");
          return `<div class="pq-card pq-card-wide" id="pqcard-${q.id}" data-level="${lv}" data-qid="${q.id}"><div class="pq-card-head">${lvBadge}<span class="pq-badge pq-badge-data">数据分析</span><span class="pq-num">${num}</span></div><p class="pq-text">${esc(q.text)}</p><div class="pq-table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div><details class="pq-details"><summary>查看参考分析</summary><div class="pq-answer">${esc(q.ans).replace(/\n/g, "<br>")}</div></details></div>`;
        }
        return `<div class="pq-card pq-card-wide" id="pqcard-${q.id}" data-level="${lv}" data-qid="${q.id}"><div class="pq-card-head">${lvBadge}<span class="pq-badge pq-badge-sa">简答题</span><span class="pq-num">${num}</span></div><p class="pq-text">${esc(q.text)}</p><details class="pq-details"><summary>查看参考答案</summary><div class="pq-answer">${esc(q.ans).replace(/\n/g, "<br>")}</div></details></div>`;
      })
      .join("");
    return `<div class="pq-panel${i === 0 ? "" : " hidden"}" id="pqpanel-${m.id}"><div class="pq-module-head"><div class="pq-module-kicker">${esc(m.kicker)}</div><h2 class="pq-module-title">${esc(m.label)}</h2><p class="pq-module-desc">${esc(m.desc)}</p></div><div class="pq-grid">${qCards}</div></div>`;
  }).join("");
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>Practice</div><h1 class="page-title">课堂习题与知识点回顾</h1><p class="lead">覆盖高中化学（蒸馏、盐析、有机化学、绿色化学）与生物（次生代谢、微生物抑制、细胞膜）核心知识点，结合明确标注的演示数据训练科学探究能力。</p><div class="pq-hero-stats"><span>共 <strong>${totalQ}</strong> 道题</span><span>·</span><span>选择题得分：<strong id="pq-correct">0</strong> / <strong>${totalMC}</strong></span></div></div></section><section class="section wrap"><div class="pq-adaptive-bar"><span class="pq-lv-badge pq-lv-1">基础</span><span id="pq-stat-1" class="pq-lv-stat-txt">0/11</span><span class="pq-lv-badge pq-lv-2">提升</span><span id="pq-stat-2" class="pq-lv-stat-txt">0/12</span><span class="pq-lv-badge pq-lv-3">拓展</span><span id="pq-stat-3" class="pq-lv-stat-txt">0/7</span><span id="pq-recommend-tip" class="pq-recommend-tip">完成选择题后，系统将根据本地正确率提示下一难度</span><button type="button" class="pq-tab" id="pq-filter-btn" onclick="pqFilterToggle()" style="margin-left:auto">🎯 筛选提示题</button></div><div class="pq-tabs">${tabBtns}</div><div class="pq-panels">${panels}</div><div class="card dark-card" style="margin-top:28px"><div class="card-content"><div class="kicker">AI 实时讲解</div><h2>把不会的问题交给 AI 助教</h2><p>围绕高中化学与生物知识点给出启发式解析，帮助理解变量控制、证据推理与实验设计。</p><form id="practice-ask-form" class="practice-ai-form"><textarea id="practice-question" class="practice-ai-input" rows="3" placeholder="例如：为什么4%组得率低于3%组？盐析与乳化的关系是什么？"></textarea><button id="practice-ai-send" class="btn btn-primary practice-ai-btn" type="submit">生成解释</button></form><p class="practice-ai-hint">提示：输入问题后按 Enter 直接发送；Shift + Enter 换行。</p><div id="practice-answer-box" class="practice-answer-box">AI 反馈会显示在这里。</div></div></div></section>`;
  return layout("课堂习题", body, { session });
}

function resourcesPage(session) { return layout("Scientific resources", `<section class="section wrap"><div class="section-head"><div class="kicker">Scientific resources</div><h1>Reproduce one result</h1><p>Only anonymous synthetic samples and code-generated figures are included in this source snapshot.</p></div><div class="grid-2"><a class="card" href="/walkthrough"><h2>Evidence trail</h2><p>Follow one invented observation, review and sealed input.</p></a><a class="card" href="/engineering"><h2>Engineering notebook</h2><p>Inspect the model comparison, follow-up design and runnable commands.</p></a></div><p><a href="/static/materials/nh4cl-yield-sample.csv" download>Download the separately labeled classroom sample CSV</a></p><p class="small">No experimental photograph, spectrum, lecture video or binary molecular model is bundled. The original private development record is kept separate.</p></section>`, {session}); }

function llmPage(session) {
  const userName = session ? esc(session.name) : "同学";
  const scenes = [
    {
      id: "preview",
      icon: "blue",
      label: "课前预习",
      desc: "了解实验背景与原理，为课堂操作做好知识储备。",
    },
    {
      id: "review",
      icon: "orange",
      label: "课后答疑",
      desc: "针对实验中遇到的现象和数据，深入分析解答疑惑。",
    },
    {
      id: "discuss",
      icon: "purple",
      label: "拓展探究",
      desc: "讨论延伸课题，培养跨学科思维与科学探究意识。",
    },
  ];
  const sceneCards = scenes
    .map(
      (s) =>
        `<a class="card llm-scene-card" href="javascript:void(0)" onclick="selectScene('${s.id}')"><div class="icon ${s.icon}">${s.label[0]}</div><h3>${s.label}</h3><p>${s.desc}</p></a>`,
    )
    .join("");
  const previewChips = [
    ["化学原理", "水蒸气蒸馏的基本原理是什么？"],
    ["化学原理", "盐析（NH₄Cl）在精油提取中的作用？"],
    ["化学原理", "什么是乳化？如何判断分层是否清晰？"],
    ["生物实验", "大肠杆菌抑菌实验中为什么需要对照组？"],
    ["科学探究", "如何设计控制变量实验比较 NH₄Cl 浓度效果？"],
  ]
    .map(
      ([tag, q]) =>
        `<button class="llm-chip" onclick="fillQuestion('${q.replace(/'/g, "&#39;")}')" type="button"><span class="llm-chip-tag">${tag}</span>${q}</button>`,
    )
    .join("");
  const reviewChips = [
    ["数据分析", "为什么 4% NH₄Cl 组得率反而低于 3% 组？"],
    ["化学原理", "柠檬烯在水中溶解度低，为何能随蒸汽出来？"],
    ["生物实验", "抑菌圈大小可以直接比较不同浓度效果吗？"],
    ["数据分析", "我的得率偏高或偏低，可能原因？"],
    ["科学探究", "标准差较大说明什么？如何改善？"],
  ]
    .map(
      ([tag, q]) =>
        `<button class="llm-chip" onclick="fillQuestion('${q.replace(/'/g, "&#39;")}')" type="button"><span class="llm-chip-tag">${tag}</span>${q}</button>`,
    )
    .join("");
  const body = `<section class="hero hero-compact"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>AI Teaching Assistant · DeepSeek</div><h1 class="page-title">AI 教学辅助</h1><p class="lead">课前预习知识要点、课后答疑解惑、拓展探究思路。AI 实时回答你的化学实验与生物探究疑问。</p></div></section>
<section class="section wrap" id="scene-selector">
<div class="section-head"><div class="kicker">Learning Scenes</div><h2>选择学习场景</h2><p>根据你的学习阶段选择对应场景，AI 将调整回答策略以匹配你的需求。</p></div>
<div class="grid-3 llm-scene-grid">${sceneCards}</div>
<div class="llm-info-bar"><div class="card"><div class="kicker">Model</div><p>DeepSeek 大语言模型</p></div><div class="card"><div class="kicker">Scope</div><p>高中化学 · 生物实验 · 科学探究</p></div><div class="card"><div class="kicker">Features</div><p>多轮对话 · 场景化回答 · 启发式教学</p></div></div>
</section>
<section class="section wrap llm-chat-section" id="chat-area" style="display:none">
<div class="llm-chat-topbar"><button class="btn btn-secondary llm-back-btn" type="button" onclick="backToScenes()">← 切换场景</button><div class="llm-chat-title"><span class="kicker" id="chat-scene-label"></span></div><button class="btn btn-secondary llm-back-btn" type="button" onclick="clearChat()">清空对话</button></div>
<div class="card llm-chat-card">
<div id="llm-chips-area" class="llm-chips-row">${previewChips}</div>
<div id="chat-messages" class="llm-messages"></div>
</div>
<div class="llm-input-dock">
<form id="ask-form" class="llm-dock"><textarea id="question" class="llm-dock-input" placeholder="输入你的探究问题……" rows="1" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea><button class="llm-dock-btn" type="submit" id="llm-send-btn">↑</button></form>
<p class="llm-footer-note">由 DeepSeek 驱动 · 围绕高中化学与生物实验知识点给出启发式解析，不作临床或工业结论</p>
</div>
</section>
<script>
var _scenePrompts=${JSON.stringify(Object.fromEntries(scenes.map((s) => [s.id, s.id])))};
var _sceneLabels=${JSON.stringify(Object.fromEntries(scenes.map((s) => [s.id, s.label])))};
var _previewChips=${JSON.stringify(previewChips)};
var _reviewChips=${JSON.stringify(reviewChips)};
</script>`;
  return layout("AI 教学辅助", body, { session });
}
function curriculumPage(session) {
  const body = `
<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple">
  <div class="eyebrow"><span class="dot"></span>Curriculum Standards Mapping</div>
  <h1 class="page-title">课程标准映射</h1>
  <p class="lead">本页面将实验内容与中国高中课程标准进行系统映射，帮助教师快速定位知识点归属，便于备课、教研和课程设计参考。</p>
  <div class="page-actions"><a class="btn btn-primary" href="/">返回首页</a><a class="btn btn-secondary" href="/theme">主题页</a></div>
</div></section>

<section class="section wrap">
  <div class="section-head"><div class="kicker">Teaching Objectives</div><h2>教学目标声明</h2><p>基于三维目标体系，明确本实验探究课程的预期学习成果。</p></div>
  <div class="grid-3">
    <div class="card"><div class="icon blue">知</div><h3>知识与技能</h3><p>掌握水蒸气蒸馏、NH₄Cl 盐析分离、分液操作等基本实验技能；了解柠檬烯的分子结构、官能团与化学性质</p></div>
    <div class="card"><div class="icon orange">过</div><h3>过程与方法</h3><p>经历"提出问题—设计实验—变量控制—数据采集—证据分析—得出结论"的完整科学探究过程</p></div>
    <div class="card"><div class="icon green">素</div><h3>科学素养</h3><p>培养证据意识、批判思维、合作探究精神，理解科学结论的局限性与可修正性</p></div>
  </div>
</section>

<section class="section wrap">
  <div class="section-head"><div class="kicker">Knowledge Breakdown</div><h2>知识点拆解表</h2><p>按学科维度梳理本实验涉及的核心知识点。</p></div>
  <div class="grid-3">
    <div class="card"><div class="icon blue">化</div><h3>高中化学</h3>
      <p>• 分离提纯（蒸馏 / 分液 / 萃取）</p>
      <p>• NH₄Cl 电解质与盐析效应</p>
      <p>• 溶解度与溶液浓度计算</p>
      <p>• 乳化现象与表面活性剂</p>
      <p>• 控制变量法与实验方案设计</p>
      <p>• 绿色化学与可持续发展</p>
    </div>
    <div class="card"><div class="icon orange">生</div><h3>高中生物</h3>
      <p>• 微生物培养基本知识（E. coli）</p>
      <p>• 抑菌实验与纸片扩散法</p>
      <p>• 细胞膜结构与功能（磷脂双分子层）</p>
      <p>• 植物次生代谢产物（精油 / 萜烯）</p>
      <p>• 对照实验设计原则</p>
    </div>
    <div class="card"><div class="icon green">探</div><h3>科学探究素养</h3>
      <p>• 提出可验证的科学问题</p>
      <p>• 建立合理假设</p>
      <p>• 设计实验与控制变量</p>
      <p>• 规范采集和记录数据</p>
      <p>• 基于证据的分析与推理</p>
      <p>• 反思误差与改进方案</p>
      <p>• 撰写规范实验报告</p>
    </div>
  </div>
</section>

<section class="section wrap">
  <div class="section-head"><div class="kicker">Textbook Mapping</div><h2>教材映射</h2><p>将实验知识点对应到人教版高中教材的具体章节。</p></div>
  <div class="grid-2">
    <div class="card"><div class="icon blue">化</div><h3>人教版化学</h3>
      <p><strong>必修第一册</strong>：物质的分离与提纯 / 蒸馏 / 分液</p>
      <p><strong>必修第二册</strong>：有机化合物 / 烯烃 / 加成反应</p>
      <p><strong>选择性必修一</strong>：电解质溶液 / 盐类水解</p>
    </div>
    <div class="card"><div class="icon orange">生</div><h3>人教版生物</h3>
      <p><strong>必修一</strong>：分子与细胞 / 细胞膜结构 / 磷脂双分子层</p>
      <p><strong>选择性必修二</strong>：微生物培养与应用</p>
    </div>
  </div>
</section>

<section class="section wrap">
  <div class="section-head"><div class="kicker">AI-Powered Teaching Loop</div><h2>AI 赋能教学闭环</h2><p>利用 AI 技术实现个性化诊断、智能习题反馈和班级整体分析的教学闭环。</p></div>
  <div class="grid-3">
    <div class="card"><div class="icon blue">诊</div><h3>AI 个性化诊断</h3><p>学生提交数据后，DeepSeek 自动分析得率、分层、抑菌数据，给出针对性建议</p></div>
    <div class="card"><div class="icon orange">题</div><h3>AI 习题反馈</h3><p>答错后 AI 给出知识点解释，而非固定文本，实现差异化辅导</p></div>
    <div class="card"><div class="icon green">班</div><h3>AI 班级诊断</h3><p>汇总全班数据和习题情况，生成共性问题分析与教学建议</p></div>
  </div>
</section>`;
  return layout("课程标准映射", body, { session });
}

function reportPage(records, session, demo = false) {
  const data = demo ? DEMO_RECORDS : records;
  const analytics = analyticsFor(data);
  const best = highestObservedGroups(analytics.stats);
  const bestLabel = best.length
    ? `${best.map((group) => `${group.conc}%`).join("、")} NH₄Cl${best.length > 1 ? "（并列）" : ""}`
    : "暂无可比较数据";
  const bestDetail = best.length ? `平均得率 ${best[0].meanYield.toFixed(2)}%` : "无已纳入描述性比较的观测";
  const rows = analytics.stats
    .map(
      (s) =>
        `<tr><td>${s.conc}%</td><td>${s.count}</td><td>${s.count ? s.meanYield.toFixed(2) + "%" : "—"}</td><td>${s.count > 1 ? s.stdYield.toFixed(2) : "—"}</td><td>${s.count ? s.meanZone.toFixed(1) + " mm" : "—"}</td></tr>`,
    )
    .join("");
  const body = `<section class="hero"><div class="hero-grid"></div><div class="wrap hero-simple"><div class="eyebrow"><span class="dot"></span>Inquiry Report</div><h1 class="page-title">课堂探究报告</h1><p class="lead">整合实验数据、趋势图、规则诊断、教师复核状态和带局限说明的探索性解释。</p><div class="page-actions"><button class="btn btn-primary" onclick="window.print()">打印 / 另存为 PDF</button><a class="btn btn-secondary" href="/admin${demo ? "?demo=1" : ""}">返回教师端</a></div></div></section><section class="section wrap report-page"><div class="grid-3"><div class="card"><div class="kicker">提交记录</div><h3>${analytics.count}</h3><p>课堂数据总量</p></div><div class="card"><div class="kicker">疑似异常</div><h3>${analytics.reviewCount}</h3><p>建议教师复核</p></div><div class="card"><div class="kicker">已测均值较高组</div><h3>${bestLabel}</h3><p>${bestDetail}</p></div></div><div class="card" style="margin-top:24px"><h2>NH₄Cl 浓度—得率统计</h2><table><thead><tr><th>浓度</th><th>记录数</th><th>平均得率</th><th>标准差</th><th>平均抑菌圈</th></tr></thead><tbody>${rows}</tbody></table><p class="small">— 表示没有可比较观测；样本量小于 2 时不显示样本标准差。并列依据未四舍五入的描述性均值判断。</p></div><div class="grid-2" style="margin-top:24px"><div class="card">${trendSvg(data)}</div><div class="card dark-card">${decisionSummaryCard(data)}</div></div><div class="card" style="margin-top:24px"><h2>教学反馈建议</h2><p>当前数据可引导学生讨论 NH₄Cl 盐析对油水分层和精油得率的影响。对异常数据，建议从分层清晰度、乳化情况、称量误差和污染标记四个角度进行复核。抑菌观察部分应强调对照组和乳化剂对照组的意义，避免仅凭单次抑菌圈大小作出绝对结论。</p></div></section>`;
  return layout("课堂探究报告", body, { session });
}

export {
  DEMO_RECORDS,
  esc,
  nowIso,
  isDemo,
  recordsFor,
  yieldPercentFor,
  mean,
  stddev,
  groupStats,
  quadraticFit,
  recordDiagnostics,
  errorSource,
  analyticsFor,
  inhibitionGrade,
  trendSvg,
  homePage,
  themePage,
  demoPage,
  loginPage,
  studentPage,
  teacherPage,
  adminPage,
  practicePage,
  resourcesPage,
  llmPage,
  curriculumPage,
  reportPage,
};
