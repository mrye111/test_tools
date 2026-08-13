// ═══════════════════════════════════════════════════════════
// 图型片段 F6 · This year against last, plan by plan
// 数据契约：分组对比（每类 2 系列，如今昔）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C2 · paired rungs ════
// 分组柱：每类两把梯子并肩，今年实档、去年淡档。差值一眼可数。
(()=>{
const D=[['FREE',31,38],['STARTER',22,27],['PRO',16,22],['TEAM',13,16],['ENT',6,9]];
obsReveal('pairrungs',s=>{
  const x0=i=>64+i*66,base=258,step=5.4,HW=10;
  D.forEach(([name,was,now],i)=>{
    const xa=x0(i)-13,xb=x0(i)+13;
    for(let k=0;k<was;k++){
      const y=base-k*step,w=HW-1.2+rnd(k+1,i+2)*2.4;
      el(s,'line',{x1:xa-w,y1:y,x2:xa+w,y2:y,stroke:'#B0AFA9','stroke-width':1,
        opacity:.5+rnd(k+2,i+3)*.4,class:'fade',style:`animation-delay:${i*.08+k*.01}s`});
    }
    for(let k=0;k<now;k++){
      const y=base-k*step,w=HW-1.2+rnd(k+1,i+7)*2.4;
      el(s,'line',{x1:xb-w,y1:y,x2:xb+w,y2:y,stroke:INK,'stroke-width':1,
        opacity:.6+rnd(k+2,i+8)*.4,class:'fade',style:`animation-delay:${.15+i*.08+k*.01}s`});
    }
    const topB=base-(now-1)*step;
    const num=txt(s,{x:xb,y:topB-9,'font-size':10.5,'font-weight':800,fill:INK,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.5+i*.08}s`},now);
    tip(num,`${name} — $${was}k → $${now}k`);
    txt(s,{x:xa,y:base-(was-1)*step-9,'font-size':8.5,'font-weight':700,fill:'#B0AFA9','text-anchor':'middle',
      class:'fade',style:`animation-delay:${.5+i*.08}s`},was);
    txt(s,{x:x0(i),y:base+18,'font-size':7.5,'font-weight':700,fill:MUTED,'text-anchor':'middle',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.08}s`},name);
  });
  el(s,'line',{x1:30,y1:base+4,x2:370,y2:base+4,stroke:GRID,'stroke-width':.8,class:'fade'});
  txt(s,{x:200,y:306,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1s'},
    'FAINT = 2025 · INK = 2026 · ONE RUNG = $1K');
});
})();
