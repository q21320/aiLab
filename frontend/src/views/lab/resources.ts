// ============================================================================
// 实验室管理 · 各模块字段定义（唯一真相源）
//
// 依据《实验室管理软件-功能概要》PPT 的字段清单落地：
//   测试项目 / 委外项目 / 日常报销 / 财务信息（收入项目、支出项目） / 客户信息 / 设备信息 / 耗材信息
//
// 项目拆为两个模块（业务上不是一回事，不能共一张表）：
//   测试项目 = 本实验室自己测 → 新增「收入项目」时从这里选关联项目
//   委外项目 = 委托三方检测   → 新增「支出项目」时从这里选关联项目
//
// 存储：复用平台通用 CRUD（backend/crud.mjs），资源名作为 key 落 PostgreSQL；
//       字段元数据在前端定义，后端只存数据行 → 后端零改动即可上线。
// 命名：接口层用 prop（英文），界面用 label（中文），从字段定义统一派生。
// ============================================================================

import { listCrud, updateCrud } from "../../api/crud";

export type LabFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "date"
  | "daterange"
  | "switch"
  | "ref"
  /** 附件（可多个）：值存 [{ id, name, size, mime, url }]，二进制存库 */
  | "file";

export interface LabField {
  /** 字段名（接口/存储用） */
  prop: string;
  /** 中文标题（表格列头 / 表单项） */
  label: string;
  type: LabFieldType;
  required?: boolean;
  /** select 选项 */
  options?: { label: string; value: string }[];
  /** 表格列宽；不填则自适应 */
  width?: number;
  /** 新建时的默认值 */
  defaultValue?: string | number | boolean;
  /** 表单占位提示 */
  placeholder?: string;
  /** 长文本等在表格中收窄显示 */
  ellipsis?: boolean;
  /** 表单分组标题（如客户信息的收款账户） */
  group?: string;
  /** 金额字段：表格右对齐 */
  money?: boolean;
  /**
   * money 且金额按「万元」录入/存储（如财务台账的价格）：
   * 表头/模板/校验文案随 label 显示万元，仪表盘等按元口径的汇总处需 ×10000 对齐。
   */
  unitWan?: boolean;
  /** type=ref：关联资源名（如项目使用设备 → lab_equipment） */
  refResource?: string;
  /** type=ref：选项的值字段 / 显示字段 */
  refValueProp?: string;
  refLabelProp?: string;
  /** type=ref：是否多选 */
  multiple?: boolean;
  /**
   * 台账内业务唯一键（如设备编号）：手工新增靠人眼看，批量导入时一个文件几百行根本对不过来，
   * 所标字段在解析阶段与已有记录、与本文件前面的行查重（编号重号类由服务端算号保证，不需标这里）。
   */
  unique?: boolean;
  /** type=ref：命中这些值时选项置灰不可选（如已停用的设备） */
  refDisabled?: { prop: string; values: string[] };
  /** type=ref：用多个字段拼下拉标签（如项目编号 + 委托单位），优先于 refLabelProp */
  refLabelProps?: string[];
  /**
   * type=ref：选中后用来源行的字段回填本表单，形如 { 本字段prop: 来源字段prop }。
   * 只在用户改动该下拉时执行（编辑旧记录不主动覆写已录数据），带出后仍可手改。
   * 来源与目标单位不同时写 [来源字段, 换算系数]，如元→万元：["price", 0.0001]。
   */
  refFill?: Record<string, string | [string, number]>;
  /** 编号由服务端自动生成（如项目编号 Z-20261025-0001）：表单只读展示，按日期重置序号 */
  autoNo?: boolean;
  /** autoNo：取哪个兄弟字段作为日期分组键（该字段为空时服务端取今天） */
  autoNoDateProp?: string;
  /** type=file：最多几个附件（默认 5） */
  maxFiles?: number;
  /** type=file：文件选择器过滤，如 .pdf,.docx,.jpg */
  accept?: string;
}

