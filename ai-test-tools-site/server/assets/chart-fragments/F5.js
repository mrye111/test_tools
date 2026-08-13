// ═══════════════════════════════════════════════════════════
// 图型片段 F5 · Six teams, shipped and counted
// 数据契约：横向排名比较，单位可数（≤8 行）
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ C1 · tick rows ════
// 横向条形：一行 = 一支队伍的发布队列，1 tick = 1 次发布。
// tick 高度/透明度抖动，每 5 根一个点标，行尾大数。
(()=>{
const D=[['PLATFORM',34],['GROWTH',28],['MOBILE',22],['INFRA',17],['ML',11],['DESIGN',8]];
obsReveal('tickrows',s=>{
  const y0=i=>52+i*44,X0=104,PX=6.9;
  D.forEach(([name,v],i)=>{
    const y=y0(i);
    txt(s,{x:94,y:y+3,'font-size':8,'font-weight':700,fill:'#6A6963','text-anchor':'end',
      'letter-spacing':'.08em',class:'fade',style:`animation-delay:${i*.08}s`},name);
    el(s,'line',{x1:X0,y1:y+9,x2:X0+34*PX,y2:y+9,stroke:GRID,'stroke-width':.6,
      class:'fade',style:`animation-delay:${i*.08}s`});
    for(let k=0;k<v;k++){
      const x=X0+k*PX+PX/2,h=9+rnd(k+1,i+2)*6;
      el(s,'line',{x1:x,y1:y+9,x2:x,y2:y+9-h,stroke:INK,'stroke-width':.9,
        opacity:.55+rnd(k+3,i+5)*.45,class:'fade',style:`animation-delay:${i*.08+k*.012}s`});
      if(k%5===4)el(s,'circle',{cx:x,cy:y+13,r:.8,fill:'#C6C5BF',
        class:'fade',style:`animation-delay:${i*.08+k*.012}s`});
    }
    const lab=txt(s,{x:X0+v*PX+10,y:y+4,'font-size':11,'font-weight':800,fill:INK,
      class:'fade',style:`animation-delay:${.4+i*.08}s`},v);
    tip(lab,`${name} — ${v} releases`);
  });
  txt(s,{x:200,y:308,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:.9s'},
    'ONE TICK = ONE RELEASE · DOT MARKS EVERY FIFTH');
});
})();
