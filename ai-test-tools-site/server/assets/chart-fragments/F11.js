// ═══════════════════════════════════════════════════════════
// 图型片段 F11 · How far to the quarter's goal
// 数据契约：单值进度（0–100%）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C7 · tick gauge ════
// 进度：ballot tick 弯成 210° 表盘，1 tick = 1% 目标。走到 73 上墨收笔。
// 里程碑 25/50/75/100 点标 + 小字。中心大数 + 剩余量小字。
(()=>{
const GOAL=73;
obsReveal('gauge',s=>{
  const cx=200,cy=190,R0=104,A0=-195,SW=210; // -195° → +15°
  for(let k=0;k<100;k++){
    const a=A0+k/100*SW,inked=k<GOAL;
    const len=inked?13+rnd(k+1,3)*6:5+rnd(k+1,7)*2.5;
    const [x1,y1]=pol(cx,cy,R0,a),[x2,y2]=pol(cx,cy,R0+len,a);
    el(s,'line',{x1,y1,x2,y2,stroke:inked?INK:'#CFCEC7','stroke-width':inked?1:.6,
      class:'fade',style:`animation-delay:${k*.012}s`});
  }
  [25,50,75,100].forEach(m=>{
    const a=A0+m/100*SW,[dx,dy]=pol(cx,cy,R0-7,a),[tx2,ty2]=pol(cx,cy,R0-19,a);
    el(s,'circle',{cx:dx,cy:dy,r:1,fill:'#B0AFA9',class:'fade',style:'animation-delay:.8s'});
    txt(s,{x:tx2,y:ty2+3,'font-size':7,'font-weight':600,fill:'#C6C5BF','text-anchor':'middle',
      class:'fade',style:'animation-delay:.85s'},m);
  });
  // inked tip bead
  const aT=A0+GOAL/100*SW,[ex,ey]=pol(cx,cy,R0+20,aT);
  el(s,'circle',{cx:ex,cy:ey,r:2.4,fill:INK,class:'pop',style:'animation-delay:1.1s'});
  const num=txt(s,{x:cx,y:cy-4,'font-size':34,'font-weight':800,fill:INK,'text-anchor':'middle',
    class:'fade',style:'animation-delay:1s'},GOAL+'%');
  tip(num,`$730k of the $1M quarter target`);
  txt(s,{x:cx,y:cy+16,'font-size':8,'font-weight':600,fill:MUTED,'text-anchor':'middle',
    'letter-spacing':'.1em',class:'fade',style:'animation-delay:1.05s'},'27 TICKS TO GO');
  txt(s,{x:200,y:300,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.2s'},
    'ONE TICK = 1% OF TARGET · INKED = EARNED');
});
})();
