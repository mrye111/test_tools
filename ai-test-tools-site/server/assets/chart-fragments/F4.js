// ═══════════════════════════════════════════════════════════
// 图型片段 F4 · Stacked Share 状态构成条（重绘版 · 全出血）
// 数据契约：100% 构成（≤6 段）；状态构成用 STATUS 三色，段序固定
//           通过 | 阻塞 | 失败 | 跳过 —— 绿红不得相邻（红绿色盲下 ΔE 仅 4.1）。
// 形式依据：part-to-whole → 单条水平堆叠条（不是环形图 / 饼图）。
// 标记规格：条厚 24px；段间 2px 表面间隙、不描边；基线端方角、数据端 4px 圆角；
//           段内直标只在放得下时给，否则交给图例 + tooltip。
// 文字穿墨色 token；段内标签按填充明度取纸/墨（唯一例外）。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[[名称, 条数, 状态键, 标记], …]，≤6 段）。
// 状态键 ∈ good | warn | crit | mute，色值由 STATUS 取，**数据里不带颜色**。
(()=>{
const D=__DATA__.map(([n,v,k,ico])=>[n,v,STATUS[k]||STATUS.mute,ico]);
obsReveal('tickdonut',s=>{
  const W=1080,GAP=2,BAR=24,Y=34;
  const total=D.reduce((a,d)=>a+d[1],0);
  const usable=W-GAP*(D.length-1);
  let x=0;
  D.forEach(([name,v,shade,ico],i)=>{
    const w=v/total*usable;
    const isLast=i===D.length-1;
    // 整条是一个标记：左端（基线）方角，右端（数据端）4px 圆角；中段两端方角
    const p=el(s,'path',{d:isLast?barH(x,Y,w,BAR,4):`M${x} ${Y} H${x+w} V${Y+BAR} H${x} Z`,fill:shade});
    tip(p,`${name} ${v} 条 · ${(v/total*100).toFixed(1)}%`);
    // 段内直标：放得下才给（≥150px），文字按填充明度取纸/墨
    if(w>=150){
      const pale=shade===STATUS.mute||shade==='#B0AFA9';
      txt(s,{x:x+16,y:Y+BAR/2,'font-size':14,'font-weight':600,
        fill:pale?INK:PAPER,'dominant-baseline':'middle',
        class:'fade',style:`animation-delay:${.3+i*.06}s`},`${name} ${v}`);
    }
    x+=w+GAP;
  });

  // 图例：≥2 系列必出；状态色必配 icon + label + 数值，绝不单靠颜色承载语义
  const LY=112;
  let lx=0;
  D.forEach(([name,v,shade,ico],i)=>{
    const g=el(s,'g',{class:'fade',style:`animation-delay:${.5+i*.06}s`});
    el(g,'rect',{x:lx,y:LY-9,width:11,height:11,rx:2.5,fill:shade});
    txt(g,{x:lx+20,y:LY,'font-size':13,'font-weight':700,fill:shade,'dominant-baseline':'middle'},ico);
    txt(g,{x:lx+38,y:LY,'font-size':14,fill:INK,'dominant-baseline':'middle'},name);
    txt(g,{x:lx+38+name.length*15,y:LY,'font-size':14,'font-weight':700,fill:INK,
      'dominant-baseline':'middle','font-variant-numeric':'tabular-nums'},String(v));
    txt(g,{x:lx+38+name.length*15+34,y:LY,'font-size':12,fill:MUTED,
      'dominant-baseline':'middle','font-variant-numeric':'tabular-nums'},(v/total*100).toFixed(1)+'%');
    tip(g,`${name} ${v} 条 · 占 ${(v/total*100).toFixed(1)}%`);
    lx+=270;
  });
});
})();
