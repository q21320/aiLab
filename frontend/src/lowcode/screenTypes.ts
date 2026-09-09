// ============================================================================
// 低代码平台 · 大屏可视化设计 Schema 类型定义
// ============================================================================

/** 大屏组件类型 */
export type ScreenWidgetKind =
  | "title"
  | "text"
  | "clock"
  | "stat"
  | "bar"
  | "line"
  | "pie"
  | "table"
  | "border"
  | "device"
  | "energy"
  | "testData"
  | "sampleList";

/** 大屏组件（画布坐标系，相对大屏设计尺寸） */
export interface ScreenWidget {
  id: string;
  kind: ScreenWidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 层级 */
  z: number;
  /** 主标题/文本内容 */
  title?: string;
  config: Record<string, any>;
}

/** 大屏设计 Schema */
export interface ScreenSchema {
  id: string;
  name: string;
  /** 设计尺寸（常见 1920x1080） */
  width: number;
  height: number;
  /** 背景色或图片 URL */
  background: string;
  widgets: ScreenWidget[];
}

/** 组件中文名 */
export const SCREEN_WIDGET_LABELS: Record<ScreenWidgetKind, string> = {
  title: "标题",
  text: "文本",
  clock: "时钟",
  stat: "指标卡",
  bar: "柱状图",
  line: "折线图",
  pie: "饼图",
  table: "滚动列表",
  border: "装饰边框",
  device: "设备状态",
  energy: "能耗趋势",
  testData: "测试数据",
  sampleList: "样品台账",
};

/** 默认大屏设计尺寸 */
export const SCREEN_DEFAULT_SIZE = { width: 1920, height: 1080 };
