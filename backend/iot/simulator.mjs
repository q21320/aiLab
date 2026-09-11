// ============================================================================
// 虚拟仪器服务器（无真实硬件时的"真"设备）
//
// 与真实仪器使用完全相同的协议与端口语义：
//   · SCPI over TCP   : 默认端口 5025（*IDN? / MEAS:TEMP? / SOUR:TEMP 85 / SYST:STAT?）
//   · Modbus TCP      : 默认端口 5020（FC3/FC4 读、FC6/FC16 写，寄存器表见下）
// 因此"接虚拟仪器"与"接真仪器"在平台上走的是同一条代码路径，
// 换成真设备只需把 IP/端口改成仪器的地址即可。
// ============================================================================

import net from "node:net";

const MODEL = {
  setpoint: 25, // 设定温度 ℃
  temperature: 25.2, // 实测温度
  humidity: 55, // 湿度 %
  power: 12.4, // 功率 kW
  status: 1, // 0 停机 1 运行 2 报警
  cycles: 0,
  writes: 0,
  reads: 0,
  startedAt: Date.now(),
};

function step() {
  // 温度向设定值逼近 + 噪声（一阶惯性）
  MODEL.temperature += (MODEL.setpoint - MODEL.temperature) * 0.25 + (Math.random() - 0.5) * 0.3;
  MODEL.temperature = Math.round(MODEL.temperature * 100) / 100;
  MODEL.humidity = Math.round((MODEL.humidity + (Math.random() - 0.5) * 0.6) * 10) / 10;
  const load = Math.min(6, Math.abs(MODEL.setpoint - MODEL.temperature));
  MODEL.power = Math.round((10 + load * 1.6 + Math.random() * 0.4) * 100) / 100;
  MODEL.status = MODEL.temperature > MODEL.setpoint + 6 ? 2 : 1;
}

let tickTimer = null;

// ---------------------------------------------------------------------------
// SCPI 服务器
// ---------------------------------------------------------------------------
const scpiServer = net.createServer((sock) => {
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    for (const raw of chunk.split(/\r?\n/)) {
      const cmd = raw.trim();
      if (!cmd) continue;
      MODEL.reads += 1;
      const upper = cmd.toUpperCase();
      let reply;
      if (upper === "*IDN?") {
        reply = "AILab Instruments,Virtual Environmental Chamber VC-300,SN-VC2026001,1.4.2";
      } else if (upper.startsWith("SOUR:TEMP ")) {
        MODEL.setpoint = Number(cmd.split(/\s+/)[1]) || MODEL.setpoint;
        MODEL.writes += 1;
        reply = "OK";
      } else if (upper === "SOUR:TEMP?") {
        reply = MODEL.setpoint.toFixed(1);
      } else if (upper === "MEAS:TEMP?") {
        reply = MODEL.temperature.toFixed(2);
      } else if (upper === "MEAS:HUMI?") {
        reply = MODEL.humidity.toFixed(1);
      } else if (upper === "MEAS:POW?") {
        reply = MODEL.power.toFixed(2);
      } else if (upper === "SYST:STAT?") {
        reply = MODEL.status === 2 ? "ALARM" : "RUNNING";
      } else if (upper === "SYST:CYCL?") {
        reply = String(MODEL.cycles);
      } else if (upper === "*RST") {
        MODEL.setpoint = 25;
        reply = "OK";
      } else {
        reply = "ERROR:UNKNOWN_COMMAND";
      }
      sock.write(reply + "\n");
    }
  });
  sock.on("error", () => sock.destroy());
});

// ---------------------------------------------------------------------------
// Modbus TCP 服务器（寄存器表）
//   0: 温度×10(int16)   1: 湿度×10   2: 功率×10   3: 状态   4: 设定温度×10(读写)
//   5: 循环数            6-7: 保留    8-9: 测试值 float32(读写)
// ---------------------------------------------------------------------------
function registersSnapshot() {
  const r = new Array(10).fill(0);
  r[0] = Math.round(MODEL.temperature * 10) & 0xffff;
  r[1] = Math.round(MODEL.humidity * 10) & 0xffff;
  r[2] = Math.round(MODEL.power * 10) & 0xffff;
  r[3] = MODEL.status;
  r[4] = Math.round(MODEL.setpoint * 10) & 0xffff;
  r[5] = MODEL.cycles;
  const b = Buffer.alloc(4);
  b.writeFloatBE(MODEL.temperature, 0);
  r[8] = b.readUInt16BE(0);
  r[9] = b.readUInt16BE(2);
  return r;
}

