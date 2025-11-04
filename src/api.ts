import ConnectionManager from "./connections-manager";
import { RouterOSLease, RouterOSQueue } from "./api.d";
import { NasServer } from "./config-preloader";

class RouterAPI {
  /**
   * Выполняет запрос к RouterOS API и возвращает набор результатов
   * @template T - Тип объектов в результате (например, RouterOSQueue)
   * @param nas - Адрес NAS устройства для подключения
   * @param command - Массив команд RouterOS API (например, ["/queue/simple/print"])
   * @returns Promise с Set объектов типа T, полученных из ответов "!re"
   */
  private async query<T>(nas: NasServer, command: string[]): Promise<Set<T>> {
    const result: Set<T> = new Set();
    const conn = await ConnectionManager.getConnection(nas);
    try {
      for await (const [reply, attributes] of conn.sendCommand(command)) {
        if (reply === "!re") {
          result.add(attributes as T);
        }
        if (reply === "!trap") {
          console.error(attributes["=message"]);
        }
      }
    } finally {
      await conn.close();
    }
    return result;
  }

  /**
   * Получает список очередей (queues) с RouterOS устройства
   * @param nas - Адрес NAS устройства
   * @param target - Опциональный IP адрес для фильтрации (будет добавлен /32)
   * @returns Promise с Set объектов RouterOSQueue
   * @example
   * // Получить все очереди
   * await getQueues('192.168.1.1')
   * // Получить очереди для конкретного IP
   * await getQueues('192.168.1.1', '10.0.0.5')
   */
  async getQueues(nas: NasServer, target?: string): Promise<Set<RouterOSQueue>> {
    const command = ["/queue/simple/print"];
    if (typeof target === "string") {
      command.push(`?target=${target}/32`);
    }
    const reply = await this.query<RouterOSQueue>(nas, command);
    return reply;
  }

  /**
   * Изменяет скорость для всех очередей указанного target
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес цели (будет добавлен /32 при поиске)
   * @param speed - Новая скорость в мегабитах (будет применена для upload/download)
   * @returns Promise<void>
   */
  async editQueuesSpeed(nas: NasServer, target: string, speed: number): Promise<void> {
    const queues = await this.getQueues(nas, target);
    for (const queue of queues) {
      await this.query(nas, [
        "/queue/simple/set",
        `=max-limit=${speed}M/${speed}M`,
        `=.id=${queue["=.id"]}`,
      ]);
    }
  }

  /**
   * Удаляет все очереди для указанного target
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес цели (будет добавлен /32 при поиске)
   * @returns Promise<void>
   */
  async removeQueues(nas: NasServer, target: string): Promise<void> {
    const queues = await this.getQueues(nas, target);
    for (const queue of queues) {
      await this.query(nas, ["/queue/simple/remove", `=.id=${queue["=.id"]}`]);
    }
  }

  /**
   * Добавляет очередь для указанного target
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес для очереди
   * @param speed -  Скорость в мегабитах (будет применена для upload/download)
   * @returns Promise<void>
   */
  async addQueue(nas: NasServer, target: string, speed: number): Promise<void> {
    await this.query(nas, [
      "/queue/simple/add",
      `=target=${target}/32`,
      `=max-limit=${speed}M/${speed}M`,
    ]);
  }

  /**
   * Устанавливает очередь для target: редактирует существующую или создает новую
   * Если найдено более одной очереди - удаляет все и создает одну новую
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес цели
   * @param speed - Скорость в мегабитах
   * @throws Error при проблемах с API
   */
  async setQueue(nas: NasServer, target: string, speed: number): Promise<void> {
    const queues = await this.getQueues(nas, target);
    if (queues.size === 1) {
      await this.editQueuesSpeed(nas, target, speed);
      return;
    }
    if (queues.size > 1) {
      await this.removeQueues(nas, target);
    }
    await this.addQueue(nas, target, speed);
  }

  /**
   * Получает DHCP lease записи для указанного IP адреса
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес для поиска lease
   * @returns Promise с Set объектов RouterOSLease
   * @example
   * const leases = await getLease('192.168.1.1', '10.0.0.5')
   */
  async getLease(nas: NasServer, target: string): Promise<Set<RouterOSLease>> {
    const leases = await this.query<RouterOSLease>(nas, [
      "/ip/dhcp-server/lease/print",
      `?address=${target}`,
    ]);
    return leases;
  }

  /**
   * Удаляет все DHCP lease записи для указанного IP адреса
   * @param nas - Адрес NAS устройства
   * @param target - IP адрес, для которого нужно удалить lease
   * @returns Promise<void>
   */
  async removeLease(nas: NasServer, target: string): Promise<void> {
    const leases = await this.getLease(nas, target);
    for (const lease of leases) {
      await this.query<RouterOSLease>(nas, [
        "/ip/dhcp-server/lease/remove",
        `=.id=${lease["=.id"]}`,
      ]);
    }
  }
}

export default new RouterAPI();
