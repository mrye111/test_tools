// ═══════════════════════════════════════════════════════════
// 图型片段 F9 · From gross to net, step by step
// 数据契约：瀑布 / 增减分解（≤6 级）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C5 · rung waterfall ════
// 瀑布：从毛收入走到净利，每级一把小梯子。加项实档、减项空心档（stroke 描边格）。
// 层与层之间虚线台阶承接。
(()=>{
const D=[['GROSS',42,null],['REFUNDS',-6,null],['COGS',-11,null],['OPS',-8,null],['NET',17,'total']];
obsReveal('fall',s=>{
  const x0=i=>58+i*72,step=5.2,HW=11;
  let run=0;
  const levels=[];
  D.forEach(([name,v],i)=>{levels.push([name,v,run]);if(v!==17||name!=='NET')run+=(name==='GROSS'?v:(name==='NET'?0:v))});
  // recompute cleanly: running level after each step
  let lv=0;const rows=[];
  D.forEach(([name,v],i)=>{
    if(name==='GROSS'){rows.push([name,v,0,v]);lv=v}
    else if(name==='NET'){rows.push([name,lv,0,lv])}
    else{rows.push([name,v,lv+v,lv]);lv=lv+v}
  });
  const base=252,yOf=k=>base-k*step;
  rows.forEach(([name,v,lo,hi],i)=>{
    const x=x0(i),isTotal=name==='GROSS'||name==='NET',neg=v<0&&!isTotal;
    const from=isTotal?0:lo,to=isTotal?v:hi,n=Math.abs(to-from);
    for(let k=0;k<n;k++){
      const y=yOf(from+k),w=HW-1.2+rnd(k+1,i+2)*2.4;
      if(neg)el(s,'line',{x1:x-w,y1:y,x2:x+w,y2:y,stroke:'#8F8E88','stroke-width':1,
        'stroke-dasharray':'2.5 2.5',opacity:.7,class:'fade',
        style:`animation-delay:${i*.12+k*.014}s`});
      else el(s,'line',{x1:x-w,y1:y,x2:x+w,y2:y,stroke:INK,'stroke-width':1,
        opacity:.6+rnd(k+2,i+4)*.4,class:'fade',style:`animation-delay:${i*.12+k*.014}s`});
    }
    // step hand-off: dashed hairline to the next column's start level
    if(i<rows.length-1){
      const nx=x0(i+1),yl=yOf(isTotal?v:hi- (neg?0:0));
      const lvl=isTotal?v:(neg?lo:hi);
      el(s,'line',{x1:x+HW+2,y1:yOf(lvl),x2:nx-HW-2,y2:yOf(lvl),stroke:'#C6C5BF',
        'stroke-width':.7,'stroke-dasharray':'2 3',class:'fade',
        style:`animation-delay:${.3+i*.12}s`});
    }
    const topY=yOf(Math.max(from,to));
    const num=txt(s,{x,y:topY-8,'font-size':10,'font-weight':800,
      fill:neg?'#8F8E88':INK,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.4+i*.12}s`},(neg?'−':'')+Math.abs(v));
    tip(num,`${name} — ${neg?'−':''}$${Math.abs(v)}k`);
    txt(s,{x,y:base+18,'font-size':7.5,'font-weight':700,fill:MUTED,'text-anchor':'middle',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.12}s`},name);
  });
  el(s,'line',{x1:30,y1:base+4,x2:370,y2:base+4,stroke:GRID,'stroke-width':.8,class:'fade'});
  txt(s,{x:200,y:302,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.2s'},
    'SOLID RUNGS ADD · DASHED RUNGS TAKE AWAY · ONE RUNG = $1K');
});
})();
