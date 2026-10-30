// ═══════════════════════════════════════════════════════════
// 图型片段 F7 · Stacked Columns 堆叠柱（重绘版 · 全出血）
// 数据契约：堆叠构成（≤4 类 × ≤3 段）。viewBox 1080 宽。
// 形式依据：part-to-whole 且要按类目拆 → 堆叠柱。段是**状态**时用 STATUS 三色，
//           段序固定 通过 | 阻塞 | 失败（绿红不得相邻）；段是量/序时改用灰阶明度。
// 标记规格：柱厚 24px；段与段之间 2px 表面间隙、不描边（靠白缝分段，不描轮廓）。
// 段内直标只在放得下时给。文字一律穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON
//   {rows:[[类目,[段1,段2,段3]],…]（≤4 类）, segs:[[段名, 色键],…]（≤3 段）}
// 色键 ∈ good|warn|crit|mute|ink|mid|pale；**数据里不带颜色字面量**，色值一律由 token 取。
(()=>{
const D=__DATA__.rows;
const TONE={good:STATUS.good,warn:STATUS.warn,crit:STATUS.crit,mute:STATUS.mute,ink:INK,mid:'#8F8E88',pale:'#C6C5BF'};
const SEG=__DATA__.segs.map(([n,k])=>[n,TONE[k]||STATUS.mute]);
obsReveal('stackrungs',s=>{
  const BASE=300,BW=24,GAP=2,MAX=55,PLOT=220;
  const X=i=>(1080-(D.length-1)*180-BW)/2+i*180;
  const py=v=>BASE-v/MAX*PLOT;
  for(let t=0;t<=50;t+=10){
    el(s,'line',{x1:80,y1:py(t),x2:1000,y2:py(t),stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.02}s`});
    txt(s,{x:66,y:py(t)+5,'font-size':12,fill:FAINT,'text-anchor':'end',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${t*.02}s`},t);
  }
  D.forEach(([name,segs],i)=>{
    const x=X(i);let acc=0;
    segs.forEach((v,si)=>{
      if(v<=0){acc+=v;return}
      const h=py(acc)-py(acc+v)-GAP;      // 段间 2px 表面间隙
      const y=py(acc+v);
      const p=el(s,'path',{d:barV(x,y,BW,Math.max(h,2),si===segs.length-1?4:0),fill:SEG[si][1],
        class:'fade',style:`animation-delay:${.1+(i*3+si)*.05}s`});
      tip(p,`${name} ${SEG[si][0]} — ${v} 条`);
      // 段内直标：放得下（≥28px 高）才给，文字按填充明度取纸/墨
      if(h>=28){
        const pale=SEG[si][1]===STATUS.mute||SEG[si][1]===STATUS.warn;
        txt(s,{x:x+BW/2,y:y+h/2,'font-size':13,'font-weight':600,'text-anchor':'middle',
          'dominant-baseline':'central',fill:pale?INK:PAPER,'font-variant-numeric':'tabular-nums',
          class:'fade',style:`animation-delay:${.3+(i*3+si)*.05}s`},v);
      }
      acc+=v;
    });
    txt(s,{x:x+BW/2,y:py(acc)-14,'font-size':18,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.4+i*.08}s`},acc);
    txt(s,{x:x+BW/2,y:BASE+30,'font-size':14,fill:MUTED,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.45+i*.08}s`},name);
  });
  // 图例：状态色必配 icon + label；文字穿墨色 token
  const LY=BASE+74;
  SEG.forEach(([k,c],i)=>{
    const lx=80+i*200;
    el(s,'rect',{x:lx,y:LY-11,width:12,height:12,rx:2,fill:c,
      class:'fade',style:`animation-delay:${.7+i*.05}s`});
    txt(s,{x:lx+22,y:LY,'font-size':14,fill:INK,class:'fade',style:`animation-delay:${.7+i*.05}s`},k);
  });
  txt(s,{x:700,y:LY,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.85s'},'纵轴 = 用例数（条）· 段序 通过 | 阻塞 | 失败');
});
})();