export interface LabResource {
  /** 后端 CRUD 资源名 */
  resource: string;
  /** 模块名（页面标题） */
  title: string;
  /** 一句话说明 */
  desc: string;
  /** 图标名（Element Plus，main.ts 已全局注册） */
  icon: string;
  /** 可读主标识字段（删除确认、提示文案用，避免取到日期/金额） */
  labelProp: string;
  fields: LabField[];
  /** 数据变更后的业务联动（如项目占用设备 → 设备状态变更） */
  effects?: {
    /** 返回字符串时作为额外提示展示 */
    afterSave?: (row: Record<string, any>, prev?: Record<string, any>) => Promise<string | void>;
    afterDelete?: (row: Record<string, any>) => Promise<string | void>;
    /**
     * 批量导入完成后的联动：整批只触发一次。
     * 写成逐行调 afterSave 会把 N 行导入做成 N 轮全量读写。
     */
    afterImport?: (rows: Record<string, any>[]) => Promise<string | void>;
  };
}

/** 常用枚举：按实验室业务常理补充，可在本文件直接调整 */
const PROGRESS = ["未开始", "进行中", "已完成", "已暂停"];
const CONTRACT = ["未签", "已签", "履行中", "已完成"];
const TEST_STATUS = ["未开始", "进行中", "已完成"];
const INVOICE = ["未开票", "部分开票", "已开票"];
const RECEIVE = ["未到账", "部分到账", "已到账"];
const DELIVERY = ["未交付", "部分交付", "已交付"];
const INVOICE_IN = ["未收票", "部分收票", "已收票"];
const PAY = ["未付款", "部分付款", "已付款"];
const REIMBURSE_TYPE = ["采购", "差旅", "耗材", "委外测试", "其他"];
const EQUIP_STATUS = ["运行中", "待机", "维修中", "停用"];

function opts(list: string[]) {
  return list.map((v) => ({ label: v, value: v }));
}

/** 台账附件常见的文档/图片类型（交给文件选择器做第一轮过滤，服务端仍会按类型控制预览与下载） */
const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip,.rar,.7z";

// ------------------------------------------------------------ 设备台账联动
// 项目「使用设备」记录的是设备编号；设备状态由项目的在办情况驱动：
//   项目在办（未完成）→ 占用设备置「运行中」；释放且无人占用 → 恢复「待机」
// 停用/维修中属于人工干预，联动不改写。
const EQUIP_RES = "lab_equipment";
const DEVICE_PROP = "deviceCodes";
const DEVICE_BUSY = "运行中";
const DEVICE_IDLE = "待机";
const DEVICE_LOCKED = ["停用", "维修中"];

/** 把「设备编号」字段统一成数组（历史/手工录入可能是逗号分隔字符串） */
function codesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return String(v ?? "")
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 拉全量（后端单页上限 200，实验室台账规模内够用） */
async function listAll(resource: string): Promise<Record<string, any>[]> {
  const r = await listCrud(resource, { page: 1, pageSize: 200 });
  return r.ok ? r.list : [];
}

/**
 * 同步设备状态
 * @param prevCodes 保存前项目占用的设备编号
 * @param nextCodes 保存后项目占用的设备编号
 * @returns 有变更时返回一句提示文案
 */
async function syncDevices(prevCodes: string[], nextCodes: string[]): Promise<string | void> {
  const touched = Array.from(new Set([...prevCodes, ...nextCodes]));
  if (!touched.length) return;

  // 重新计算占用集合（读的是保存后的最新项目数据）
  const [projects, devices] = await Promise.all([listAll("lab_projects"), listAll(EQUIP_RES)]);
  const busy = new Set<string>();
  for (const p of projects) {
    if (String(p.progress ?? "") === "已完成") continue;
    for (const code of codesOf(p[DEVICE_PROP])) busy.add(code);
  }

  const byCode = new Map(devices.map((d) => [String(d.code ?? ""), d]));
  let turnedBusy = 0;
  let turnedIdle = 0;
  const missing: string[] = [];

  for (const code of touched) {
    const dev = byCode.get(code);
    if (!dev) {
      missing.push(code);
      continue;
    }
    const current = String(dev.status ?? "");
    if (DEVICE_LOCKED.includes(current)) continue;
    const target = busy.has(code) ? DEVICE_BUSY : DEVICE_IDLE;
    if (current === target) continue;
    const r = await updateCrud(EQUIP_RES, String(dev.id), { status: target });
    if (!r.ok) {
      missing.push(code);
      continue;
    }
    if (target === DEVICE_BUSY) turnedBusy += 1;
    else turnedIdle += 1;
  }

  const parts: string[] = [];
  if (turnedBusy) parts.push(`${turnedBusy} 台设备转为「${DEVICE_BUSY}」`);
  if (turnedIdle) parts.push(`${turnedIdle} 台设备恢复「${DEVICE_IDLE}」`);
  if (missing.length) parts.push(`设备未找到或更新失败：${missing.join("、")}`);
  return parts.length ? `设备状态已同步：${parts.join("，")}` : undefined;
}

