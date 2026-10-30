// ═══════════════════════════════════════════════════════════
// 图型片段 F9 · Waterfall 瀑布（重绘版 · 全出血）
// 数据契约：瀑布 / 增减分解（≤6 级）。viewBox 1080 宽。
// 数据形状：[类目, 取值, 标记]；标记 'start' = 起始总量，'total' = 收尾总量，
//           其余为增减步。首尾用标记判定，不要靠类目名匹配。
// 形式依据：增减分解 → 瀑布（浮动柱）。加项墨色、减项去强调灰，靠符号与图例区分，
//           不靠描边。层与层之间发丝台阶承接（台阶是语境，不是数据）。
// 标记规格：柱厚 24px；数据端圆角、基线端方角。文字一律穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[[类目, 取值, 标记], …]，≤6 级）。
(()=>{
const D=__DATA__;
obsReveal('fall',s=>{
  const BASE=300,BW=24,MAX=140,PLOT=220;
  const X=i=>(1080-(D.length-1)*180-BW)/2+i*180;
  const py=v=>BASE-v/MAX*PLOT;
  // 先算浮动区间
  let lv=0;const rows=[];
  D.forEach(([name,v,mark])=>{
    if(mark==='start'){rows.push([name,v,0,v]);lv=v}
    else if(mark==='total'){rows.push([name,lv,0,lv])}
    else{rows.push([name,v,lv+v,lv]);lv=lv+v}
  });
  for(let t=0;t<=140;t+=35){
    el(s,'line',{x1:80,y1:py(t),x2:1000,y2:py(t),stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.01}s`});
    txt(s,{x:66,y:py(t)+5,'font-size':12,fill:FAINT,'text-anchor':'end',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${t*.01}s`},t);
  }
  rows.forEach(([name,v,lo,hi],i)=>{
    const mark=D[i][2],isTotal=mark==='start'||mark==='total',neg=v<0&&!isTotal;
    const from=isTotal?0:lo,to=isTotal?v:hi;
    const y=py(Math.max(from,to)),h=Math.abs(py(from)-py(to));
    const p=el(s,'path',{d:barV(X(i),y,BW,Math.max(h,2)),fill:neg?STATUS.mute:INK,
      class:'fade',style:`animation-delay:${.15+i*.12}s`});
    tip(p,`${name} — ${neg?'−':''}${Math.abs(v)} 条`);
    // 台阶承接：发丝线连到下一级的起始位（语境线，非数据）
    if(i<rows.length-1){
      const lvl=isTotal?v:(neg?lo:hi);
      el(s,'line',{x1:X(i)+BW+2,y1:py(lvl),x2:X(i+1)-2,y2:py(lvl),stroke:FAINT,
        'stroke-width':1,'stroke-dasharray':'3 4',class:'fade',style:`animation-delay:${.4+i*.12}s`});
    }
    txt(s,{x:X(i)+BW/2,y:y-14,'font-size':18,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.3+i*.12}s`},
      (neg?'−':'')+Math.abs(v));
    txt(s,{x:X(i)+BW/2,y:BASE+30,'font-size':14,fill:MUTED,'text-anchor':'middle',
      class:'fade',style:`animation-delay:${.45+i*.12}s`},name);
  });
  const LY=BASE+74;
  [[INK,'加项 / 总量','起点与终点'],[STATUS.mute,'减项','− 号标记']].forEach(([c,k,note],i)=>{
    const lx=80+i*240;
    el(s,'rect',{x:lx,y:LY-11,width:12,height:12,rx:2,fill:c,
      class:'fade',style:`animation-delay:${.8+i*.05}s`});
    txt(s,{x:lx+22,y:LY,'font-size':14,fill:INK,class:'fade',style:`animation-delay:${.8+i*.05}s`},k);
    txt(s,{x:lx+22+k.length*15+10,y:LY,'font-size':12,fill:MUTED,
      class:'fade',style:`animation-delay:${.8+i*.05}s`},note);
  });
  txt(s,{x:640,y:LY,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.9s'},'纵轴 = 用例数（条）· 虚线 = 级间接力');
});
})();
