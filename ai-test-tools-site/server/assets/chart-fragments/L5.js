// ═══════════════════════════════════════════════════════════
// 图型片段 L5 · 48 requests pull toward five themes
// 数据契约：多对一归属，不丢明细（≤60 条）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ 5 · radial convergence ════
(()=>{
const N=48,CX=200,CY=162,R=116;
const THEME=[['PERF',15,-75],['INTEGRATIONS',10,-3],['PRICING',9,69],['MOBILE',8,141],['UX',6,213]];
obsReveal('converge',s=>{
  // hub assignment: contiguous blocks with a little organic leakage
  const blocks=THEME.flatMap(([,n],h)=>Array(n).fill(h));
  const hubOf=i=>rnd(i+1,11)>.92?(blocks[i]+2)%5:blocks[i];
  const hubPt=h=>pol(CX,CY,34,THEME[h][2]);
  const counts=[0,0,0,0,0];
  for(let i=0;i<N;i++)counts[hubOf(i)]++;
  for(let i=0;i<N;i++){
    const deg=i/N*360-90,[px,py]=pol(CX,CY,R,deg);
    const h=hubOf(i),[hx,hy]=hubPt(h);
    const c1x=CX+(px-CX)*.42,c1y=CY+(py-CY)*.42;
    const c2x=CX+(hx-CX)*.3,c2y=CY+(hy-CY)*.3;
    el(s,'path',{d:`M${px} ${py} C${c1x} ${c1y} ${c2x} ${c2y} ${hx} ${hy}`,
      fill:'none',stroke:'#A8A7A0','stroke-width':.7,opacity:.55,pathLength:1,
      class:'draw',style:`animation-delay:${i*.018}s`});
    el(s,'circle',{cx:px,cy:py,r:1.6,fill:'#6A6963',
      class:'pop',style:`animation-delay:${i*.018}s`});
    // tiny rim code, flipped on the left half so it stays readable
    const flip=deg>90&&deg<270,[lx,ly]=pol(CX,CY,R+7,deg);
    txt(s,{x:lx,y:ly,'font-size':5.5,fill:MUTED,
      'text-anchor':flip?'end':'start','dominant-baseline':'middle',
      transform:`rotate(${flip?deg+180:deg} ${lx} ${ly})`,
      class:'fade',style:`animation-delay:${.2+i*.01}s`},'R-'+String(i+1).padStart(2,'0'));
  }
  THEME.forEach(([name,,deg],h)=>{
    const [hx,hy]=hubPt(h);
    const hub=el(s,'circle',{cx:hx,cy:hy,r:Math.sqrt(counts[h])*1.55,fill:INK,
      class:'pop',style:`animation-delay:${.5+h*.08}s`});
    tip(hub,`${name} — ${counts[h]} requests`);
    // theme label parked outside the rim, past the code ring
    const [tx,ty]=pol(CX,CY,R+34,deg);
    txt(s,{x:tx,y:ty,'font-size':8,'font-weight':800,fill:INK,'text-anchor':'middle',
      'dominant-baseline':'middle','letter-spacing':'.08em',
      style:`animation-delay:${.6+h*.08}s`,
      class:'fade'},`${name} · ${counts[h]}`);
    // hairline tying the label to its hub, skimming past the rim
    const [gx,gy]=pol(CX,CY,R+22,deg);
    el(s,'line',{x1:hx,y1:hy,x2:gx,y2:gy,stroke:'#C6C5BF','stroke-width':.7,
      'stroke-dasharray':'1 3',class:'fade',style:`animation-delay:${.7+h*.08}s`});
  });
});
})();