/** 测试项目（PPT 3）：本实验室自己完成的项目，占我方设备、关联收入项目 */
export const LAB_PROJECTS: LabResource = {
  resource: "lab_projects",
  title: "测试项目",
  desc: "本实验室自己测试的项目：编号、委托单位、方案、排产设备、周期与测试结果（可附附件）；新增收入项目时从这里选",
  icon: "Tickets",
  labelProp: "projectNo",
  fields: [
    { prop: "date", label: "日期", type: "date", width: 120 },
    // 编号形如 Z-20261025-0001：序号按当天日期重置，由服务端分配（避免两人录入重号）
    { prop: "projectNo", label: "项目编号", type: "text", required: true, width: 160, autoNo: true, autoNoDateProp: "date" },
    { prop: "clientName", label: "委托单位", type: "text", required: true, width: 180 },
    { prop: "clientContact", label: "委托单位联系人", type: "text", width: 130 },
    { prop: "testPlan", label: "测试方案", type: "textarea", ellipsis: true },
    { prop: "projectOwner", label: "项目对接人", type: "text", width: 110 },
    { prop: "testLead", label: "测试负责人", type: "text", width: 110 },
    {
      prop: "deviceCodes",
      label: "使用设备",
      type: "ref",
      refResource: "lab_equipment",
      refValueProp: "code",
      refLabelProp: "name",
      multiple: true,
      // 停用/维修中的设备不参与项目排产
      refDisabled: { prop: "status", values: DEVICE_LOCKED },
      placeholder: "从设备信息中选择（可多选）",
    },
    // 周期用日期范围控件选，落库仍为「开始 ~ 结束」字符串
    { prop: "testCycle", label: "测试周期", type: "daterange", width: 210 },
    { prop: "progress", label: "完成情况", type: "select", width: 110, options: opts(PROGRESS), defaultValue: "未开始" },
    { prop: "testResult", label: "测试结果", type: "textarea", ellipsis: true },
    { prop: "testResultFiles", label: "测试结果附件", type: "file", width: 200, accept: DOC_ACCEPT },
  ],
  /** 项目落库后联动设备台账状态 */
  effects: {
    afterSave: (row, prev) => syncDevices(codesOf(prev?.[DEVICE_PROP]), codesOf(row[DEVICE_PROP])),
    afterDelete: (row) => syncDevices(codesOf(row[DEVICE_PROP]), []),
    // 导入的项目同样要占用设备：把整批涉及的编号一次交给 syncDevices（prev 传空 = 只按当前占用情况改写）
    afterImport: (rows) => syncDevices([], rows.flatMap((r) => codesOf(r[DEVICE_PROP]))),
  },
};

/**
 * 委外项目：委托三方检测机构完成的项目
 * 与测试项目的差别：不占我方设备（测试在三方做），但多「受托单位 / 委外金额 / 委外合同」，
 * 受托单位与金额会被「支出项目」选关联时自动带出。
 */
export const LAB_OUTSOURCE_PROJECTS: LabResource = {
  resource: "lab_outsource_projects",
  title: "委外项目",
  desc: "委托三方检测机构测试的项目：受托单位、委外内容与金额、测试结果（可附附件）；新增支出项目时从这里选",
  icon: "Van",
  labelProp: "projectNo",
  fields: [
    { prop: "date", label: "日期", type: "date", width: 120 },
    // 委外编号带 W- 前缀，与测试项目的 Z- 序列互不撞号
    { prop: "projectNo", label: "项目编号", type: "text", required: true, width: 160, autoNo: true, autoNoDateProp: "date" },
    { prop: "clientName", label: "委托单位", type: "text", required: true, width: 180 },
    { prop: "clientContact", label: "委托单位联系人", type: "text", width: 130 },
    { prop: "vendor", label: "受托单位", type: "text", required: true, width: 180, placeholder: "承接本次测试的三方机构" },
    { prop: "vendorContact", label: "受托方联系人", type: "text", width: 130 },
    { prop: "outsourceItem", label: "委外测试内容", type: "textarea", ellipsis: true },
    { prop: "projectOwner", label: "项目对接人", type: "text", width: 110 },
    { prop: "testCycle", label: "测试周期", type: "daterange", width: 210 },
    { prop: "progress", label: "完成情况", type: "select", width: 110, options: opts(PROGRESS), defaultValue: "未开始" },
    { prop: "price", label: "委外金额（万元）", type: "number", money: true, unitWan: true, width: 150 },
    { prop: "contractFiles", label: "委外合同附件", type: "file", width: 200, accept: DOC_ACCEPT },
    { prop: "testResult", label: "测试结果", type: "textarea", ellipsis: true },
    { prop: "testResultFiles", label: "测试结果附件", type: "file", width: 200, accept: DOC_ACCEPT },
  ],
};

