// ═══════════════════════════════════════════════════════════
// 图型片段 F10 · Dot Heat 点阵热力（重绘版 · 全出血）
// 数据契约：星期 × 小时 × 量（小热力）。viewBox 1080 宽。
// 形式依据：网格里的量 → 热力。这里用**点面积**编码（1 点 = 可读的量），
//           密度走灰阶明度阶梯，不上彩虹、不用色相做连续量。
// 标记规格：点 ≥8px 才可点（r≥4）；静默格留一粒极小点，让「沉默可见」。
// emphasis：峰值格加一圈环。文字一律穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{days:[…], cells:[[…],…]}，7 行 × 12 列）。
(()=>{
const DAY=__DATA__.days,CELLS=__DATA__.cells;
obsReveal('dotheat',s=>{
  const X0=150,DX=72,Y0=72,DY=38;
  const v=(i,j)=>CELLS[i][j];
  let max=0,mi=0,mj=0;
  for(let i=0;i<DAY.length;i++)for(let j=0;j<CELLS[i].length;j++){const t=v(i,j);if(t>max){max=t;mi=i;mj=j}}
  for(let i=0;i<7;i++){
    txt(s,{x:X0-26,y:Y0+i*DY+5,'font-size':13,fill:MUTED,'text-anchor':'end',
      class:'fade',style:`animation-delay:${i*.05}s`},DAY[i]);
    for(let j=0;j<12;j++){
      const t=v(i,j),x=X0+j*DX,y=Y0+i*DY;
      if(!t){el(s,'circle',{cx:x,cy:y,r:2,fill:'#D8D6CE',
        class:'pop',style:`animation-delay:${i*.05+j*.015}s`});continue}
      // 面积编码用 sqrt 换算半径：数值与视觉严格成正比
      const r=4+Math.sqrt(t)*5.2;
      const dot=el(s,'circle',{cx:x,cy:y,r,
        fill:t>max*.66?INK:t>max*.33?'#6A6963':'#B0AFA9',
        class:'pop',style:`animation-delay:${i*.05+j*.015}s`});
      tip(dot,`${DAY[i]} ${8+j}:00 — ${t} 个缺陷`);
      if(i===mi&&j===mj)
        el(s,'circle',{cx:x,cy:y,r:r+7,fill:'none',stroke:INK,'stroke-width':1.5,
          'stroke-dasharray':'4 4',class:'fade',style:'animation-delay:1s'});
    }
  }
  for(let j=0;j<12;j+=2)
    txt(s,{x:X0+j*DX,y:Y0+6*DY+34,'font-size':12,fill:FAINT,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${j*.02}s`},(8+j)+':00');
  // 明度/面积标尺：连续量必须配 scale legend
  const LY=Y0+6*DY+82;
  txt(s,{x:150,y:LY+5,'font-size':12,fill:MUTED,class:'fade',style:'animation-delay:.8s'},'少');
  [['#B0AFA9',4],['#6A6963',8],['INK',12]].forEach(([c,r],k)=>{
    el(s,'circle',{cx:200+k*70,cy:LY,r,fill:c,class:'fade',style:`animation-delay:${.8+k*.05}s`});
    txt(s,{x:200+k*70,y:LY+34,'font-size':11,fill:FAINT,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.8+k*.05}s`},{4:'轻',8:'中',12:'重'}[r]);
  });
  txt(s,{x:440,y:LY+5,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.95s'},
    `点面积 = 缺陷数 · 虚线圈 = 峰值 ${max} · 极小点 = 静默时段`);
});
})();
