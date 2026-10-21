// ============================================================================
// 排产模块（4.4）· PostgreSQL 实现
//
// 接口：
//   GET    /api/production          读取完整排产状态（订单/工序/产线/工单/异常）
//   PUT    /api/production          保存完整状态（前端整体提交，原子写入）
//   POST   /api/production/orders   新增订单（返回带 ID 的订单）
//   POST   /api/production/reset    重置为内置示例数据
//
// 设计说明：
//   排产数据是**强关联的整体**（订单→工单→异常，工序→产线），
//   拆成多张表重建关联的收益远小于复杂度成本，因此采用「整份 JSONB 文档」
//   存储，与 IoT 状态（kv_documents.iot）保持一致的模式。
//
//   相比此前的 localStorage：
//     · 换浏览器/清缓存不丢
//     · 多端共享同一份数据
//     · 可纳入统一备份（/api/backup）
// ============================================================================

const DOC_KEY = "production";

/** 空结构的默认值（前端会用自己的种子数据覆盖） */
const EMPTY = {
  orders: [],
  processes: [],
  lines: [],
  workOrders: [],
  exceptions: [],
  updatedAt: 0,
};

/** 结构校验：防止前端写入畸形数据导致后续渲染崩溃 */
function validateState(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["请求体为空"];
  for (const key of ["orders", "processes", "lines", "workOrders", "exceptions"]) {
    if (key in body && !Array.isArray(body[key])) errors.push(`${key} 必须是数组`);
  }
  // 关键字段抽样校验
  for (const [i, o] of (body.orders || []).entries()) {
    if (!o || typeof o.id !== "string" || !o.id) errors.push(`订单 #${i + 1} 缺少 id`);
    else if (!o.product) errors.push(`订单 ${o.id} 缺少产品名`);
    else if (!Number.isFinite(Number(o.qty)) || Number(o.qty) <= 0) errors.push(`订单 ${o.id} 数量需为正数`);
  }
  for (const [i, w] of (body.workOrders || []).entries()) {
    if (!w || typeof w.id !== "string") errors.push(`工单 #${i + 1} 缺少 id`);
    else if (!Number.isFinite(Number(w.start)) || !Number.isFinite(Number(w.hours))) {
      errors.push(`工单 ${w.id} 缺少有效的开始时间/时长`);
    }
  }
  for (const [i, l] of (body.lines || []).entries()) {
    if (!l || typeof l.id !== "string") errors.push(`产线 #${i + 1} 缺少 id`);
    else if (Number(l.shiftStart ?? 0) < 0 || Number(l.shiftEnd ?? 24) > 24) {
      errors.push(`产线 ${l.id} 班次时间需在 0-24 之间`);
    }
  }
  return errors;
}

export function createProductionRoutes({ sendJSON, readBody, db, audit }) {
  const { readDoc, writeDoc } = db;

  /** 记录审计（失败不影响业务） */
  async function log(req, action, detail) {
    if (typeof audit !== "function") return;
    try {
      await audit(req, { module: "排产", action, detail });
    } catch (e) {
      console.error("[production] 审计写入失败：", e.message);
    }
  }

  return async function handle(req, res, path, method) {
    // ---------------- 读取 ----------------
    if (method === "GET" && path === "/api/production") {
      try {
        const state = await readDoc(DOC_KEY, null);
        sendJSON(res, 200, { ok: true, state: state || null, isEmpty: !state });
      } catch (e) {
        console.error("[production] 读取失败：", e.message);
        sendJSON(res, 500, { error: "读取排产数据失败" });
      }
      return true;
    }

    // ---------------- 保存（整体） ----------------
    if (method === "PUT" && path === "/api/production") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const state = body?.state ?? body;
      const errors = validateState(state);
      if (errors.length) {
        sendJSON(res, 400, { error: "排产数据校验未通过", errors: errors.slice(0, 10) });
        return true;
      }
      try {
        const doc = {
          orders: state.orders || [],
          processes: state.processes || [],
          lines: state.lines || [],
          workOrders: state.workOrders || [],
          exceptions: state.exceptions || [],
          updatedAt: Date.now(),
        };
        await writeDoc(DOC_KEY, doc);
        sendJSON(res, 200, { ok: true, updatedAt: doc.updatedAt });
      } catch (e) {
        console.error("[production] 保存失败：", e.message);
        sendJSON(res, 500, { error: "保存排产数据失败" });
      }
      return true;
    }

    // ---------------- 新增订单（服务端生成 ID，避免多端冲突） ----------------
    if (method === "POST" && path === "/api/production/orders") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const o = body?.order ?? body;
      if (!o || !o.product) {
        sendJSON(res, 400, { error: "缺少产品名称" });
        return true;
      }
      const qty = Number(o.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        sendJSON(res, 400, { error: "数量必须为正数" });
        return true;
      }
      try {
        const state = (await readDoc(DOC_KEY, null)) || { ...EMPTY, orders: [], processes: [], lines: [], workOrders: [], exceptions: [] };
        // 服务端生成订单号：PO-<年份后两位><序号>
        const orders = Array.isArray(state.orders) ? state.orders : [];
        const maxNo = orders.reduce((m, x) => {
          const hit = /^PO-(\d+)$/.exec(String(x.id || ""));
          return hit ? Math.max(m, Number(hit[1])) : m;
        }, 24000);
        const id = `PO-${maxNo + 1}`;
        const order = {
          id,
          product: String(o.product),
          qty,
          due: String(o.due || ""),
          priority: ["high", "normal", "low"].includes(o.priority) ? o.priority : "normal",
          status: "draft",
          createdAt: Date.now(),
        };
        state.orders = [order, ...orders];
        state.updatedAt = Date.now();
        await writeDoc(DOC_KEY, state);
        await log(req, "新增订单", `订单 ${id}「${order.product}」数量 ${qty}，交期 ${order.due || "未定"}`);
        sendJSON(res, 200, { ok: true, order });
      } catch (e) {
        console.error("[production] 新增订单失败：", e.message);
        sendJSON(res, 500, { error: "新增订单失败" });
      }
      return true;
    }

    // ---------------- 重置为示例数据 ----------------
    if (method === "POST" && path === "/api/production/reset") {
      try {
        await writeDoc(DOC_KEY, null);
        await log(req, "重置排产", "清空排产数据，前端将恢复内置示例");
        sendJSON(res, 200, { ok: true });
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }

    return false;
  };
}