/** 日常报销（PPT 4） */
export const LAB_REIMBURSEMENTS: LabResource = {
  resource: "lab_reimbursements",
  title: "日常报销",
  desc: "采购/差旅/耗材等日常支出报销登记",
  icon: "Coin",
  labelProp: "item",
  fields: [
    { prop: "reimburseType", label: "报销类型", type: "select", required: true, width: 120, options: opts(REIMBURSE_TYPE), defaultValue: "采购" },
    { prop: "purchaseDate", label: "购买日期", type: "date", width: 120 },
    { prop: "item", label: "购买物品", type: "text", required: true, ellipsis: true },
    { prop: "price", label: "购买价格", type: "number", money: true, width: 120 },
    { prop: "buyer", label: "购买人", type: "text", width: 110 },
    { prop: "isConsumable", label: "是否耗材", type: "switch", width: 100, defaultValue: false },
  ],
};

/** 财务信息 · 收入项目（PPT 5.1）：项目编号只能从【测试项目】选 */
export const LAB_FIN_INCOME: LabResource = {
  resource: "lab_fin_income",
  title: "收入项目",
  desc: "合同、开票、到账全流程跟踪；项目编号从测试项目选择并自动带出委托单位等信息",
  icon: "TrendCharts",
  labelProp: "projectNo",
  fields: [
    { prop: "date", label: "日期", type: "date", width: 120 },
    {
      prop: "projectNo",
      label: "项目编号",
      type: "ref",
      width: 160,
      refResource: "lab_projects",
      refValueProp: "projectNo",
      refLabelProps: ["projectNo", "clientName"],
      // 选中测试项目后带出甲方与对接人（带出后仍可手改，开票对象可能与委托方不同）
      refFill: { clientName: "clientName", clientContact: "clientContact", projectOwner: "projectOwner" },
      placeholder: "从测试项目选择（选后自动带出委托单位、联系人、对接人）",
    },
    { prop: "clientName", label: "委托单位", type: "text", width: 180 },
    { prop: "settleUnit", label: "到账单位", type: "text", width: 180 },
    { prop: "price", label: "价格（万元）", type: "number", money: true, unitWan: true, width: 130 },
    { prop: "contractStatus", label: "合同情况", type: "select", width: 110, options: opts(CONTRACT) },
    { prop: "testStatus", label: "测试情况", type: "select", width: 110, options: opts(TEST_STATUS) },
    { prop: "invoiceStatus", label: "开票情况", type: "select", width: 110, options: opts(INVOICE) },
    { prop: "clientContact", label: "委托单位联系人", type: "text", width: 130 },
    { prop: "receiveStatus", label: "到账情况", type: "select", width: 110, options: opts(RECEIVE) },
    { prop: "projectOwner", label: "项目对接人", type: "text", width: 110 },
  ],
};

