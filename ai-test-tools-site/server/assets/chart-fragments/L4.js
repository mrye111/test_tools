// ═══════════════════════════════════════════════════════════
// 图型片段 L4 · Eight products land in twelve cities
// 数据契约：分类×分类+量，小数据（≤100 格）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ 3 · arc bubble matrix ════
(()=>{
const PROD=['Editor','Boards','Docs','Flows','Chat','Vault','Pages','Sync'];
const CITY=['SF','NYC','LON','BER','TOK','SYD','SIN','PAR','AMS','TOR','SEO','SAO'];
const W=[9,8,7,7,6,5,5,4,4,3,3,2];             // market weight
obsReveal('arcmatrix',s=>{
  const rowY=i=>74+i*29, colX=j=>92+j*27, dy=j=>-16*Math.sin(Math.PI*j/11);
  const v=(i,j)=>{
    if(rnd(i*13+1,j*7+3)<.09)return 0;                 // a few true absences
    const age=1-i*.085;                                // older rows reach further
    return Math.min(40,Math.round(W[j]*3.4*age*(.45+rnd(i+1,j+1)*.85)));
  };
  // find top-4 cells for labels
  const all=[];
  PROD.forEach((_,i)=>CITY.forEach((_,j)=>all.push([v(i,j),i,j])));
  const top=all.sort((a,b)=>b[0]-a[0]).slice(0,4).map(d=>d[1]*100+d[2]);
  PROD.forEach((p,i)=>{
    // the horizon arc
    const d='M'+CITY.map((_,j)=>`${colX(j)} ${rowY(i)+dy(j)}`).join(' L ');
    el(s,'path',{d,fill:'none',stroke:'#E3E2DB','stroke-width':1,pathLength:1,
      class:'draw',style:`animation-delay:${i*.08}s`});
    txt(s,{x:84,y:rowY(i)+3,'font-size':8,'font-weight':600,fill:'#6A6963','text-anchor':'end',
      class:'fade',style:`animation-delay:${i*.08}s`},p);
    CITY.forEach((c,j)=>{
      const x=colX(j),y=rowY(i)+dy(j),vv=v(i,j);
      if(!vv){el(s,'circle',{cx:x,cy:y,r:.9,fill:'#D8D6CE',
        class:'pop',style:`animation-delay:${.2+i*.08+j*.02}s`});return}
      const fill=vv>=25?INK:vv>=12?'#6A6963':'#B0AFA9';
      const dot=el(s,'circle',{cx:x,cy:y,r:Math.sqrt(vv)*1.3,fill,
        class:'pop',style:`animation-delay:${.2+i*.08+j*.02}s`});
      tip(dot,`${p} · ${c} — ${vv} accounts`);
      if(top.includes(i*100+j))
        txt(s,{x,y:y-Math.sqrt(vv)*1.3-4,'font-size':7,'font-weight':800,fill:INK,
          'text-anchor':'middle',class:'fade',style:`animation-delay:${.6}s`},vv);
    });
  });
  CITY.forEach((c,j)=>{
    const x=colX(j),y=74+dy(j)-24;
    txt(s,{x,y,'font-size':7,'font-weight':700,fill:MUTED,'letter-spacing':'.08em',
      transform:`rotate(-55 ${x} ${y})`,class:'fade',style:`animation-delay:${j*.03}s`},c);
  });
});
})();
