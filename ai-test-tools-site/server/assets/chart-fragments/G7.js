// ═══════════════════════════════════════════════════════════
// 图型片段 G7 · Tree LR 左右树（重绘版 · 全出血）
// 数据契约：层级结构（2–3 层）；ECharts。容器是 <div class="ch" id="…">，不是 svg。
// 形式依据：层级从属（不比较份额）→ 树。降级理由：Lupi/Basics 无层级图，
//           F13 Treemap 要权重语义，而层级条目没有诚实权重。
// 色彩：分支走灰阶明度阶梯（L），根节点墨色。文字一律穿墨色 token。
// 引擎：ECharts（HTML 需引入 echarts@6 CDN）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{name, children:[{name, children:[…]}, …]}，2–3 层）。
(()=>{
const TREE=__DATA__;
// 分支明度按子节点序取 L 阶梯；根节点墨色。文字不穿数据色。
const build=(node,depth,idx)=>{
  const shade=depth===0?INK:L[Math.min(L.length-1,idx)];
  const out={name:node.name,itemStyle:{color:shade},lineStyle:{color:shade},
    children:(node.children||[]).map((c,i)=>build(c,depth+1,i))};
  if(depth===0)out.label={fontSize:16,color:INK,fontWeight:700};
  return out;
};
eReveal('tree',{
  animationDuration:1100,animationEasing:'quarticOut',
  tooltip:{...tipLight,textStyle:{...tipLight.textStyle,fontSize:13}},
  series:[{
    type:'tree',layout:'orthogonal',orient:'LR',
    left:130,right:240,top:24,bottom:24,
    symbol:'circle',symbolSize:10,
    initialTreeDepth:2,expandAndCollapse:false,roam:false,
    itemStyle:{borderWidth:0},
    lineStyle:{width:2,curveness:.5},
    label:{fontFamily:FONT.text,fontSize:13,fontWeight:600,color:'#4A4944',position:'left'},
    leaves:{label:{position:'right',color:MUTED,fontWeight:500}},
    data:[build(TREE,0,0)],
  }],
});
})();
