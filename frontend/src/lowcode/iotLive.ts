// ============================================================================
// 物联网实时数据流（SSE 单例）
//
// 大屏组件 / 仪表盘 / 排产看板共用同一份实时状态；
// 后端未启动时自动降级为本地模拟数据（connected=false, mock=true），
// 保证离线演示时大屏组件依然有数据可看。
// ============================================================================

import { reactive } from "vue";
import type { IotAlert, IotDevice, IotOverview, IotPoint } from "../api/iot";

export interface IotLiveState {
  connected: boolean;
  /** 后端不可用，已切换到本地模拟数据 */
  mock: boolean;
  devices: IotDevice[];
  overview: IotOverview | null;
  alerts: IotAlert[];
  points: IotPoint[];
  /** 设备历史（后端在线时从 /history 拉取后维护） */
  histories: Record<string, IotPoint[]>;
}

export const iotLive = reactive<IotLiveState>({
  connected: false,
  mock: false,
  devices: [],
  overview: null,
  alerts: [],
  points: [],
  histories: {},
});

/** 本地模拟数据（离线兜底），种子固定保证稳定演示 */
const MOCK_DEVICES: IotDevice[] = [
  { id: "DEV-001", name: "高低温试验箱", type: "env", location: "实验室A-101", status: "online", baseTemp: 35.2, baseHum: 60, power: 12.4, limits: {} },
  { id: "DEV-002", name: "恒温恒湿箱", type: "env", location: "实验室A-102", status: "online", baseTemp: 28.0, baseHum: 55, power: 9.8, limits: {} },
  { id: "DEV-003", name: "万能材料试验机", type: "test", location: "实验室B-201", status: "online", baseTemp: 24.5, baseHum: 45, power: 15.2, limits: {} },
  { id: "DEV-004", name: "三坐标测量仪", type: "test", location: "实验室B-202", status: "offline", baseTemp: 23.0, baseHum: 50, power: 0, limits: {} },
  { id: "DEV-005", name: "厂区总能耗表", type: "energy", location: "配电房", status: "online", baseTemp: 30.0, baseHum: 50, power: 42.6, limits: {} },
  { id: "DEV-006", name: "3号试验箱", type: "env", location: "实验室A-103", status: "error", baseTemp: 42.1, baseHum: 70, power: 18.4, limits: {} },
];

let mockTimer: number | undefined;
let mockTick = 0;
function seedMock() {
  iotLive.devices = JSON.parse(JSON.stringify(MOCK_DEVICES));
  iotLive.overview = {
    online: 5,
    total: 6,
    openAlerts: 1,
    energyNow: 42.6,
    energyToday: 1022,
    testToday: 10,
    samplesInToday: 16,
    samplesTesting: 6,
    samplesOutToday: 12,
    tick: 0,
    time: Date.now(),
  };
  iotLive.alerts = [
    {
      id: "AL-0001",
      deviceId: "DEV-006",
      level: "error",
      message: "3号试验箱 温度 42.1℃ 超过预警值 40℃",
      time: Date.now() - 60000,
      status: "open",
    },
  ];
  mockTick = 0;
  const rnd = (b: number, a: number) => +(b + (Math.random() - 0.5) * 2 * a).toFixed(1);
  iotLive.points = iotLive.devices
    .filter((d) => d.status !== "offline")
    .map((d) => ({
      deviceId: d.id,
      deviceName: d.name,
      type: d.type,
      time: Date.now(),
      temperature: rnd(d.baseTemp, 3),
      humidity: rnd(d.baseHum, 5),
      power: rnd(d.power, 1),
    }));
  mockTimer = window.setInterval(() => {
    mockTick += 1;
    iotLive.points = iotLive.points.map((p) => {
      const d = iotLive.devices.find((x) => x.id === p.deviceId) || ({ baseTemp: 25, baseHum: 50, power: 5 } as IotDevice);
      return {
        ...p,
        time: Date.now(),
        temperature: rnd(d.baseTemp, 3),
        humidity: rnd(d.baseHum, 5),
        power: rnd(d.power, 1),
      };
    });
    const ov = iotLive.overview!;
    ov.tick = mockTick;
    ov.energyNow = +iotLive.points.filter((p) => p.type === "energy").reduce((a, b) => a + b.power, 0).toFixed(1);
    ov.testToday = 10 + (mockTick % 7);
    ov.samplesInToday = 16 + (mockTick % 5);
    ov.samplesTesting = 6 + (mockTick % 4);
    ov.energyToday = +(ov.energyNow * 24).toFixed(1);
  }, 2500);
}

let started = false;
let source: EventSource | null = null;

function connect() {
  source = new EventSource("/api/iot/stream");
  source.onopen = () => {
    iotLive.connected = true;
    iotLive.mock = false;
    if (mockTimer) {
      clearInterval(mockTimer);
      mockTimer = undefined;
    }
  };
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.devices) iotLive.devices = data.devices;
      if (data.overview) iotLive.overview = data.overview;
      if (data.alerts) iotLive.alerts = data.alerts;
      if (data.points) {
        iotLive.points = data.points;
        for (const p of data.points) {
          const list = iotLive.histories[p.deviceId] || [];
          list.push(p);
          if (list.length > 60) list.shift();
          iotLive.histories[p.deviceId] = list;
        }
      }
    } catch {
      /* 忽略非 JSON 消息 */
    }
  };
  source.onerror = () => {
    iotLive.connected = false;
    source?.close();
    source = null;
    if (!iotLive.mock) {
      iotLive.mock = true;
      seedMock();
    }
    window.setTimeout(connect, 5000);
  };
}

/**
 * 启动实时数据流（幂等）。组件挂载时调用即可。
 * 后端在线走 SSE，离线自动进本地模拟。
 */
export function startIotLive() {
  if (started) return;
  started = true;
  if (typeof EventSource === "undefined") {
    iotLive.mock = true;
    seedMock();
    return;
  }
  connect();
}

/** 停止实时数据流（一般不需要，页面级使用） */
export function stopIotLive() {
  source?.close();
  source = null;
  if (mockTimer) clearInterval(mockTimer);
  started = false;
}
