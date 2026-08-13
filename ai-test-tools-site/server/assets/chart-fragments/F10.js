// ═══════════════════════════════════════════════════════════
// 图型片段 F10 · When support gets loud
// 数据契约：星期×小时×量（小热力）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C6 · dot heat ════
// 热力图：punch card 的 Lupi 皮。7×12 网格，点面积 = 工单量，
// 静默格留一粒极小点（沉默可见）。最热格标数。
(()=>{
const DAY=['MON','TUE','WED','THU','FRI','SAT','SUN'];
obsReveal('dotheat',s=>{
  const x0=j=>64+j*27,y0=i=>58+i*30;
  let max=0,mi=0,mj=0;
  const v=(i,j)=>{
    const day=i<5?1:.32;                       // weekends quiet
    const hour=Math.exp(-((j-4.6)**2)/7)+.7*Math.exp(-((j-8.4)**2)/5); // two peaks
    const raw=day*hour*22*(0.6+rnd(i*12+j+1,j+3)*.8);
    return Math.round(raw);
  };
  for(let i=0;i<7;i++)for(let j=0;j<12;j++){const t=v(i,j);if(t>max){max=t;mi=i;mj=j}}
  for(let i=0;i<7;i++){
    txt(s,{x:50,y:y0(i)+3,'font-size':7.5,'font-weight':700,fill:'#6A6963','text-anchor':'end',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.05}s`},DAY[i]);
    for(let j=0;j<12;j++){
      const t=v(i,j),x=x0(j),y=y0(i);
      if(!t){el(s,'circle',{cx:x,cy:y,r:.8,fill:'#D8D6CE',
        class:'pop',style:`animation-delay:${i*.05+j*.015}s`});continue}
      const hero=i===mi&&j===mj;
      const dot=el(s,'circle',{cx:x,cy:y,r:1.2+Math.sqrt(t)*2.1,
        fill:t>max*.66?INK:t>max*.33?'#6A6963':'#B0AFA9',
        class:'pop',style:`animation-delay:${i*.05+j*.015}s`});
      tip(dot,`${DAY[i]} ${8+j}:00 — ${t} tickets`);
      if(hero)el(s,'circle',{cx:x,cy:y,r:1.2+Math.sqrt(t)*2.1+3.4,fill:'none',
        stroke:INK,'stroke-width':1,'stroke-dasharray':'2 3',
        class:'fade',style:'animation-delay:1s'});
    }
  }
  for(let j=0;j<12;j+=2)
    txt(s,{x:x0(j),y:y0(6)+26,'font-size':7,'font-weight':600,fill:'#C6C5BF','text-anchor':'middle',
      class:'fade',style:`animation-delay:${j*.02}s`},(8+j)+':00');
  txt(s,{x:200,y:306,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.1s'},
    `DOT AREA = TICKETS · DASHED RING = THE PEAK, ${max} · TINY DOT = A QUIET HOUR`);
});
})();