/** 财务信息 · 支出项目（PPT 5.2）：关联项目只能从【委外项目】选 */
export const LAB_FIN_EXPENSE: LabResource = {
  resource: "lab_fin_expense",
  title: "支出项目",
  desc: "委外测试的交付、发票与付款跟踪；关联项目从委外项目选择并自动带出受托单位与金额",
  icon: "Histogram",
  labelProp: "outsourceItem",
  fields: [
    { prop: "date", label: "日期", type: "date", width: 120 },
    {
      prop: "relatedProject",
      label: "关联委外项目",
      type: "ref",
      width: 170,
      refResource: "lab_outsource_projects",
      refValueProp: "projectNo",
      refLabelProps: ["projectNo", "vendor"],
      // 选中委外项目后带出受托单位/委外内容/对接人/金额，避免两处重复录入（金额可按实际付款改写）；
      // 两边都是万元口径，直接透传（单位不同时才写 [来源字段, 系数]）
      refFill: { outsourceUnit: "vendor", outsourceItem: "outsourceItem", owner: "projectOwner", price: "price" },
      placeholder: "从委外项目选择",
    },
    { prop: "outsourceUnit", label: "委外单位", type: "text", width: 180 },
    { prop: "outsourceItem", label: "委外项目", type: "text", ellipsis: true },
    { prop: "owner", label: "负责人", type: "text", width: 110 },
    { prop: "price", label: "价格（万元）", type: "number", money: true, unitWan: true, width: 130 },
    { prop: "deliveryStatus", label: "交付情况", type: "select", width: 110, options: opts(DELIVERY) },
    { prop: "invoiceStatus", label: "发票情况", type: "select", width: 110, options: opts(INVOICE_IN) },
    { prop: "payStatus", label: "付款情况", type: "select", width: 110, options: opts(PAY) },
    { prop: "payUnit", label: "付款单位", type: "text", width: 180 },
  ],
};

/** 客户信息（PPT 6） */
export const LAB_CUSTOMERS: LabResource = {
  resource: "lab_customers",
  title: "客户信息",
  desc: "委托单位主数据与收款账户",
  icon: "Service",
  labelProp: "name",
  fields: [
    { prop: "name", label: "客户名称", type: "text", required: true, width: 220 },
    { prop: "address", label: "单位地址", type: "text", ellipsis: true },
    {
      prop: "bankName",
      label: "开户银行",
      type: "text",
      width: 180,
      group: "供应商银行账户信息（收款信息）",
    },
    { prop: "bankAccount", label: "银行账号", type: "text", width: 200, group: "供应商银行账户信息（收款信息）" },
    { prop: "bankCode", label: "银行联行号", type: "text", width: 160, group: "供应商银行账户信息（收款信息）" },
    { prop: "contactName", label: "联系人姓名", type: "text", width: 110 },
    { prop: "contactPhone", label: "联系人电话", type: "text", width: 140 },
    { prop: "contactEmail", label: "联系人邮箱", type: "text", width: 200 },
  ],
};

/** 设备信息（PPT 7） */
export const LAB_EQUIPMENT: LabResource = {
  resource: "lab_equipment",
  title: "设备信息",
  desc: "实验室设备台账与运行状态",
  icon: "Monitor",
  labelProp: "name",
  fields: [
    { prop: "code", label: "编号", type: "text", required: true, width: 160, unique: true },
    { prop: "name", label: "设备名称", type: "text", required: true, ellipsis: true },
    // 新建设备默认待机；被项目占用时由联动置为「运行中」
    { prop: "status", label: "运行状态", type: "select", width: 120, options: opts(EQUIP_STATUS), defaultValue: "待机" },
  ],
};

/** 耗材信息（PPT 8） */
export const LAB_CONSUMABLES: LabResource = {
  resource: "lab_consumables",
  title: "耗材信息",
  desc: "耗材名录与现有库存",
  icon: "Box",
  labelProp: "name",
  fields: [
    { prop: "name", label: "耗材名称", type: "text", required: true, ellipsis: true },
    { prop: "qty", label: "现有数量", type: "number", width: 120, defaultValue: 0 },
  ],
};

/** 全部模块（路由 meta.labResource 用 key 索引） */
export const LAB_RESOURCES = {
  projects: LAB_PROJECTS,
  outsourceProjects: LAB_OUTSOURCE_PROJECTS,
  reimbursements: LAB_REIMBURSEMENTS,
  income: LAB_FIN_INCOME,
  expense: LAB_FIN_EXPENSE,
  customers: LAB_CUSTOMERS,
  equipment: LAB_EQUIPMENT,
  consumables: LAB_CONSUMABLES,
} as const;

export type LabResourceKey = keyof typeof LAB_RESOURCES;

/** 按 key 取定义（不存在的 key 返回 null，页面兜底显示空态） */
export function getLabResource(key: unknown): LabResource | null {
  if (typeof key !== "string") return null;
  return (LAB_RESOURCES as Record<string, LabResource>)[key] || null;
}
