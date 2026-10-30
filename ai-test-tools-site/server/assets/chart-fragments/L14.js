// ═══════════════════════════════════════════════════════════
// 图型片段 L14 · Hundred Field 百格场（重绘版 · 全出血）
// 数据契约：构成（占比）；1 点 = 1 个单位，点数即真实条目数，可数。
//           ≤6 类小数据。状态构成用 STATUS 三色（顺序 STATUS.order），
//           非状态构成用灰阶明度阶梯。
// 形式依据：part-to-whole 且要求「可数」→ 单位分解点阵（对比 F4 堆叠条只读占比）。
// 标记规格：格间 2px 表面间隙、不描边；格圆角 3px。
// 文字一律穿墨色 token，绝不穿数据色。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（[[名称, 单位数, 状态键, 标记], …]，≤6 类）。
(()=>{
const D=__DATA__.map(([n,v,k,ico])=>[n,v,STATUS[k]||STATUS.mute,ico]);
obsReveal('hundredfield',s=>{
  const COLS=25,GAP=5,W=900;
  const CELL=(W-(COLS-1)*GAP)/COLS;
  const total=D.reduce((a,d)=>a+d[1],0);
  const ROWS=Math.ceil(total/COLS);
  const X0=30,Y0=26;
  // 点数可变，图自适应高度（写回 viewBox，别让格子被压扁）
  const H=Y0+ROWS*(CELL+GAP)+110;
  s.setAttribute('viewBox',`0 0 1080 ${H}`);

  // 铺点：按段顺序填充，行优先，可数
  let n=0;
  D.forEach(([name,v,shade,ico],si)=>{
    for(let k=0;k<v;k++,n++){
      const cx=X0+(n%COLS)*(CELL+GAP),cy=Y0+Math.floor(n/COLS)*(CELL+GAP);
      const g=el(s,'g',{});
      el(g,'rect',{x:cx,y:cy,width:CELL,height:CELL,rx:3,fill:shade,opacity:.92,
        class:'pop',style:`animation-delay:${si*.08+n*.006}s`});
      tip(g,`${name} — 第 ${n+1} 个，共 ${v} 个`);
    }
  });
  // 末行余格：极淡占位，让「总数不是整行」看得出来（沉默可见）
  for(;n<ROWS*COLS;n++){
    const cx=X0+(n%COLS)*(CELL+GAP),cy=Y0+Math.floor(n/COLS)*(CELL+GAP);
    el(s,'rect',{x:cx,y:cy,width:CELL,height:CELL,rx:3,fill:'#EDECE6',
      class:'fade',style:`animation-delay:${.5+n*.004}s`});
  }

  // 图例：状态色必配 icon + label + 数值；文字穿墨色 token
  const LY=Y0+ROWS*(CELL+GAP)+44;
  D.forEach(([name,v,shade,ico],i)=>{
    const lx=i*250;
    const g=el(s,'g',{class:'fade',style:`animation-delay:${.6+i*.05}s`});
    el(g,'rect',{x:lx,y:LY-10,width:12,height:12,rx:3,fill:shade});
    txt(g,{x:lx+22,y:LY+1,'font-size':13,'font-weight':700,fill:shade,'dominant-baseline':'middle'},ico);
    txt(g,{x:lx+40,y:LY+1,'font-size':14,fill:INK,'dominant-baseline':'middle'},name);
    txt(g,{x:lx+40+name.length*15,y:LY+1,'font-size':14,'font-weight':700,fill:INK,
      'dominant-baseline':'middle','font-variant-numeric':'tabular-nums'},String(v));
    txt(g,{x:lx+40+name.length*15+34,y:LY+1,'font-size':12,fill:MUTED,
      'dominant-baseline':'middle','font-variant-numeric':'tabular-nums'},
      (v/total*100).toFixed(1)+'%');
    tip(g,`${name} ${v} 个 · 占 ${(v/total*100).toFixed(1)}%`);
  });
  txt(s,{x:0,y:LY+40,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:.9s'},
    `1 格 = 1 个单位 · 共 ${total} 格，逐格可数 · 末行淡格 = 非整行余量`);
});
})();