const modbusServer = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 6) {
      const len = buf.readUInt16BE(4);
      if (buf.length < 6 + len) break;
      const frame = buf.subarray(0, 6 + len);
      buf = buf.subarray(6 + len);

      const txId = frame.readUInt16BE(0);
      const unitId = frame.readUInt8(6);
      const fc = frame.readUInt8(7);
      const regs = registersSnapshot();
      const reply = (pdu) => {
        const head = Buffer.alloc(7);
        head.writeUInt16BE(txId, 0);
        head.writeUInt16BE(0, 2);
        head.writeUInt16BE(pdu.length + 1, 4);
        head.writeUInt8(unitId, 6);
        sock.write(Buffer.concat([head, Buffer.from(pdu)]));
      };
      const exception = (code) => reply([fc | 0x80, code]);

      try {
        if (fc === 0x03 || fc === 0x04) {
          MODEL.reads += 1;
          const addr = frame.readUInt16BE(8);
          const qty = frame.readUInt16BE(10);
          if (addr + qty > regs.length) throw new Error("address");
          const pdu = [fc, qty * 2];
          for (let i = 0; i < qty; i++) {
            pdu.push((regs[addr + i] >> 8) & 0xff, regs[addr + i] & 0xff);
          }
          reply(pdu);
        } else if (fc === 0x06) {
          const addr = frame.readUInt16BE(8);
          const value = frame.readUInt16BE(10);
          applyWrite(addr, value);
          MODEL.writes += 1;
          reply([0x06, (addr >> 8) & 0xff, addr & 0xff, (value >> 8) & 0xff, value & 0xff]);
        } else if (fc === 0x10) {
          const addr = frame.readUInt16BE(8);
          const qty = frame.readUInt16BE(10);
          for (let i = 0; i < qty; i++) {
            applyWrite(addr + i, frame.readUInt16BE(13 + i * 2));
          }
          MODEL.writes += 1;
          reply([0x10, (addr >> 8) & 0xff, addr & 0xff, (qty >> 8) & 0xff, qty & 0xff]);
        } else {
          exception(0x01);
        }
      } catch {
        exception(0x02);
      }
    }
  });
  sock.on("error", () => sock.destroy());
});

function applyWrite(addr, value) {
  if (addr === 4) MODEL.setpoint = Math.round((value / 10) * 10) / 10;
  else if (addr === 5) MODEL.cycles = value;
  else if (addr === 8) MODEL._f32Hi = value;
  else if (addr === 9) {
    const b = Buffer.alloc(4);
    b.writeUInt16BE(MODEL._f32Hi ?? 0, 0);
    b.writeUInt16BE(value, 2);
    MODEL.setpoint = Math.round(b.readFloatBE(0) * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
let state = { running: false, scpiPort: 5025, modbusPort: 5020 };

export function simulatorStatus() {
  return {
    ...state,
    model: { ...MODEL },
    uptimeSec: Math.round((Date.now() - MODEL.startedAt) / 1000),
  };
}

export function startSimulator(scpiPort = 5025, modbusPort = 5020) {
  return new Promise((resolve) => {
    if (state.running) return resolve(simulatorStatus());
    state = { running: false, scpiPort, modbusPort };
    if (!tickTimer) tickTimer = setInterval(step, 1000);
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) {
        state.running = true;
        resolve(simulatorStatus());
      }
    };
    scpiServer.listen(scpiPort, done);
    modbusServer.listen(modbusPort, done);
  });
}

export function stopSimulator() {
  return new Promise((resolve) => {
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) {
        state.running = false;
        resolve(simulatorStatus());
      }
    };
    try {
      scpiServer.close(done);
    } catch {
      done();
    }
    try {
      modbusServer.close(done);
    } catch {
      done();
    }
  });
}
