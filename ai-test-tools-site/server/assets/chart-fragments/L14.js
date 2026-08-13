// ═══════════════════════════════════════════════════════════
// 图型片段 L14 · A hundred of us, four minds
// 数据契约：100% 构成（占比），≤6 类小数据；1 点 = 1 单位
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ 14 · hundred field ════
// small data, unit-decomposed: four shares of 100% become 100 people.
// phyllotaxis discs (golden angle) so每簇自带肌理; share is countable, not just readable.
(()=>{
const SEG=[['CHARGED',41,INK],['TORN',35,'#55554F'],['ADRIFT',12,'#8F8E88'],['AVERSE',12,'#B0AFA9']];
const POS=[[132,140],[276,116],[186,252],[322,238]];
obsReveal('hundredfield',s=>{
  // dashed constellation hairlines tying the cluster cores
  [[0,1],[0,2],[1,3],[2,3]].forEach(([a,b],k)=>{
    el(s,'line',{x1:POS[a][0],y1:POS[a][1],x2:POS[b][0],y2:POS[b][1],
      stroke:GRID,'stroke-width':.7,'stroke-dasharray':'2 5',
      class:'fade',style:`animation-delay:${.9+k*.1}s`});
  });
  SEG.forEach(([name,v,shade],ci)=>{
    const [cx,cy]=POS[ci];
    let edge=0;
    for(let k=0;k<v;k++){
      const a=k*137.508+ci*55;
      const rr=4+Math.sqrt(k)*5.9+rnd(k+1,ci+2)*3;
      edge=Math.max(edge,rr);
      const [x,y]=pol(cx,cy,rr,a);
      // hairline spoke for every 5th person, core to dot
      if(k%5===0)el(s,'line',{x1:cx,y1:cy,x2:x,y2:y,stroke:'#CDCCC5','stroke-width':.6,
        class:'fade',style:`animation-delay:${ci*.14+k*.012}s`});
      const dot=el(s,'circle',{cx:x,cy:y,r:1.5+rnd(k+2,ci+3)*1.7,fill:shade,opacity:.9,
        class:'pop',style:`animation-delay:${ci*.14+k*.012}s`});
      tip(dot,`${name} — one of ${v} in 100`);
    }
    el(s,'circle',{cx,cy,r:2.4,fill:INK,class:'pop',style:`animation-delay:${ci*.14}s`});
    txt(s,{x:cx,y:cy+edge+13,'font-size':8,'font-weight':800,fill:INK,'text-anchor':'middle',
      'letter-spacing':'.1em',style:`paint-order:stroke;stroke:${PAPER};stroke-width:3px;animation-delay:${.5+ci*.12}s`,
      class:'fade'},`${name} · ${v}`);
  });
  txt(s,{x:200,y:314,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.3s'},'ONE DOT = ONE PERSON · 41 + 35 + 12 + 12 = 100');
});
})();
