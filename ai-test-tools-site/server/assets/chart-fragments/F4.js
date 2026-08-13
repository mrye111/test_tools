// ═══════════════════════════════════════════════════════════
// 图型片段 F4 · Where the traffic comes from
// 数据契约：100% 构成（≤6 段）；1 tick = 1%
// 引擎：手写 SVG（零依赖，可离线）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ B4 · tick donut ════
// 环形图的 Lupi 化：ballot tally 的百人队列绕成整圈表盘，1 tick = 1%，
// 四段来源用灰阶 ladder 分段，段间留一格呼吸。中心只放总数和单位说明。
(()=>{
const D=[['ORGANIC',37,INK],['PAID',28,'#55554F'],['REFERRAL',21,'#8F8E88'],['SOCIAL',14,'#B0AFA9']];
obsReveal('tickdonut',s=>{
  const cx=200,cy=148,R0=64;
  let k0=0;
  D.forEach(([name,v,shade],si)=>{
    for(let k=0;k<v;k++){
      const idx=k0+k,a=idx*3.6-90;
      const len=10+rnd(idx+1,si+2)*6;
      const [x1,y1]=pol(cx,cy,R0,a),[x2,y2]=pol(cx,cy,R0+len,a);
      el(s,'line',{x1,y1,x2,y2,stroke:shade,'stroke-width':1,
        class:'fade',style:`animation-delay:${idx*.012}s`});
      if(idx%10===0){
        const [dx,dy]=pol(cx,cy,R0-5,a);
        el(s,'circle',{cx:dx,cy:dy,r:.8,fill:'#C6C5BF',
          class:'fade',style:`animation-delay:${idx*.012}s`});
      }
    }
    // segment label at mid-angle, outside, tied by a dotted hairline
    const mid=(k0+v/2)*3.6-90,[lx,ly]=pol(cx,cy,R0+38,mid),[gx,gy]=pol(cx,cy,R0+20,mid);
    el(s,'line',{x1:gx,y1:gy,x2:lx,y2:ly,stroke:'#C6C5BF','stroke-width':.7,
      'stroke-dasharray':'1 3',class:'fade',style:`animation-delay:${.6+si*.1}s`});
    const anchor=Math.cos(mid*D2R)>0.3?'start':Math.cos(mid*D2R)<-0.3?'end':'middle';
    const lab=txt(s,{x:lx,y:ly+3,'font-size':8,'font-weight':800,fill:shade,'text-anchor':anchor,
      'letter-spacing':'.06em',style:`paint-order:stroke;stroke:${PAPER};stroke-width:3px;animation-delay:${.65+si*.1}s`,
      class:'fade'},`${name} · ${v}`);
    tip(lab,`${name} — ${v}% of traffic`);
    k0+=v;
  });
  txt(s,{x:cx,y:cy-2,'font-size':22,'font-weight':800,fill:INK,'text-anchor':'middle',
    class:'fade',style:'animation-delay:.9s'},'100');
  txt(s,{x:cx,y:cy+14,'font-size':7,'font-weight':600,fill:MUTED,'text-anchor':'middle',
    'letter-spacing':'.1em',class:'fade',style:'animation-delay:.9s'},'TICKS · ONE = 1%');
  txt(s,{x:200,y:296,'font-size':7,'font-weight':600,fill:'#B0AFA9','text-anchor':'middle',
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:1.1s'},
    'TWELVE O’CLOCK IS ZERO · DOT MARKS EVERY TENTH · READS CLOCKWISE');
});
})();
