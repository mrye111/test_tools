// ═══════════════════════════════════════════════════════════
// 图型片段 F2 · Emphasis Lines 焦点折线（重绘版 · 全出血）
// 数据契约：日序列（≤30 天，逐日读数）；1–2 系列同单位，共用一根纵轴。
// 形式依据：变化趋势 → 折线；「一支是主角、其余是语境」→ emphasis（1 色 + 灰）。
//           绝不双轴 —— 两个量纲不同就拆成两张图，别发明相关性。
// 标记规格：线 2px；端点 r=4（≥8px）+ 2px 表面环；hover 命中区放大到 r=12。
// 直标只给峰值与两端，不给每个点写数字。文字穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{days:[…], add:[…], close:[…]}，≤30 天）。
(()=>{
const DAYS=__DATA__.days,ADD=__DATA__.add,CLOSE=__DATA__.close;
obsReveal('dayline',s=>{
  const X0=90,X1=980,Y0=50,Y1=250,YMAX=7;
  const px=i=>X0+(i/(DAYS.length-1))*(X1-X0);
  const py=v=>Y1-(v/YMAX)*(Y1-Y0);

  // 发丝网格：实线、1px、退让。虚线只留给阈值。
  [0,2,4,6].forEach(t=>{
    el(s,'line',{x1:X0,y1:py(t),x2:X1,y2:py(t),stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.03}s`});
    txt(s,{x:X0-18,y:py(t)+5,'font-size':12,fill:FAINT,'text-anchor':'end',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${t*.03}s`},t);
  });
  txt(s,{x:X0-18,y:Y0-18,'font-size':11,fill:FAINT,'text-anchor':'end','letter-spacing':'.12em',
    class:'fade'},'个 / 日');
  DAYS.forEach((d,i)=>{
    txt(s,{x:px(i),y:Y1+28,'font-size':12,fill:FAINT,'text-anchor':'middle',
      'letter-spacing':'.04em','font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${i*.02}s`},d);
  });

  const poly=arr=>arr.map((v,i)=>`${px(i)},${py(v)}`).join(' ');
  // 语境线（去强调灰）在下，主角线（墨）在上
  el(s,'polyline',{points:poly(CLOSE),fill:'none',stroke:STATUS.mute,'stroke-width':2,
    'stroke-linejoin':'round','stroke-linecap':'round',class:'fade',style:'animation-delay:.2s'});
  el(s,'polyline',{points:poly(ADD),fill:'none',stroke:INK,'stroke-width':2,
    'stroke-linejoin':'round','stroke-linecap':'round',class:'fade',style:'animation-delay:.35s'});

  // 端点：≥8px + 2px 表面环；命中区 r=12（规范要求 hover 目标大于标记本身）
  [[ADD,INK,'新增'],[CLOSE,STATUS.mute,'关闭']].forEach(([arr,c,name])=>{
    arr.forEach((v,i)=>{
      const g=el(s,'g',{});
      el(g,'circle',{cx:px(i),cy:py(v),r:4,fill:c,stroke:PAPER,'stroke-width':2,
        class:'pop',style:`animation-delay:${.4+i*.025}s`});
      el(g,'circle',{cx:px(i),cy:py(v),r:12,fill:'transparent'});
      tip(g,`${DAYS[i]} · ${name} ${v} 个`);
    });
  });

  // 直标：只给峰值与两端
  const peak=ADD.indexOf(Math.max(...ADD));
  el(s,'line',{x1:px(peak),y1:py(ADD[peak])-12,x2:px(peak),y2:py(ADD[peak])-32,
    stroke:STATUS.crit,'stroke-width':1.5,class:'fade',style:'animation-delay:.7s'});
  txt(s,{x:px(peak),y:py(ADD[peak])-42,'font-size':16,'font-weight':700,fill:INK,
    'text-anchor':'middle',class:'fade',style:'animation-delay:.75s'},`峰值 ${ADD[peak]}`);
  txt(s,{x:px(DAYS.length-1)+6,y:py(ADD[ADD.length-1])-14,'font-size':13,'font-weight':600,
    fill:INK,class:'fade',style:'animation-delay:.8s'},'新增');
  txt(s,{x:px(DAYS.length-1)+6,y:py(CLOSE[CLOSE.length-1])+20,'font-size':13,'font-weight':600,
    fill:MUTED,class:'fade',style:'animation-delay:.8s'},'关闭');

  // ≥2 系列必出图例；单系列不设图例框（标题已说明画的是什么）
  const LY=310;
  [[INK,'每日新增缺陷','本轮主角'],[STATUS.mute,'每日关闭缺陷','语境 · 滞后约 2 天']].forEach(([c,k,note],i)=>{
    const lx=i*300;
    el(s,'line',{x1:lx,y1:LY-1,x2:lx+22,y2:LY-1,stroke:c,'stroke-width':3,
      'stroke-linecap':'round',class:'fade',style:`animation-delay:${.85+i*.05}s`});
    txt(s,{x:lx+34,y:LY+4,'font-size':14,fill:INK,class:'fade',style:`animation-delay:${.85+i*.05}s`},k);
    txt(s,{x:lx+34+k.length*15+12,y:LY+4,'font-size':12,fill:MUTED,
      class:'fade',style:`animation-delay:${.85+i*.05}s`},note);
  });
});
})();
