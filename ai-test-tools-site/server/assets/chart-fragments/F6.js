// ═══════════════════════════════════════════════════════════
// 图型片段 F6 · Paired Columns 并柱对比（重绘版 · 全出血）
// 数据契约：分组对比，每类 2 系列（本轮 vs 上轮）。viewBox 1080 宽。
// 形式依据：「一支是主角、其余是语境」→ emphasis（1 色 + 灰），不是 categorical 双色。
// 标记规格：柱厚 24px；同组两柱之间 2px 表面间隙，不描边；数据端圆角、基线端方角。
// 文字一律穿墨色 token。≥2 系列必出图例。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[[名称, 上轮, 本轮], …]，≤8 行）。
(()=>{
const D=__DATA__;
obsReveal('pairrungs',s=>{
  const BASE=292,BW=24,GAP=2,MAX=40,PLOT=210;
  const STEP=BW*2+GAP+34;                 // 组内 24+2+24，组间再留 34
  const X=i=>(1080-(D.length-1)*STEP-BW*2-GAP)/2+i*STEP;
  const py=v=>BASE-v/MAX*PLOT;
  for(let t=0;t<=MAX;t+=10){
    el(s,'line',{x1:60,y1:py(t),x2:1020,y2:py(t),stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.02}s`});
    txt(s,{x:46,y:py(t)+5,'font-size':12,fill:FAINT,'text-anchor':'end',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${t*.02}s`},t);
  }
  D.forEach(([name,was,now],i)=>{
    const xa=X(i),xb=xa+BW+GAP;
    // 语境（上轮）在左，主角（本轮）在右
    const pa=el(s,'path',{d:barV(xa,py(was),BW,BASE-py(was)),fill:STATUS.mute,
      class:'fade',style:`animation-delay:${.1+i*.08}s`});
    const pb=el(s,'path',{d:barV(xb,py(now),BW,BASE-py(now)),fill:INK,
      class:'fade',style:`animation-delay:${.2+i*.08}s`});
    tip(pa,`${name} — 上轮 ${was} 条`);
    tip(pb,`${name} — 本轮 ${now} 条`);
    txt(s,{x:xa+BW/2,y:py(was)-12,'font-size':14,fill:MUTED,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.3+i*.08}s`},was);
    txt(s,{x:xb+BW/2,y:py(now)-14,'font-size':18,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.35+i*.08}s`},now);
    txt(s,{x:xa+BW+GAP/2,y:BASE+30,'font-size':14,fill:MUTED,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.4+i*.08}s`},name);
  });
  // 图例：2 系列必出；文字穿墨色，靠色块承载身份
  const LY=BASE+74;
  [[STATUS.mute,'上轮','语境'],[INK,'本轮','主角']].forEach(([c,k,note],i)=>{
    const lx=60+i*220;
    el(s,'rect',{x:lx,y:LY-11,width:12,height:12,rx:2,fill:c,
      class:'fade',style:`animation-delay:${.7+i*.05}s`});
    txt(s,{x:lx+22,y:LY,'font-size':14,fill:INK,class:'fade',style:`animation-delay:${.7+i*.05}s`},k);
    txt(s,{x:lx+22+k.length*15+10,y:LY,'font-size':12,fill:MUTED,
      class:'fade',style:`animation-delay:${.7+i*.05}s`},note);
  });
  txt(s,{x:600,y:LY,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.8s'},'纵轴 = 用例数（条）· 1 色 + 灰 = emphasis');
});
})();
