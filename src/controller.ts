import RouterApi from "./api";
import { NasServer } from "./config-preloader";

/**
 * Структура запроса, получаемого через Unix socket от RADIUS/внешних систем
 * Формат строки протокола: "action|reason|nas|ip|mac|speed"
 */
type SocketRequest = {
  action: string;
  reason?: string;
  login: string;
  nas: NasServer;
  ip: string;
  mac: string;
  shape: string;
};

function isSocketRequest(value: unknown): value is SocketRequest {
  return (
    typeof value === "object" &&
    value != null &&
    "action" in value &&
    "login" in value &&
    "nas" in value &&
    "ip" in value &&
    "mac" in value
  );
}

export default async function handleCommand(command: string): Promise<void> {
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

  if (isSocketRequest(parsedParams)) {
    const { action, login, nas, ip } = parsedParams;
    if (action === "stop") {
      await RouterApi.removeLease(nas, ip);
    }
  }
}
