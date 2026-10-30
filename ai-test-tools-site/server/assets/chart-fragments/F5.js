// ═══════════════════════════════════════════════════════════
// 图型片段 F5 · Emphasis Bars 焦点横条（重绘版 · 全出血）
// 数据契约：名义类目排名比较（≤8 行），单位可数。
// 形式依据：名义类目 → 一支高亮（本轮风险焦点），其余去强调灰。
//           严禁「越大越深」的值色阶 —— 那是拿唯一空闲通道去重复编码条长。
// 标记规格：条厚 20px（≤24）；基线端方角、数据端 4px 圆角；条端标值。
// 文字一律穿墨色 token，绝不穿数据色。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{rows:[[名称, 值, 是否风险焦点],…]}，≤8 行）。
(()=>{
const D=__DATA__.rows;
obsReveal('tickrows',s=>{
  const X0=190,X1=960,BAR=20,ROW=48,Y0=34,MAX=10;
  const px=v=>(X1-X0)*v/MAX;
  // 发丝网格：实线、1px、单色退让（虚线只留给阈值）
  for(let t=0;t<=MAX;t+=2){
    const gx=X0+px(t);
    el(s,'line',{x1:gx,y1:Y0-14,x2:gx,y2:Y0+D.length*ROW-14,stroke:t===0?INK:GRID,'stroke-width':1,
      class:'fade',style:`animation-delay:${t*.02}s`});
    txt(s,{x:gx,y:Y0-24,'font-size':12,fill:FAINT,'text-anchor':'middle',
      'letter-spacing':'.06em','font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${t*.02}s`},t);
  }
  D.forEach(([name,v,hot],i)=>{
    const y=Y0+i*ROW;
    txt(s,{x:X0-24,y:y+BAR/2,'font-size':15,'font-weight':hot?700:500,
      fill:hot?INK:MUTED,'text-anchor':'end','dominant-baseline':'middle',
      class:'fade',style:`animation-delay:${i*.07}s`},name);
    if(v>0){
      const w=px(v);
      // 唯一高亮 = 本轮风险焦点；其余去强调灰。不是值色阶。
      const p=el(s,'path',{d:barH(X0,y,w,BAR),fill:hot?STATUS.crit:STATUS.mute,
        class:'fade',style:`animation-delay:${.1+i*.07}s`});
      tip(p,`${name} — ${v} 个缺陷`);
    }else{
      // 0 值不画条，只给短标，避免「一根空条」被误读成有值
      el(s,'line',{x1:X0,y1:y+BAR/2,x2:X0+10,y2:y+BAR/2,stroke:FAINT,'stroke-width':2,
        class:'fade',style:`animation-delay:${.1+i*.07}s`});
    }
    // 条端标值（每条一个，不是逐点铺数）
    txt(s,{x:X0+Math.max(px(v),10)+14,y:y+BAR/2,'font-size':17,'font-weight':700,
      fill:hot?STATUS.crit:INK,'dominant-baseline':'middle','font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${.25+i*.07}s`},v);
    if(hot)txt(s,{x:X0+px(v)+52,y:y+BAR/2,'font-size':12,'font-weight':600,fill:STATUS.crit,
      'dominant-baseline':'middle','letter-spacing':'.1em',
      class:'fade',style:`animation-delay:${.35+i*.07}s`},'风险焦点');
  });
  txt(s,{x:0,y:Y0+D.length*ROW+16,'font-size':11,'font-weight':500,fill:FAINT,
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:.6s'},
    '横轴 = 缺陷数（个）· 红 = 本轮风险焦点 · 灰 = 其余模块');
});
})();
