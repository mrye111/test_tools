// ═══════════════════════════════════════════════════════════
// 图型片段 L3 · Barcode Lollipop 条码棒棒糖（重绘版 · 全出血）
// 数据契约：每天一个读数的日序列（90 天级，要肌理）。viewBox 1080 宽。
// 形式依据：变化趋势 + 要「日历肌理」→ 条码地板（每天一根发丝，无论有没有事）
//           + 棒棒糖读数。日历地板让序列不被误读成连续均匀间隔。
// 标记规格：线 2px；端点 r≥4 + 2px 表面环；直标只给峰值（本图取前 3，且互相隔开）。
// 文字一律穿墨色 token，绝不穿数据色。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[每日读数, …]，90 天级）。
(()=>{
const vs=__DATA__;
const N=vs.length;
obsReveal('barcode',s=>{
  const X0=40,DX=(1040-40)/(N-1),BASE=280,SCALE=.75;
  // 条码地板：每天一根发丝，无论有没有事
  for(let d=0;d<N;d++){
    const x=X0+d*DX;
    el(s,'line',{x1:x,y1:20,x2:x,y2:BASE,stroke:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${d*.004}s`});
  }
  el(s,'line',{x1:40,y1:BASE,x2:1040,y2:BASE,stroke:INK,'stroke-width':1,class:'fade'});
  // 前 3 峰值，且互相至少隔 6 天，保证标签不撞
  const top=[];
  for(const d of [...vs.keys()].sort((a,b)=>vs[b]-vs[a])){
    if(top.every(t=>Math.abs(t-d)>=6))top.push(d);
    if(top.length===3)break;
  }
  for(let d=0;d<N;d++){
    const x=X0+d*DX,v=vs[d],y=BASE-v*SCALE;
    const weekend=d%7===5||d%7===6,big=top.includes(d);
    // 棒
    el(s,'line',{x1:x,y1:y,x2:x,y2:BASE,stroke:INK,'stroke-width':2,
      class:'fade',style:`animation-delay:${.25+d*.007}s`});
    // 棒糖头：≥8px + 2px 表面环；周末空心（次要编码，不靠颜色）
    const dot=el(s,'circle',{cx:x,cy:y,r:big?6:4,
      fill:weekend?PAPER:INK,stroke:INK,'stroke-width':weekend?2:0,
      class:'pop',style:`animation-delay:${.25+d*.007}s`});
    tip(dot,`第 ${d+1} 天 — 执行 ${Math.round(v)} 条`);
    if(big)txt(s,{x,y:y-16,'font-size':15,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',
      style:`paint-order:stroke;stroke:${PAPER};stroke-width:4px`,
      class:'fade',style:`animation-delay:${.8+d*.004}s`},Math.round(v));
  }
  [[0,'第 1 天'],[30,'第 31 天'],[60,'第 61 天'],[89,'第 90 天']].forEach(([d,m])=>
    txt(s,{x:X0+d*DX,y:BASE+34,'font-size':13,fill:MUTED,'text-anchor':'middle',
      class:'fade'},m));
  txt(s,{x:40,y:BASE+74,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:1.1s'},
    '纵轴 = 执行量（条）· 地板发丝 = 每一天 · 空心头 = 周末 · 只标前 3 峰值');
});
})();
