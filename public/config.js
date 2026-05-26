export const APP_CONFIG = {
  brand: {
    title: "Learn-X",
    subtitle: "学习动力引擎",
    mark: "LX"
  },
  promptDirectory: "meta-prompts",
  menu: [
    {
      id: "browse",
      label: "知",
      module: "browse",
      title: "知识库浏览"
    },
    {
      id: "learning",
      label: "学",
      module: "learning",
      title: "学习动力引擎"
    },
    {
      id: "action",
      label: "行",
      module: "action",
      title: "行动动力引擎",
      placeholder:
        "这里预留给“知行合一”的行动系统：任务实验、复盘闭环、真实世界反馈和下一步行动编排。"
    }
  ],
  learningScenarios: [
    {
      id: "global-audit",
      title: "全局认知审计",
      subtitle: "审计道法脱节、逻辑漏洞和 AI 异化风险",
      needsDomain: false,
      recommendedSources: "all"
    },
    {
      id: "domain-research",
      title: "领域研究",
      subtitle: "围绕当前问题研究某个领域的结构、边界和行动抓手",
      needsDomain: true,
      recommendedSources: ["README.md", "法/{{domain}}"]
    }
  ]
};
