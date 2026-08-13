// ═══════════════════════════════════════════════════════════
// 图型片段 F1 · Revenue by plan, rung by rung
// 数据契约：少类目比较（≤8），单位可数；1 档 = 1 个诚实单位
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ B1 · rung bars ════
// 柱状图的 Lupi 化：柱身 = 一格格横档，1 档 = 1 个诚实单位。
// 远看是柱状图剪影，近看每一档都数得出来。档长、透明度 rnd 抖动。
(()=>{
const D=[['FREE',38],['STARTER',27],['PRO',22],['TEAM',16],['SCALE',11],['ENT',7]];
obsReveal('rungs',s=>{
  const x0=i=>56+i*56,base=266,step=5.6,HW=14;
  D.forEach(([name,v],i)=>{
    const x=x0(i);
    for(let k=0;k<v;k++){
      const y=base-k*step,w=HW-1.5+rnd(k+1,i+2)*3;
      el(s,'line',{x1:x-w,y1:y,x2:x+w,y2:y,stroke:INK,'stroke-width':1,
        opacity:.5+rnd(k+2,i+4)*.5,class:'fade',style:`animation-delay:${i*.08+k*.012}s`});
      if(k%5===4)el(s,'circle',{cx:x+HW+4.5,cy:y,r:.8,fill:'#C6C5BF',
        class:'fade',style:`animation-delay:${i*.08+k*.012}s`});
    }
    const topY=base-(v-1)*step;
    const num=txt(s,{x,y:topY-10,'font-size':11,'font-weight':800,fill:INK,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.4+i*.08}s`},v);
    tip(num,`${name} — $${v}k MRR`);
    txt(s,{x,y:base+18,'font-size':7.5,'font-weight':700,fill:MUTED,'text-anchor':'middle',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.08}s`},name);
  });
  el(s,'line',{x1:28,y1:base+4,x2:372,y2:base+4,stroke:GRID,'stroke-width':.8,class:'fade'});
  txt(s,{x:200,y:306,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:.9s'},
    'ONE RUNG = $1K · DOT MARKS EVERY FIFTH');
});
})();
