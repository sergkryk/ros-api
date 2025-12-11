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
  // --action stop --reason timeout --session 3369e083 --login 38:6B:1C:95:47:C9 --nas 10.77.0.5 --ip 10.10.0.247 --shape 0 --mac 38:6b:1c:95:47:c9
  // --action start --session 786ce083 --login 58:D5:6E:9E:46:E0 --nas 10.77.0.5 --ip 10.10.0.238 --shape 0 --user-name 58:D5:6E:9E:46:E0 --mac 58:d5:6e:9e:46:e0
  const parsedParams = command.split("--").reduce(
    (acc, el) => {
      const [key, value] = el.split(" ");
      if (key && value !== undefined) {
        acc[key] = value.trim();
      }
      return acc;
    },
    {} as Record<string, string>,
  );
  console.log(parsedParams);

  // if (action === "create") {
  //   console.log(params);
  // }
  // if (action === "delete") {
  //   console.log(params);
  // }
  // if (action === "on") {
  //   console.log(params);
  // }
  // if (action === "off") {
  //   console.log(params);
  // }
  // if (action === "start") {
  //   console.log(params);
  // }
  // if (action === "stop") {
  //   if (reason === "blocked") {
  //     console.log(params);
  //   }
  //   if (reason === "changed") {
  //     console.log(params);
  //   }
  //   if (reason === "managed") {
  //     console.log(params);
  //   }
  //   if (reason === "timeout") {
  //     console.log(params);
  //   }
  //   if (reason === "traffic") {
  //     console.log(params);
  //   }
  //   if (reason === "port") {
  //     console.log(params);
  //   }
  //   if (reason === "undefined") {
  //     console.log(params);
  //   }
  // }
}
