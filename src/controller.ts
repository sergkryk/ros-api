type Action = "create" | "delete" | "on" | "off" | "start" | "stop";
type Reason = "managed" | "traffic" | "timeout" | "changed" | "blocked" | "port" | "undefined";
/**
 * Структура запроса, получаемого через Unix socket от RADIUS/внешних систем
 * Формат строки протокола: "action|reason|nas|ip|mac|speed"
 */
type SocketRequest = {
  action: Action;
  reason: Reason;
  nas: string;
  ip: string;
  mac: string;
  speed: string;
};

/**
 * Парсит строку протокола Unix socket в структурированный объект запроса
 * @param message - Строка формата "action|reason|nas|ip|mac|speed"
 * @returns Объект SocketRequest с распарсенными полями
 * @example
 * parseSocketString("start|login|10.45.0.156|172.16.16.2|AA:BB:CC:DD:EE:FF|100")
 * // => { action: "start", reason: "login", nas: "10.45.0.156",
 * //      ip: "172.16.16.2", mac: "AA:BB:CC:DD:EE:FF", speed: "100" }
 */
function parseSocketString(message: string): SocketRequest {
  const p = message.split("|");
  return {
    action: p[0] as Action,
    reason: p[1] as Reason,
    nas: p[2],
    ip: p[3],
    mac: p[4],
    speed: p[5],
  };
}

export default async function handleCommand(command: string): Promise<void> {
  const params = parseSocketString(command);
  const { action, reason, nas, ip, mac, speed } = params;

  if (action === "create") {
    console.log(params);
  }
  if (action === "delete") {
    console.log(params);
  }
  if (action === "on") {
    console.log(params);
  }
  if (action === "off") {
    console.log(params);
  }
  if (action === "start") {
    console.log(params);
  }
  if (action === "stop") {
    if (reason === "blocked") {
      console.log(params);
    }
    if (reason === "changed") {
      console.log(params);
    }
    if (reason === "managed") {
      console.log(params);
    }
    if (reason === "timeout") {
      console.log(params);
    }
    if (reason === "traffic") {
      console.log(params);
    }
    if (reason === "port") {
      console.log(params);
    }
    if (reason === "undefined") {
      console.log(params);
    }
  }
}
