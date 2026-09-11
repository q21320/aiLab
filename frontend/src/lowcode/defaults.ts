// ============================================================================
// 低代码平台 · 示例工程（首次打开自动载入，可一键重置）
// ============================================================================

import type { PageSchema } from "./types";
import type { FormSchema } from "./formTypes";
import type { FlowSchema } from "./flowTypes";
import type { ReportSchema } from "./reportTypes";
import type { ScreenSchema } from "./screenTypes";
import { uid } from "./schemaOps";

// ---------------------------------------------------------------------------
// 示例页面：用户登录页
// ---------------------------------------------------------------------------
export function defaultPageSchema(): PageSchema {
  return {
    id: uid("page"),
    type: "page",
    text: "用户登录",
    props: { title: "用户登录" },
    style: {
      padding: "0",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      minHeight: "100vh",
    },
    children: [
      {
        id: uid("container"),
        type: "container",
        style: {
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          padding: "16px",
        },
        children: [
          {
            id: uid("card"),
            type: "card",
            props: { shadow: "always" },
            style: { width: "380px", maxWidth: "100%" },
            children: [
              {
                id: uid("title"),
                type: "title",
                text: "欢迎登录",
                props: { level: 3 },
                style: { textAlign: "center", marginBottom: "8px" },
              },
              {
                id: uid("text"),
                type: "text",
                text: "使用低代码平台快速搭建您的业务应用",
                style: { textAlign: "center", color: "#909399", marginBottom: "16px" },
              },
              {
                id: uid("form"),
                type: "form",
                props: { labelWidth: "70px" },
                style: { width: "100%" },
                children: [
                  {
                    id: uid("formItem"),
                    type: "formItem",
                    props: { label: "账号" },
                    children: [
                      {
                        id: uid("input"),
                        type: "input",
                        props: { placeholder: "请输入账号", clearable: true },
                        style: { width: "100%" },
                      },
                    ],
                  },
                  {
                    id: uid("formItem"),
                    type: "formItem",
                    props: { label: "密码" },
                    children: [
                      {
                        id: uid("input"),
                        type: "input",
                        props: { placeholder: "请输入密码", type: "password", showPassword: true },
                        style: { width: "100%" },
                      },
                    ],
                  },
                  {
                    id: uid("button"),
                    type: "button",
                    text: "登 录",
                    props: { type: "primary", size: "large" },
                    style: { width: "100%", marginTop: "12px" },
                  },
                  {
                    id: uid("container"),
                    type: "container",
                    style: { display: "flex", justifyContent: "space-between", marginTop: "8px" },
                    children: [
                      {
                        id: uid("text"),
                        type: "text",
                        text: "忘记密码？",
                        style: { color: "#909399", fontSize: "12px" },
                      },
                      {
                        id: uid("text"),
                        type: "text",
                        text: "注册账号",
                        style: { color: "#409eff", fontSize: "12px" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 示例表单：员工信息采集
// ---------------------------------------------------------------------------
export function defaultFormSchema(): FormSchema {
  return {
    id: uid("form"),
    name: "员工信息采集",
    showTitle: true,
    labelWidth: 100,
    fieldSpan: 12,
    submitText: "提交",
    submitApi: "/api/forms/employee/submit",
    fields: [
      {
        id: uid("f"),
        type: "input",
        label: "姓名",
        name: "name",
        placeholder: "请输入姓名",
        required: true,
        message: "姓名不能为空",
        span: 12,
      },
      {
        id: uid("f"),
        type: "select",
        label: "部门",
        name: "department",
        placeholder: "请选择部门",
        required: true,
        options: [
          { label: "研发部", value: "rd" },
          { label: "市场部", value: "market" },
          { label: "行政部", value: "admin" },
          { label: "财务部", value: "finance" },
        ],
        span: 12,
      },
      {
        id: uid("f"),
        type: "radio",
        label: "性别",
        name: "gender",
        options: [
          { label: "男", value: "male" },
          { label: "女", value: "female" },
        ],
        span: 12,
      },
      {
        id: uid("f"),
        type: "date",
        label: "入职日期",
        name: "joinDate",
        required: true,
        message: "请选择入职日期",
        span: 12,
      },
      {
        id: uid("f"),
        type: "number",
        label: "薪资",
        name: "salary",
        placeholder: "请输入薪资",
        props: { min: 0, max: 1000000, step: 1000 },
        span: 12,
      },
      {
        id: uid("f"),
        type: "switch",
        label: "是否在职",
        name: "active",
        defaultValue: true,
        span: 12,
      },
      {
        id: uid("f"),
        type: "checkbox",
        label: "技能标签",
        name: "skills",
        options: [
          { label: "Java", value: "java" },
          { label: "Vue", value: "vue" },
          { label: "机器学习", value: "ml" },
          { label: "项目管理", value: "pm" },
        ],
        span: 24,
      },
      {
        id: uid("f"),
        type: "rating",
        label: "绩效评分",
        name: "rating",
        props: { max: 5 },
        span: 12,
      },
      {
        id: uid("f"),
        type: "slider",
        label: "满意度",
        name: "satisfaction",
        props: { min: 0, max: 100 },
        defaultValue: 80,
        span: 12,
      },
      {
        id: uid("f"),
        type: "textarea",
        label: "个人简介",
        name: "bio",
        placeholder: "请填写个人简介",
        props: { rows: 3 },
        span: 24,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 示例流程：请假审批
// ---------------------------------------------------------------------------
export function defaultFlowSchema(): FlowSchema {
  const nStart = uid("n");
  const nApprover = uid("n");
  const nCondition = uid("n");
  const nGM = uid("n");
  const nCC = uid("n");
  const nEnd = uid("n");
  return {
    id: uid("flow"),
    name: "请假审批流程",
    nodes: [
      { id: nStart, type: "start", x: 80, y: 300, name: "发起请假申请", config: { form: "员工请假单" } },
      {
        id: nApprover,
        type: "approval",
        x: 280,
        y: 300,
        name: "部门经理审批",
        config: { approver: "部门经理", multiple: "or" },
      },
      {
        id: nCondition,
        type: "condition",
        x: 500,
        y: 300,
        name: "请假天数>3天？",
        config: { expression: "请假天数 > 3", trueLabel: "是", falseLabel: "否" },
      },
      {
        id: nGM,
        type: "approval",
        x: 720,
        y: 180,
        name: "总经理审批",
        config: { approver: "总经理", multiple: "or" },
      },
      {
        id: nCC,
        type: "cc",
        x: 720,
        y: 420,
        name: "抄送行政部",
        config: { targets: "行政部" },
      },
      { id: nEnd, type: "end", x: 940, y: 300, name: "流程结束", config: {} },
    ],
    edges: [
      { id: uid("e"), source: nStart, target: nApprover, label: "提交" },
      { id: uid("e"), source: nApprover, target: nCondition, label: "通过" },
      { id: uid("e"), source: nApprover, target: nEnd, label: "驳回" },
      { id: uid("e"), source: nCondition, target: nGM, label: "是" },
      { id: uid("e"), source: nCondition, target: nCC, label: "否" },
      { id: uid("e"), source: nGM, target: nEnd, label: "通过" },
      { id: uid("e"), source: nCC, target: nEnd, label: "完成" },
    ],
  };
}

// ---------------------------------------------------------------------------
// 示例报表：销售经营分析
// ---------------------------------------------------------------------------
export function defaultReportSchema(): ReportSchema {
  const months = ["1月", "2月", "3月", "4月", "5月", "6月"];
  const regions = ["华东", "华南"];
  const products = ["智能终端", "云服务", "数据平台"];
  const rows: Record<string, any>[] = [];
  let idx = 0;
  for (const m of months) {
    for (const r of regions) {
      idx += 1;
      rows.push({
        月份: m,
        区域: r,
        产品: products[idx % 3],
        销售额: 120000 + idx * 17300 + (r === "华东" ? 45000 : 0) + (idx % 2) * 9000,
        订单数: 800 + idx * 63,
        利润: 24000 + idx * 4500 + (r === "华南" ? 6000 : 0),
      });
    }
  }
  return {
    id: uid("report"),
    name: "销售经营分析",
    dataset: {
      id: uid("ds"),
      name: "销售订单明细",
      fields: [
        { name: "月份", label: "月份", type: "string" },
        { name: "区域", label: "区域", type: "string" },
        { name: "产品", label: "产品", type: "string" },
        { name: "销售额", label: "销售额", type: "number" },
        { name: "订单数", label: "订单数", type: "number" },
        { name: "利润", label: "利润", type: "number" },
      ],
      rows,
    },
    blocks: [
      { id: uid("b"), kind: "metric", title: "销售总额", metricField: "销售额", agg: "sum", metricLabel: "销售额", color: "#409eff" },
      { id: uid("b"), kind: "metric", title: "订单总数", metricField: "订单数", agg: "sum", metricLabel: "订单数", color: "#67c23a" },
      { id: uid("b"), kind: "metric", title: "利润总额", metricField: "利润", agg: "sum", metricLabel: "利润", color: "#e6a23c" },
      {
        id: uid("b"),
        kind: "bar",
        title: "月度销售额",
        xField: "月份",
        yField: "销售额",
        agg: "sum",
        color: "#409eff",
      },
      {
        id: uid("b"),
        kind: "line",
        title: "月度利润趋势",
        xField: "月份",
        yField: "利润",
        agg: "sum",
        color: "#67c23a",
      },
      {
        id: uid("b"),
        kind: "pie",
        title: "区域销售占比",
        xField: "区域",
        yField: "销售额",
        agg: "sum",
      },
      {
        id: uid("b"),
        kind: "table",
        title: "销售明细",
        columns: ["月份", "区域", "产品", "销售额", "订单数"],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 示例大屏：智慧运营数据中心
// ---------------------------------------------------------------------------
export function defaultScreenSchema(): ScreenSchema {
  return {
    id: uid("screen"),
    name: "智慧运营数据中心",
    width: 1920,
    height: 1080,
    background: "linear-gradient(160deg, #061630 0%, #0a1f44 55%, #061630 100%)",
    widgets: [
      {
        id: uid("w"),
        kind: "title",
        x: 660,
        y: 24,
        w: 600,
        h: 64,
        z: 10,
        title: "智慧运营数据中心",
        config: { sub: "Smart Operations Center" },
      },
      { id: uid("w"), kind: "clock", x: 1720, y: 36, w: 180, h: 44, z: 10, title: "", config: {} },
      {
        id: uid("w"),
        kind: "stat",
        x: 60,
        y: 140,
        w: 340,
        h: 130,
        z: 10,
        title: "今日访问量",
        config: { value: 128, unit: "万", trend: "+12.4%", color: "#00e5ff" },
      },
      {
        id: uid("w"),
        kind: "stat",
        x: 440,
        y: 140,
        w: 340,
        h: 130,
        z: 10,
        title: "今日订单数",
        config: { value: 36, unit: "万单", trend: "+8.1%", color: "#3d9bff" },
      },
      {
        id: uid("w"),
        kind: "stat",
        x: 820,
        y: 140,
        w: 340,
        h: 130,
        z: 10,
        title: "成交总额",
        config: { value: 8.6, unit: "亿元", trend: "+15.6%", color: "#a0cfff" },
      },
      {
        id: uid("w"),
        kind: "stat",
        x: 1200,
        y: 140,
        w: 340,
        h: 130,
        z: 10,
        title: "新增客户",
        config: { value: 2408, unit: "人", trend: "+5.2%", color: "#fce788" },
      },
      {
        id: uid("w"),
        kind: "stat",
        x: 1580,
        y: 140,
        w: 280,
        h: 130,
        z: 10,
        title: "在线用户",
        config: { value: 9, unit: "万人", trend: "-1.1%", color: "#67c23a" },
      },
      {
        id: uid("w"),
        kind: "bar",
        x: 60,
        y: 320,
        w: 620,
        h: 360,
        z: 10,
        title: "月度销售趋势",
        config: { color: "#00e5ff" },
      },
      {
        id: uid("w"),
        kind: "line",
        x: 720,
        y: 320,
        w: 620,
        h: 360,
        z: 10,
        title: "订单增长趋势",
        config: { color: "#ffb74d" },
      },
      {
        id: uid("w"),
        kind: "pie",
        x: 1380,
        y: 320,
        w: 480,
        h: 360,
        z: 10,
        title: "品类销售占比",
        config: {},
      },
      // —— 物联网实时组件（4.3/4.6）——
      {
        id: uid("w"),
        kind: "device",
        x: 60,
        y: 720,
        w: 420,
        h: 310,
        z: 10,
        title: "设备状态",
        config: { color: "#00e5ff" },
      },
      {
        id: uid("w"),
        kind: "sampleList",
        x: 520,
        y: 720,
        w: 620,
        h: 310,
        z: 10,
        title: "样品台账",
        config: { color: "#3d9bff" },
      },
      {
        id: uid("w"),
        kind: "energy",
        x: 1180,
        y: 720,
        w: 680,
        h: 310,
        z: 10,
        title: "厂区能耗趋势",
        config: { color: "#00d68f" },
      },
    ],
  };
}
