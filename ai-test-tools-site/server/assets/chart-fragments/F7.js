// ═══════════════════════════════════════════════════════════
// 图型片段 F7 · Where each region's revenue sits
// 数据契约：堆叠构成（≤4 类 × ≤3 段）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C3 · stacked rungs ════
// 堆叠柱：同一把梯子分三段灰阶，段间空一格呼吸，段值贴段中。
(()=>{
const D=[['NA',[18,11,7]],['EU',[14,9,5]],['APAC',[9,7,6]],['LATAM',[5,4,2]]];
const SHADE=[INK,'#8F8E88','#C0BFB8'];
const SEG=['CORE','ADD-ONS','SERVICES'];
obsReveal('stackrungs',s=>{
  const x0=i=>72+i*76,base=262,step=5.2,HW=13;
  D.forEach(([name,segs],i)=>{
    const x=x0(i);let k0=0;
    segs.forEach((v,si)=>{
      for(let k=0;k<v;k++){
        const y=base-(k0+k+si)*step,w=HW-1.4+rnd(k+1,i*3+si+2)*2.8;
        el(s,'line',{x1:x-w,y1:y,x2:x+w,y2:y,stroke:SHADE[si],'stroke-width':1,
          opacity:.6+rnd(k+2,i+si+4)*.4,class:'fade',
          style:`animation-delay:${i*.09+(k0+k)*.012}s`});
      }
      const midY=base-(k0+v/2+si)*step;
      const lab=txt(s,{x:x+HW+7,y:midY+2.5,'font-size':8,'font-weight':800,fill:SHADE[si]===`#C0BFB8`?'#8F8E88':SHADE[si],
        class:'fade',style:`animation-delay:${.5+i*.09+si*.06}s`},v);
      tip(lab,`${name} ${SEG[si]} — $${v}k`);
      k0+=v;
    });
    const total=segs[0]+segs[1]+segs[2];
    txt(s,{x,y:base-(k0+2)*step-8,'font-size':10.5,'font-weight':800,fill:INK,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.6+i*.09}s`},total);
    txt(s,{x,y:base+18,'font-size':7.5,'font-weight':700,fill:MUTED,'text-anchor':'middle',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.09}s`},name);
  });
  el(s,'line',{x1:36,y1:base+4,x2:364,y2:base+4,stroke:GRID,'stroke-width':.8,class:'fade'});
  txt(s,{x:200,y:306,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.1s'},
    'DARKEST = CORE · MID = ADD-ONS · PALE = SERVICES · ONE RUNG = $1K');
});
})();
