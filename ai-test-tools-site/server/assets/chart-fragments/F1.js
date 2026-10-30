// ═══════════════════════════════════════════════════════════
// 图型片段 F1 · Columns 竖柱（重绘版 · 全出血）
// 数据契约：少类目比较（≤8），单位可数。viewBox 1080 宽，字号即最终渲染字号。
// 形式依据：比较量级 → 柱状。名义类目 → 每根同一个色（单系列不设图例框，
//           标题已说明画的是什么）；**严禁「越大越深」的值色阶** —— 那是把
//           条长再编码一遍，白烧唯一的空闲通道。
// 标记规格：柱厚 24px（≤24，留白给带宽）；数据端（上）4px 圆角、基线端（下）方角。
// 文字一律穿墨色 token，绝不穿数据色。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[[名称, 值], …]，≤8 行）。
(()=>{
const D=__DATA__;
obsReveal('rungs',s=>{
  const BASE=300,BW=24,MAX=40,PLOT=220;
  const X=i=>(1080-(D.length-1)*150-BW)/2+i*150;
  const py=v=>BASE-v/MAX*PLOT;
  // 发丝网格：实线、1px、退让
  for(let t=0;t<=MAX;t+=10){
    el(s,'line',{x1:70,y1:py(t),x2:1010,y2:py(t),stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.02}s`});
    txt(s,{x:56,y:py(t)+5,'font-size':12,fill:FAINT,'text-anchor':'end',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${t*.02}s`},t);
  }
  D.forEach(([name,v],i)=>{
    const x=X(i),h=BASE-py(v);
    const p=el(s,'path',{d:barV(x,py(v),BW,h),fill:INK,
      class:'fade',style:`animation-delay:${.1+i*.08}s`});
    tip(p,`${name} — ${v} 条用例`);
    // 柱顶标值（不是逐点铺数：每柱一个）
    txt(s,{x:x+BW/2,y:py(v)-14,'font-size':18,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.25+i*.08}s`},v);
    txt(s,{x:x+BW/2,y:BASE+30,'font-size':14,fill:MUTED,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.3+i*.08}s`},name);
  });
  txt(s,{x:70,y:BASE+74,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.7s'},'纵轴 = 用例数（条）· 单系列同一墨色，不用值色阶');
});
})();
