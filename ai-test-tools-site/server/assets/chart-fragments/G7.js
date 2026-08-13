// ═══════════════════════════════════════════════════════════
// 图型片段 G7 · Everything the platform ships
// 数据契约：层级结构（2–3 层）；ECharts
// 引擎：ECharts（HTML 需引入 echarts@6 CDN）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ mono-fancy · 3: LR tree ════
(()=>{
const b=(name,kids,shade)=>({name,itemStyle:{color:shade},lineStyle:{color:shade},
  children:kids.map(k=>({name:k,itemStyle:{color:shade},lineStyle:{color:shade}}))});
eReveal('tree',{
  animationDuration:1100,animationEasing:'quarticOut',
  tooltip:tipLight,
  series:[{
    type:'tree',layout:'orthogonal',orient:'LR',
    left:64,right:96,top:8,bottom:8,
    symbol:'circle',symbolSize:7,
    initialTreeDepth:2,expandAndCollapse:false,roam:false,
    itemStyle:{borderWidth:0},
    lineStyle:{width:1.4,curveness:.5},
    label:{fontFamily:'Inter',fontSize:10,fontWeight:600,color:'#6A6963',position:'left'},
    leaves:{label:{position:'right',color:MUTED,fontWeight:500}},
    data:[{
      name:'Platform',itemStyle:{color:INK},lineStyle:{color:'#C6C5BF'},
      label:{fontSize:11.5,color:INK},
      children:[
        b('Editor',['Blocks','Tables','Comments','History'],L[0]),
        b('Automate',['Workflows','Triggers','Webhooks'],L[2]),
        b('Collaborate',['Spaces','Guests','Mentions'],L[3]),
        b('Integrate',['API','Slack','GitHub'],L[4]),
      ],
    }],
  }],
});
})();
